// R6 end-to-end core RPC smoke test (real process, real bytes, no mocks).
//
// Spawns the built craftmine-core over its real stdio JSON protocol in an
// isolated data directory and exercises the whole asset path: import a real
// PNG, read it, scan the source directory, search, claim a preview, decode the
// exact blob with the real Node preview service, record the evidence and prove
// the version becomes previewable. No window, no input, no audio playback.
//
// Usage:
//   node tests/godot-round2/R6/core-rpc-smoke.mjs
//   CRAFTMINE_CORE_BIN=<path> node tests/godot-round2/R6/core-rpc-smoke.mjs
//
// Exit codes: 0 all checks passed, 2 the asset RPCs are not registered yet
// (R1 wiring pending), 1 a registered call failed, 3 the binary is missing.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { previewAsset } from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/preview-service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const binary =
  process.env.CRAFTMINE_CORE_BIN ??
  path.join(root, 'vendor', 'pi-desktop', 'target', 'debug', process.platform === 'win32' ? 'craftmine-core.exe' : 'craftmine-core');

if (!fs.existsSync(binary)) {
  console.error(`CORE_BINARY_MISSING: ${binary}\nBuild it with: cargo build --manifest-path vendor/pi-desktop/Cargo.toml -p craftmine-core`);
  process.exit(3);
}

const ENGINE = '4.7.2-stable';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-core-smoke-'));
const sourceRoot = path.join(dataDir, 'player');
fs.mkdirSync(sourceRoot, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
function realPng(width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 4;
      raw[at] = x * 8;
      raw[at + 1] = y * 8;
      raw[at + 2] = 128;
      raw[at + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngBytes = realPng(16, 8);
const sourcePath = path.join(sourceRoot, 'door.png');
fs.writeFileSync(sourcePath, pngBytes);

const child = spawn(binary, ['--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
let nextId = 1;
const pending = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', text => {
  buffer += text;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (!line.trim()) continue;
    const response = JSON.parse(line);
    const job = pending.get(response.id);
    if (job) {
      pending.delete(response.id);
      if (response.error) job.reject(response.error);
      else job.resolve(response.result);
    }
  }
});
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', text => {
  stderr += text;
});

function rpc(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject({ code: 'RPC_TIMEOUT', message: method });
    }, 30000);
  });
}

