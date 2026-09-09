import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_LIMITS,
  FORMAT_BACKEND,
  archiveIdentity,
  crc32,
  packStaticPackage,
  readZip,
  unpackStaticPackage,
  writeZip,
} from '../../../plugins/craftmine-world/package-zip.mjs';

// ---------------------------------------------------------------------------
// CP0 helpers: the same canonical rules the frozen vectors describe.
// ---------------------------------------------------------------------------

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function quoteCanonical(text) {
  let out = '"';
  for (const character of text) {
    const code = character.codePointAt(0);
    if (character === '"') out += '\\"';
    else if (character === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x09) out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += character;
  }
  return `${out}"`;
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value), `non-integer canonical number: ${value}`);
    return value === 0 ? '0' : String(value);
  }
  if (typeof value === 'string') return quoteCanonical(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${quoteCanonical(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function contentHashOf(content) {
  return sha256Hex(Buffer.from(canonicalJson(content), 'utf8'));
}

function fileReference(filePath, bytes) {
  return { path: filePath, bytes: bytes.length, sha256: sha256Hex(bytes) };
}

function buildResource({ assetId, version, kind, payloads, dependencies = [] }) {
  const files = payloads.map(({ path: filePath, bytes }) => fileReference(filePath, bytes));
  const content = {
    assetId,
    version,
    kind,
    files,
    dependencies,
    entry: {},
    interfaces: {},
    compatibility: {},
    state: {},
    licenses: {},
  };
  const manifest = { format: 'craftmine.resource/1', content, contentHash: contentHashOf(content) };
  const map = {};
  for (const { path: filePath, bytes } of payloads) map[filePath] = bytes;
  return { manifest, files: map };
}

function pngLike(seed = 0) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(64);
  for (let i = 0; i < body.length; i += 1) body[i] = (seed * 31 + i * 7) & 0xff;
  return Buffer.concat([header, body]);
}

// Hand-built ZIP container so malformed central directories can be produced.
function buildZip(specs, options = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const spec of specs) {
    const nameBuffer = Buffer.from(spec.name, 'utf8');
    const raw = spec.raw ?? Buffer.alloc(0);
    const data = spec.data ?? (spec.method === 8 ? deflateRawSync(raw) : raw);
    const method = spec.method ?? 0;
    const flags = spec.flags ?? 0;
    const crc = spec.crc ?? crc32(raw);
    const compressedSize = spec.compressedSize ?? data.length;
    const uncompressedSize = spec.uncompressedSize ?? raw.length;
    const externalAttributes = spec.externalAttributes ?? 0;
    const versionMadeBy = spec.versionMadeBy ?? 0x0014;

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    chunks.push(local, data);

    const header = Buffer.alloc(46 + nameBuffer.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(versionMadeBy, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x0021, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressedSize, 20);
    header.writeUInt32LE(uncompressedSize, 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(spec.diskStart ?? 0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(externalAttributes, 38);
    header.writeUInt32LE(offset, 42);
    nameBuffer.copy(header, 46);
    central.push(header);
    offset += local.length + data.length;
  }

  const directory = Buffer.concat(central);
  const count = specs.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(options.entriesOnDisk ?? count, 8);
  end.writeUInt16LE(options.totalEntries ?? count, 10);
  end.writeUInt32LE(options.directorySize ?? directory.length, 12);
  end.writeUInt32LE(options.directoryOffset ?? offset, 16);
  end.writeUInt16LE(0, 20);
  const parts = [...chunks, directory, end];
  if (options.omitEnd) parts.pop();
  return Buffer.concat(parts);
}

function sampleResources() {
  const raw = buildResource({
    assetId: 'pixel.sprite',
    version: 1,
    kind: 'raw',
    payloads: [{ path: 'payload/sprite.png', bytes: pngLike(3) }],
  });
  const recipes = Buffer.from(JSON.stringify({
    format: 'craftmine.data/1',
    records: [{ id: 'plank', inputs: ['log'], count: 4 }],
  }), 'utf8');
  const data = buildResource({
    assetId: 'recipes.basic',
    version: 1,
    kind: 'data',
    payloads: [{ path: 'payload/recipes.json', bytes: recipes }],
    dependencies: [{ id: 'pixel.sprite', version: 1, sha256: raw.manifest.contentHash }],
  });
  return { raw, data, recipes };
}

function samplePackage(overrides = {}) {
  const { raw, data } = sampleResources();
  return {
    root: { id: 'recipes.basic', version: 1 },
    resources: [raw, data],
    catalog: {
      format: 'craftmine.catalog/1',
      name: '示例配方',
      entries: [{ assetId: 'recipes.basic', version: 1 }],
    },
    previews: { 'cover.png': pngLike(9) },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. store / deflate round trip and archive identity
// ---------------------------------------------------------------------------

test('store 与 deflate 往返，包身份两次打包稳定', (t) => {
  t.diagnostic(`package-format backend: ${FORMAT_BACKEND}`);
  assert.deepEqual({ ...DEFAULT_LIMITS }, {
    maxEntries: 4096,
    maxEntryBytes: 64 * 1024 * 1024,
    maxTotalBytes: 512 * 1024 * 1024,
    maxCompressedBytes: 256 * 1024 * 1024,
    maxDepth: 32,
    maxNameBytes: 240,
    maxRatio: 200,
  });
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);

  const entries = [
    { name: 'a/note.txt', bytes: Buffer.from('hello 世界\n'.repeat(8)) },
    { name: 'b.bin', bytes: Buffer.from(Array.from({ length: 256 }, (_, index) => index)) },
    { name: 'empty.txt', bytes: Buffer.alloc(0) },
  ];

  const stored = readZip(writeZip(entries, { compress: false })).entries;
  assert.deepEqual(stored.map((entry) => entry.name), ['a/note.txt', 'b.bin', 'empty.txt']);
  for (const entry of stored) {
    const source = entries.find((item) => item.name === entry.name);
    assert.equal(entry.method, 0);
    assert.equal(entry.uncompressedSize, source.bytes.length);
    assert.equal(entry.crc32, crc32(source.bytes));
    assert.deepEqual(entry.bytes, source.bytes);
  }

  const deflated = readZip(writeZip(entries, { compress: true })).entries;
  assert.deepEqual(deflated.map((entry) => entry.method), [8, 8, 8]);
  for (const entry of deflated) {
    const source = entries.find((item) => item.name === entry.name);
    assert.deepEqual(entry.bytes, source.bytes);
  }

  const first = packStaticPackage(samplePackage());
  const second = packStaticPackage(samplePackage());
  assert.deepEqual(first, second);
  assert.deepEqual(archiveIdentity(first), archiveIdentity(second));
  assert.equal(archiveIdentity(first).archiveSha256, sha256Hex(first));
  assert.equal(archiveIdentity(first).bytes, first.length);
  assert.equal(FORMAT_BACKEND, FORMAT_BACKEND === 'package-format.mjs' ? 'package-format.mjs' : 'builtin-fallback');
});

// ---------------------------------------------------------------------------
// 2. realistic raw + data package with catalog and preview
// ---------------------------------------------------------------------------

test('raw + data 依赖闭包往返，每个文件逐字节一致', () => {
  const { raw, data, recipes } = sampleResources();
  const catalog = samplePackage().catalog;
  const previews = samplePackage().previews;
  const archive = packStaticPackage({
    root: { id: 'recipes.basic', version: 1 },
    resources: [raw, data],
    catalog,
    previews,
  });

  const unpacked = unpackStaticPackage(archive);
  assert.equal(unpacked.packageJson.format, 'craftmine.package/1');
  assert.equal(unpacked.packageJson.root.id, 'recipes.basic');
  assert.equal(unpacked.packageJson.root.version, 1);
  assert.equal(unpacked.packageJson.root.sha256, data.manifest.contentHash);
  assert.equal(unpacked.resources.length, 2);
  assert.equal(unpacked.bytes, archive.length);
  assert.equal(unpacked.archiveSha256, sha256Hex(archive));

  const dataResource = unpacked.resources.find((item) => item.manifest.content.assetId === 'recipes.basic');
  const rawResource = unpacked.resources.find((item) => item.manifest.content.assetId === 'pixel.sprite');
  assert.equal(dataResource.contentHash, data.manifest.contentHash);
  assert.equal(rawResource.contentHash, raw.manifest.contentHash);
  assert.deepEqual(dataResource.files.get('payload/recipes.json'), recipes);
  assert.deepEqual(rawResource.files.get('payload/sprite.png'), raw.files['payload/sprite.png']);
  assert.deepEqual(dataResource.manifest.content.dependencies, [
    { id: 'pixel.sprite', version: 1, sha256: raw.manifest.contentHash },
  ]);
  assert.deepEqual(unpacked.catalog, catalog);
  assert.deepEqual(unpacked.previews.get('cover.png'), previews['cover.png']);

  const declared = new Set(unpacked.packageJson.files.map((reference) => reference.path));
  assert.ok(declared.has('catalog.json'));
  assert.ok(declared.has('previews/cover.png'));
  assert.ok(declared.has(`resources/${raw.manifest.contentHash}/manifest.json`));
  assert.ok(declared.has(`resources/${raw.manifest.contentHash}/payload/sprite.png`));
  assert.ok(declared.has(`resources/${data.manifest.contentHash}/payload/recipes.json`));
  assert.equal(declared.has('package.json'), false);
});

// ---------------------------------------------------------------------------
// 3. fresh offline directory round trip
// ---------------------------------------------------------------------------

test('全新临时目录离线往返只依赖归档字节', () => {
  const archive = packStaticPackage(samplePackage());
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-package-zip-'));
  try {
    const file = path.join(directory, '示例-1.zip');
    fs.writeFileSync(file, archive);
    const fromDisk = fs.readFileSync(file);
    assert.deepEqual(archiveIdentity(fromDisk), archiveIdentity(archive));

    const unpacked = unpackStaticPackage(fromDisk);
    const dataResource = unpacked.resources.find((item) => item.manifest.content.assetId === 'recipes.basic');
    assert.equal(dataResource.contentHash, sampleResources().data.manifest.contentHash);
    assert.equal(sha256Hex(dataResource.files.get('payload/recipes.json')),
      sha256Hex(sampleResources().recipes));
    assert.deepEqual([...unpacked.previews.keys()], ['cover.png']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. rejections with exact codes
// ---------------------------------------------------------------------------

test('畸形 ZIP 与不完整包按精确错误码拒绝', async (t) => {
  await t.test('重复条目（同名与大小写冲突）', () => {
    assert.throws(
      () => writeZip([
        { name: 'dup.txt', bytes: Buffer.from('a') },
        { name: 'dup.txt', bytes: Buffer.from('b') },
      ]),
      { code: 'ZIP_DUPLICATE_ENTRY' },
    );
    assert.throws(
      () => readZip(buildZip([
        { name: 'dup.txt', raw: Buffer.from('a') },
        { name: 'dup.txt', raw: Buffer.from('b') },
      ])),
      { code: 'ZIP_DUPLICATE_ENTRY' },
    );
    assert.throws(
      () => readZip(buildZip([
        { name: 'Case.txt', raw: Buffer.from('a') },
        { name: 'case.txt', raw: Buffer.from('b') },
      ])),
      { code: 'ZIP_DUPLICATE_ENTRY' },
    );
  });

  await t.test('父级穿越路径', () => {
    assert.throws(
      () => readZip(buildZip([{ name: '../escape.txt', raw: Buffer.from('x') }])),
      { code: 'INVALID_PACKAGE_PATH' },
    );
  });

  await t.test('绝对路径', () => {
    assert.throws(
      () => readZip(buildZip([{ name: '/abs.txt', raw: Buffer.from('x') }])),
      { code: 'INVALID_PACKAGE_PATH' },
    );
  });

  await t.test('符号链接条目', () => {
    assert.throws(
      () => readZip(buildZip([{
        name: 'link.txt',
        raw: Buffer.from('x'),
        externalAttributes: (0o120777 << 16) >>> 0,
        versionMadeBy: 0x0314,
      }])),
      { code: 'ZIP_SYMLINK_ENTRY' },
    );
  });

  await t.test('不支持的压缩方法', () => {
    assert.throws(
      () => readZip(buildZip([{ name: 'a.txt', raw: Buffer.from('x'), method: 99 }])),
      { code: 'ZIP_UNSUPPORTED_METHOD' },
    );
  });

  await t.test('加密标志', () => {
    assert.throws(
      () => readZip(buildZip([{ name: 'a.txt', raw: Buffer.from('x'), flags: 1 }])),
      { code: 'ZIP_ENCRYPTED_ENTRY' },
    );
  });

  await t.test('声明大小 / 压缩比炸弹', () => {
    const raw = Buffer.alloc(16);
    assert.throws(
      () => readZip(buildZip([{
        name: 'bomb.bin',
        method: 8,
        raw,
        data: deflateRawSync(raw),
        uncompressedSize: 16 * 1024 * 1024,
      }])),
      { code: 'ZIP_RATIO_EXCEEDED' },
    );
  });

  await t.test('截断的中央目录', () => {
    const good = buildZip([{ name: 'a.txt', raw: Buffer.from('a') }]);
    assert.throws(() => readZip(good.subarray(0, good.length - 22)), { code: 'ZIP_BAD_CENTRAL_DIRECTORY' });
    assert.throws(
      () => readZip(buildZip([{ name: 'a.txt', raw: Buffer.from('a') }], { totalEntries: 4, entriesOnDisk: 4 })),
      { code: 'ZIP_BAD_CENTRAL_DIRECTORY' },
    );
  });

  await t.test('CRC 不匹配', () => {
    const raw = Buffer.from('payload');
    assert.throws(
      () => readZip(buildZip([{ name: 'a.txt', raw, crc: (crc32(raw) ^ 0xffffffff) >>> 0 }])),
      { code: 'ZIP_CRC_MISMATCH' },
    );
  });

  await t.test('缺失 payload 文件', () => {
    const resource = buildResource({
      assetId: 'demo.raw',
      version: 1,
      kind: 'raw',
      payloads: [{ path: 'payload/a.bin', bytes: Buffer.from('abc') }],
    });
    assert.throws(
      () => packStaticPackage({
        root: { id: 'demo.raw', version: 1 },
        resources: [{ manifest: resource.manifest, files: {} }],
      }),
      { code: 'PACKAGE_MISSING_FILE' },
    );
  });

  await t.test('清单未列出的多余条目', () => {
    const resource = buildResource({
      assetId: 'demo.raw',
      version: 1,
      kind: 'raw',
      payloads: [{ path: 'payload/a.bin', bytes: Buffer.from('abc') }],
    });
    assert.throws(
      () => packStaticPackage({
        root: { id: 'demo.raw', version: 1 },
        resources: [{
          manifest: resource.manifest,
          files: { ...resource.files, 'payload/extra.bin': Buffer.from('x') },
        }],
      }),
      { code: 'PACKAGE_ENTRY_NOT_LISTED' },
    );
  });

  await t.test('依赖清单缺失', () => {
    const { data } = sampleResources();
    const orphan = buildResource({
      assetId: 'recipes.basic',
      version: 1,
      kind: 'data',
      payloads: [{ path: 'payload/recipes.json', bytes: Buffer.from('{}') }],
      dependencies: [{ id: 'missing.raw', version: 1, sha256: 'a'.repeat(64) }],
    });
    assert.equal(orphan.manifest.content.assetId, data.manifest.content.assetId);
    assert.throws(
      () => packStaticPackage({
        root: { id: 'recipes.basic', version: 1 },
        resources: [orphan],
      }),
      { code: 'PACKAGE_MISSING_DEPENDENCY' },
    );
  });

  await t.test('正文哈希或大小不匹配', () => {
    const resource = buildResource({
      assetId: 'demo.raw',
      version: 1,
      kind: 'raw',
      payloads: [{ path: 'payload/a.bin', bytes: Buffer.from('abc') }],
    });
    const tampered = Buffer.from(resource.files['payload/a.bin']);
    tampered[0] ^= 0xff;
    assert.throws(
      () => packStaticPackage({
        root: { id: 'demo.raw', version: 1 },
        resources: [{ manifest: resource.manifest, files: { 'payload/a.bin': tampered } }],
      }),
      { code: 'PACKAGE_FILE_HASH_MISMATCH' },
    );
  });

  await t.test('解包时未列出的归档条目', () => {
    const archive = packStaticPackage(samplePackage());
    const entries = readZip(archive).entries.map((entry) => ({ name: entry.name, bytes: entry.bytes }));
    const tampered = writeZip([...entries, { name: 'extra.txt', bytes: Buffer.from('x') }], { compress: false });
    assert.throws(() => unpackStaticPackage(tampered), { code: 'PACKAGE_ENTRY_NOT_LISTED' });
  });

  await t.test('解包时资源内容哈希不匹配', () => {
    const archive = packStaticPackage(samplePackage());
    const entries = readZip(archive).entries.map((entry) => ({ name: entry.name, bytes: entry.bytes }));
    const packageEntry = entries.find((entry) => entry.name === 'package.json');
    const packageJson = JSON.parse(packageEntry.bytes.toString('utf8'));
    packageJson.resources[0].contentHash = 'f'.repeat(64);
    const rebuilt = writeZip([
      ...entries.filter((entry) => entry.name !== 'package.json'),
      { name: 'package.json', bytes: Buffer.from(JSON.stringify(packageJson), 'utf8') },
    ], { compress: false });
    assert.throws(() => unpackStaticPackage(rebuilt), { code: 'RESOURCE_CONTENT_HASH_MISMATCH' });
  });

  await t.test('解包时 payload 条目缺失', () => {
    const archive = packStaticPackage(samplePackage());
    const entries = readZip(archive).entries.map((entry) => ({ name: entry.name, bytes: entry.bytes }));
    const packageEntry = entries.find((entry) => entry.name === 'package.json');
    const packageJson = JSON.parse(packageEntry.bytes.toString('utf8'));
    const dropped = entries.find((entry) => entry.name.endsWith('/payload/recipes.json'));
    packageJson.files = packageJson.files.filter((reference) => reference.path !== dropped.name);
    const rebuilt = writeZip([
      ...entries.filter((entry) => entry.name !== 'package.json' && entry.name !== dropped.name),
      { name: 'package.json', bytes: Buffer.from(JSON.stringify(packageJson), 'utf8') },
    ], { compress: false });
    assert.throws(() => unpackStaticPackage(rebuilt), { code: 'PACKAGE_MISSING_FILE' });
  });

  await t.test('解包时依赖闭包不完整', () => {
    const { raw } = sampleResources();
    const archive = packStaticPackage(samplePackage());
    const entries = readZip(archive).entries.map((entry) => ({ name: entry.name, bytes: entry.bytes }));
    const packageEntry = entries.find((entry) => entry.name === 'package.json');
    const packageJson = JSON.parse(packageEntry.bytes.toString('utf8'));
    const prefix = `resources/${raw.manifest.contentHash}/`;
    packageJson.resources = packageJson.resources.filter((resource) => resource.contentHash !== raw.manifest.contentHash);
    packageJson.files = packageJson.files.filter((reference) => !reference.path.startsWith(prefix));
    const rebuilt = writeZip([
      ...entries.filter((entry) => entry.name !== 'package.json' && !entry.name.startsWith(prefix)),
      { name: 'package.json', bytes: Buffer.from(JSON.stringify(packageJson), 'utf8') },
    ], { compress: false });
    assert.throws(() => unpackStaticPackage(rebuilt), { code: 'PACKAGE_MISSING_DEPENDENCY' });
  });
});

// ---------------------------------------------------------------------------
// 5. determinism
// ---------------------------------------------------------------------------

test('同一输入两次打包产生完全相同的字节', () => {
  const first = packStaticPackage(samplePackage());
  const second = packStaticPackage(samplePackage());
  assert.deepEqual(first, second);
  assert.deepEqual(archiveIdentity(first), archiveIdentity(second));
  assert.deepEqual(writeZip([
    { name: 'b.txt', bytes: Buffer.from('b') },
    { name: 'a.txt', bytes: Buffer.from('a') },
  ]), writeZip([
    { name: 'a.txt', bytes: Buffer.from('a') },
    { name: 'b.txt', bytes: Buffer.from('b') },
  ]));
});