const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function main() {
  const hello = await rpc('hello');
  record('hello', hello?.format === 'craftmine.core/1' ? 'pass' : 'fail', hello?.format ?? 'no format');

  const operationId = `r6-smoke-${crypto.randomUUID()}`;
  const imported = await rpc('asset.import', {
    operationId,
    sourceRoot,
    sourcePath,
    assetId: 'door-texture',
    version: 1,
    kind: 'raw',
    mediaKind: 'image',
    path: 'textures/door.png',
    mediaType: 'image/png',
    displayName: '门贴图',
    source: { origin: 'player-import', author: 'player', license: 'unknown', licenseStatus: 'unverified' },
    tags: ['门'],
  });
  record('asset.import', imported.contentHash?.length === 64 ? 'pass' : 'fail', `bytes=${imported.bytes} dedup=${imported.deduplicated}`);
  record(
    'asset.import file hash',
    imported.version_?.files?.[0]?.sha256 === crypto.createHash('sha256').update(pngBytes).digest('hex') ? 'pass' : 'fail',
  );

  const replay = await rpc('asset.import', {
    operationId,
    sourceRoot,
    sourcePath,
    assetId: 'door-texture',
    version: 1,
    kind: 'raw',
    mediaKind: 'image',
    path: 'textures/door.png',
    mediaType: 'image/png',
    displayName: '门贴图',
    source: { origin: 'player-import', author: 'player', license: 'unknown', licenseStatus: 'unverified' },
    tags: ['门'],
  });
  record('asset.import replay', replay.replayed === true ? 'pass' : 'fail', `replayed=${replay.replayed}`);

  const read = await rpc('asset.read', { assetId: 'door-texture', version: 1 });
  record('asset.read', read.version_?.contentHash === imported.contentHash ? 'pass' : 'fail');
  record('asset.read state separation', read.state?.indexed === true && read.state?.previewable === false ? 'pass' : 'fail');

  const versions = await rpc('asset.versions', { assetId: 'door-texture', offset: 0, limit: 10 });
  record('asset.versions', versions.total === 1 ? 'pass' : 'fail', `total=${versions.total}`);

  const scan = await rpc('asset.scan', { sourceRoot });
  record('asset.scan hints', scan.hints?.unchanged === 1 && scan.worldUpdated === false ? 'pass' : 'fail', JSON.stringify(scan.hints));
  record('asset.scan no world update', scan.worldUpdated === false ? 'pass' : 'fail');

  const search = await rpc('asset.search', { scope: 'local-library', query: '门', offset: 0, limit: 10 });
  record('asset.search', search.total === 1 && search.items?.[0]?.assetId === 'door-texture' ? 'pass' : 'fail', `total=${search.total}`);

  const usage = await rpc('asset.recordUsage', { assetId: 'door-texture', version: 1, refKind: 'world-current', refId: 'w1', detail: 'smoke' });
  record('asset.recordUsage', usage.refKind === 'world-current' ? 'pass' : 'fail');
  const scoped = await rpc('asset.search', { scope: 'current-world', worldId: 'w1', offset: 0, limit: 10 });
  record('asset.search current-world', scoped.total === 1 ? 'pass' : 'fail');

  const annotated = await rpc('asset.annotate', { operationId: `${operationId}-annotate`, assetId: 'door-texture', displayName: '红色门贴图', tags: ['门', '红色'] });
  record('asset.annotate keeps content hash', annotated.contentHash === imported.contentHash ? 'pass' : 'fail');

  const begin = await rpc('asset.previewBegin', { assetId: 'door-texture', version: 1 });
  record('asset.previewBegin', typeof begin.cacheKey === 'string' && begin.preview?.status === 'pending' ? 'pass' : 'fail');

  const body = await rpc('asset.bodyPath', { assetId: 'door-texture', version: 1, path: 'textures/door.png' });
  const blobBytes = fs.readFileSync(body.blobPath);
  record('asset.bodyPath bytes match', crypto.createHash('sha256').update(blobBytes).digest('hex') === body.sha256 ? 'pass' : 'fail');

  const evidence = previewAsset({
    assetId: 'door-texture',
    version: 1,
    contentHash: read.version_.contentHash,
    mediaType: 'image/png',
    path: 'textures/door.png',
    bytes: new Uint8Array(blobBytes),
    engineVersion: ENGINE,
    settingsHash: 'default',
  });
  record('real decode evidence', evidence.status === 'ok' && evidence.facts.picture === true ? 'pass' : 'fail', evidence.detail);

  await rpc('asset.previewFinish', {
    operationId: `${operationId}-preview`,
    assetId: 'door-texture',
    version: 1,
    status: evidence.status,
    detail: evidence.detail,
    facts: evidence.facts,
  });
  const afterPreview = await rpc('asset.read', { assetId: 'door-texture', version: 1 });
  record('previewable only after real evidence', afterPreview.state?.previewable === true ? 'pass' : 'fail');
  const previews = await rpc('asset.previewRead', { assetId: 'door-texture', version: 1 });
  record(
    'previewRead carries a thumbnail',
    typeof previews.items?.[0]?.facts?.thumbnailBase64 === 'string' ? 'pass' : 'fail',
  );

  const check = await rpc('asset.recordCheck', {
    operationId: `${operationId}-check`,
    assetId: 'door-texture',
    version: 1,
    baseId: 'first-person',
    baseVersion: 1,
    engineVersion: ENGINE,
    target: 'desktop',
    checkerVersion: 'smoke/1',
    status: 'passed',
    detail: 'smoke',
  });
  record('asset.recordCheck', check.status === 'passed' ? 'pass' : 'fail');
  const checked = await rpc('asset.read', { assetId: 'door-texture', version: 1 });
  record('baseChecked is separate', checked.state?.baseChecked?.status === 'passed' && checked.state?.appliedToSource?.worldId === 'w1' ? 'pass' : 'fail');
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  const code = error?.code ?? 'FAILED';
  if (code === 'UNKNOWN_METHOD') {
    console.error(`\nASSET_RPC_NOT_REGISTERED: ${error.message ?? ''}`);
    console.error('R1 has not added the asset.* entries to vendor/pi-desktop/crates/craftmine-core/src/main.rs yet.');
    console.error('Fragment: docs/dispatch-reports/godot-round2/R6/INTERFACE_R6.md section 2.');
    exitCode = 2;
  } else {
    console.error(`\nFAILED: ${JSON.stringify(error)}`);
    exitCode = 1;
  }
} finally {
  const passed = results.filter(entry => entry.status === 'pass').length;
  const failed = results.filter(entry => entry.status === 'fail').length;
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed, ${results.length} checks`);
  if (exitCode === 0 && failed > 0) exitCode = 1;
  if (stderr.trim()) console.error(`core stderr:\n${stderr.trim().slice(0, 2000)}`);
  child.stdin.end();
  child.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(exitCode);
}
