// AL2 preview service tests (agent N): pure logic, no engine, no window, no
// input, no audio playback. Fixtures are built byte-by-byte in this file or
// generated offscreen; nothing is downloaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  PREVIEWER_VERSION,
  cacheKey,
  cacheKeyInput,
  decodeGlb,
  previewAsset,
} from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/preview-service.mjs';
import {
  GLB_RENDERER_VERSION,
  parseGlb,
  renderGlbStatic,
} from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/decode/glb-render.mjs';
import { decodeImage } from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/decode/image-decode.mjs';
import { runPreviewInWorker } from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/preview-worker.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assetDir = path.join(root, 'vendor', 'pi-desktop', 'apps', 'desktop', 'electron', 'craftmine-assets');
const sharedVectorsPath = path.join(
  root,
  'tests',
  'godot-remaining',
  'M',
  'contract',
  'asset-lock-vectors.json',
);

const ENGINE = '4.7.2-stable';
const report = (name, value) => console.log(`[case] ${name} -> ${JSON.stringify(value)}`);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
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

/** Independent PNG encoder used only as a decoder fixture. */
function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const at = row + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
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

/** Build a minimal real GLB container around the supplied geometry. */
function encodeGlbFixture({
  positions = [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices = [0, 1, 2],
  indexType = 5123,
  node = null,
  nodes = null,
  sceneNodes = null,
  material = null,
  mode = null,
  omitPosition = false,
  omitIndices = false,
} = {}) {
  const parts = [];
  const bufferViews = [];
  const accessors = [];
  const attributes = {};
  if (!omitPosition) {
    const positionBytes = Buffer.alloc((positions.length / 3) * 12);
    positions.forEach((value, index) => positionBytes.writeFloatLE(value, index * 4));
    bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: positionBytes.length });
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: positions.length / 3,
      type: 'VEC3',
    });
    attributes.POSITION = accessors.length - 1;
    parts.push(positionBytes);
  }
  const primitive = { attributes };
  if (!omitIndices && Array.isArray(indices) && indices.length > 0) {
    const elementBytes = indexType === 5125 ? 4 : indexType === 5121 ? 1 : 2;
    const indexBytes = Buffer.alloc(indices.length * elementBytes);
    indices.forEach((value, index) => {
      if (elementBytes === 4) indexBytes.writeUInt32LE(value, index * 4);
      else if (elementBytes === 1) indexBytes.writeUInt8(value, index);
      else indexBytes.writeUInt16LE(value, index * 2);
    });
    const byteOffset = parts.reduce((sum, part) => sum + part.length, 0);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: indexBytes.length });
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: indexType,
      count: indices.length,
      type: 'SCALAR',
    });
    primitive.indices = accessors.length - 1;
    parts.push(indexBytes);
  }
  if (material !== null) primitive.material = 0;
  if (mode !== null) primitive.mode = mode;
  const binary = Buffer.concat(parts);
  const nodeList = nodes === null
    ? [node === null ? { mesh: 0, name: 'Fixture' } : { mesh: 0, ...node }]
    : nodes;
  const roots = sceneNodes === null ? [0] : sceneNodes;
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes: nodeList,
    meshes: [{ primitives: [primitive] }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }],
    ...(material === null ? {} : { materials: [material] }),
  };
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (binary.length % 4)) % 4;
  const binChunk = Buffer.concat([binary, Buffer.alloc(binPad, 0)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.write('JSON', 4, 'ascii');
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.write('BIN\0', 4, 'ascii');
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

/** Minimal static GLB with one triangle. */
function encodeGlb() {
  return encodeGlbFixture();
}

/** Read the IHDR dimensions of a real PNG byte stream. */
function readPngIhdr(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    bitDepth: png[24],
    colorType: png[25],
  };
}

/** Count rendered pixels that are not the dark background. */
function countForegroundPixels(rgba) {
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] !== 16 || rgba[i + 1] !== 18 || rgba[i + 2] !== 24) count += 1;
  }
  return count;
}

function encodeWav16(frames) {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((i / frames) * Math.PI * 2) * 16384), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 0x80000000 ? ((value << 1) ^ 0x04c11db7) >>> 0 : (value << 1) >>> 0;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

/** Ogg uses the non-reflected CRC-32 with polynomial 0x04c11db7. */
function oggCrc(buffer) {
  let crc = 0;
  for (const byte of buffer) {
    crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) & 0xff) ^ byte]) >>> 0;
  }
  return crc >>> 0;
}

function u32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function encodeOggVorbis() {
  const page = (headerType, granule, packets) => {
    const segments = packets.map(packet => packet.length);
    const body = Buffer.concat(packets);
    const head = Buffer.alloc(27 + segments.length);
    head.write('OggS', 0, 'ascii');
    head[4] = 0;
    head[5] = headerType;
    head.writeBigUInt64LE(BigInt(granule), 6);
    head.writeUInt32LE(1, 14);
    head.writeUInt32LE(0, 18);
    head[26] = segments.length;
    segments.forEach((length, index) => {
      head[27 + index] = length;
    });
    const pageBytes = Buffer.concat([head, body]);
    pageBytes.writeUInt32LE(oggCrc(pageBytes), 22);
    return pageBytes;
  };
  const ident = Buffer.concat([
    Buffer.from([1]),
    Buffer.from('vorbis', 'ascii'),
    u32le(0),
    Buffer.from([2]),
    u32le(8000),
    u32le(0),
    u32le(0),
    u32le(0),
    Buffer.from([0xb8]),
    Buffer.from([1]),
  ]);
  return page(0x02, 8000, [ident]);
}

test('cache key matches the frozen cross-language constant', () => {
  const canonical = [
    'craftmine.asset-preview/1',
    'door-texture',
    '1',
    'a'.repeat(64),
    'asset-preview/1',
    ENGINE,
    'default',
  ].join('\n');
  const sha = 'a372177f10f8030150ed62ff1543e1fc5e41c46d211a85248fc12c640ea48d42';
  assert.equal(
    cacheKeyInput({
      assetId: 'door-texture',
      version: 1,
      contentHash: 'a'.repeat(64),
      previewerVersion: PREVIEWER_VERSION,
      engineVersion: ENGINE,
      settingsHash: 'default',
    }),
    canonical,
  );
  assert.equal(
    cacheKey({ assetId: 'door-texture', version: 1, contentHash: 'a'.repeat(64), engineVersion: ENGINE }),
    sha,
  );
  report('cache-key', { canonical, sha256: sha });
});

test('the shared lock vectors hash identically on the Node side', () => {
  const vectors = JSON.parse(fs.readFileSync(sharedVectorsPath, 'utf8'));
  assert.equal(vectors.format, 'craftmine.contract-vectors/1');
  for (const entry of vectors.vectors) {
    const bytes = Buffer.from(entry.lockText, 'utf8');
    assert.equal(bytes.length, entry.lockBytes, `${entry.name} byte length`);
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      entry.assetLockHash,
      `${entry.name} hash`,
    );
  }
  report('shared-lock-vectors', { cases: vectors.vectors.map(item => item.name) });
});

test('PNG decodes to real pixels and a thumbnail', () => {
  const bytes = encodePng(8, 4, (x, y) => [x * 30, y * 60, 128, 255]);
  const result = previewAsset({
    assetId: 'door-texture',
    version: 1,
    contentHash: 'a'.repeat(64),
    mediaType: 'image/png',
    bytes,
    engineVersion: ENGINE,
  });
  assert.equal(result.status, 'ok', result.detail);
  assert.equal(result.facts.width, 8);
  assert.equal(result.facts.height, 4);
  assert.match(result.facts.digest, /^[0-9a-f]{64}$/);
  assert.ok(result.facts.thumbnailBytes > 0);
  assert.equal(result.facts.decoder, 'image-decode.mjs@1');
  report('png', { status: result.status, facts: result.facts });
});

test('a corrupt PNG becomes a failed preview, never a placeholder', () => {
  const good = encodePng(4, 4, () => [255, 0, 0, 255]);
  const broken = good.subarray(0, 40);
  const result = previewAsset({
    assetId: 'door-texture',
    version: 2,
    contentHash: 'b'.repeat(64),
    mediaType: 'image/png',
    bytes: broken,
    engineVersion: ENGINE,
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.detail.length > 0);
  report('png-broken', { status: result.status, detail: result.detail });
});

test('JPEG fixture decodes when the host can generate one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n-jpeg-'));
  const file = path.join(dir, 'fixture.jpg');
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        [
          'Add-Type -AssemblyName System.Drawing;',
          '$b=New-Object System.Drawing.Bitmap 16,16;',
          'for($y=0;$y -lt 16;$y++){for($x=0;$x -lt 16;$x++){$b.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,$x*16,$y*16,64))}};',
          `$b.Save('${file.replace(/\\/g, '\\\\')}',[System.Drawing.Imaging.ImageFormat]::Jpeg);`,
          '$b.Dispose();',
        ].join(' '),
      ],
      { timeout: 60000, stdio: 'ignore' },
    );
  } catch (error) {
    report('jpeg', { skipped: true, reason: String(error.message).slice(0, 120) });
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  const bytes = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(bytes.length > 100);
  const result = previewAsset({
    assetId: 'photo',
    version: 1,
    contentHash: 'c'.repeat(64),
    mediaType: 'image/jpeg',
    bytes,
    engineVersion: ENGINE,
  });
  assert.equal(result.status, 'ok', result.detail);
  assert.equal(result.facts.width, 16);
  assert.equal(result.facts.height, 16);
  assert.match(result.facts.digest, /^[0-9a-f]{64}$/);
  report('jpeg', { status: result.status, facts: result.facts });
});

test('GLB decodes real accessor bytes and topology', () => {
  const bytes = encodeGlb();
  const decoded = decodeGlb(bytes);
  assert.equal(decoded.triangles, 1);
  assert.equal(decoded.vertices, 3);
  assert.equal(decoded.nodes, 1);
  assert.equal(decoded.decoder, 'glb-decode.mjs@1');
  assert.match(decoded.digest, /^[0-9a-f]{64}$/);
  const parsed = parseGlb(bytes);
  assert.equal(parsed.triangles, 1);
  assert.equal(parsed.vertices, 3);
  assert.equal(parsed.accessors.length, 2);
  assert.equal(parsed.bufferViews.length, 2);
  assert.equal(parsed.meshes.length, 1);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.scenes.length, 1);
  assert.equal(parsed.materials.length, 0);
  assert.equal(parsed.images.length, 0);
  assert.ok(parsed.bin instanceof Uint8Array);
  assert.equal(parsed.json.asset.version, '2.0');
  report('glb-structure', { decoded, accessors: parsed.accessors.length });
});

test('GLB preview returns a real rendered picture and keeps accessor facts', () => {
  const bytes = encodeGlb();
  const result = previewAsset({
    assetId: 'auto-door',
    version: 1,
    contentHash: 'd'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes,
    maxSide: 96,
    engineVersion: ENGINE,
  });
  assert.equal(result.status, 'ok', result.detail);
  assert.equal(result.facts.picture, true);
  assert.equal(result.facts.rendered, true);
  assert.equal(result.facts.accessorParsed, true);
  assert.equal(result.facts.playable, false);
  assert.equal(result.facts.renderer, GLB_RENDERER_VERSION);
  assert.equal(result.facts.decoder, 'glb-decode.mjs@1');
  assert.equal(result.facts.triangles, 1);
  assert.equal(result.facts.vertices, 3);
  assert.equal(result.facts.nodes, 1);
  assert.equal(result.facts.meshes, 1);
  assert.equal(result.facts.materials, 0);
  assert.equal(result.facts.images, 0);
  assert.equal(result.facts.accessors, 2);
  assert.equal(result.facts.renderWidth, 96);
  assert.equal(result.facts.renderHeight, 96);
  assert.ok(result.facts.thumbnailBytes > 0);
  assert.match(result.facts.digest, /^[0-9a-f]{64}$/);
  assert.match(result.detail, /rendered 96x96/);
  assert.match(result.detail, /1 tris \/ 1 nodes/);

  const png = Buffer.from(result.facts.thumbnailBase64, 'base64');
  assert.equal(png.length, result.facts.thumbnailBytes);
  const ihdr = readPngIhdr(png);
  assert.ok(ihdr.width > 0 && ihdr.width <= 96, `IHDR width ${ihdr.width}`);
  assert.ok(ihdr.height > 0 && ihdr.height <= 96, `IHDR height ${ihdr.height}`);
  assert.equal(ihdr.bitDepth, 8);
  assert.equal(ihdr.colorType, 6);

  // The thumbnail must be a decodable PNG with actual shaded geometry in it.
  const decoded = decodeImage(png, { maxSide: 96 });
  assert.equal(decoded.width, ihdr.width);
  assert.equal(decoded.height, ihdr.height);
  assert.ok(countForegroundPixels(decoded.rgba) > 0, 'picture must contain geometry pixels');
  report('glb-rendered', {
    status: result.status,
    detail: result.detail,
    renderer: result.facts.renderer,
    thumbnailBytes: result.facts.thumbnailBytes,
    foreground: countForegroundPixels(decoded.rgba),
  });
});

test('two different GLB models never share one digest or thumbnail', () => {
  const triangle = encodeGlb();
  const quad = encodeGlbFixture({
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  });
  const render = bytes => previewAsset({
    assetId: 'auto-door',
    version: 1,
    contentHash: 'd'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes,
    maxSide: 64,
    engineVersion: ENGINE,
  });
  const first = render(triangle);
  const second = render(quad);
  assert.equal(first.status, 'ok', first.detail);
  assert.equal(second.status, 'ok', second.detail);
  assert.equal(first.facts.triangles, 1);
  assert.equal(second.facts.triangles, 2);
  assert.notEqual(first.facts.digest, second.facts.digest);
  assert.notEqual(first.facts.thumbnailBase64, second.facts.thumbnailBase64);
  assert.notEqual(first.facts.geometryDigest, second.facts.geometryDigest);
  report('glb-distinct', {
    digests: [first.facts.digest.slice(0, 12), second.facts.digest.slice(0, 12)],
  });
});

test('GLB rendering is deterministic for identical bytes', () => {
  const bytes = encodeGlb();
  const direct = renderGlbStatic(bytes, { maxSide: 80 });
  const again = renderGlbStatic(bytes, { maxSide: 80 });
  assert.equal(Buffer.from(direct.png).toString('base64'), Buffer.from(again.png).toString('base64'));
  assert.equal(direct.pixelDigest, again.pixelDigest);
  assert.equal(direct.camera.yawDeg, 35);
  assert.equal(direct.camera.pitchDeg, 25);
  assert.ok(direct.camera.scale > 0);

  const request = () => previewAsset({
    assetId: 'auto-door',
    version: 1,
    contentHash: 'd'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes,
    maxSide: 80,
    engineVersion: ENGINE,
  });
  const one = request();
  const two = request();
  assert.equal(one.facts.thumbnailBase64, two.facts.thumbnailBase64);
  assert.equal(one.facts.digest, two.facts.digest);
  report('glb-deterministic', { digest: one.facts.digest.slice(0, 12), bytes: one.facts.thumbnailBytes });
});

test('GLB node/scene transforms and materials change the rendered picture', () => {
  const request = bytes => previewAsset({
    assetId: 'auto-door',
    version: 1,
    contentHash: 'd'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes,
    maxSide: 64,
    engineVersion: ENGINE,
  });
  const base = request(encodeGlb());
  assert.equal(base.status, 'ok', base.detail);

  const rotZ = [0, 0, Math.sin(Math.PI / 12), Math.cos(Math.PI / 12)];
  const stretch = [1, 3, 1];
  // Hierarchical S*R vs R*S: a flat "first transform wins" renderer would
  // produce one identical picture for both.
  const scaleThenRotate = encodeGlbFixture({
    nodes: [{ scale: stretch, children: [1] }, { mesh: 0, rotation: rotZ }],
  });
  const rotateThenScale = encodeGlbFixture({
    nodes: [{ rotation: rotZ, children: [1] }, { mesh: 0, scale: stretch }],
  });
  // A node matrix (column-major) with a non-uniform scale must be honoured too.
  const matrixNode = encodeGlbFixture({
    node: { matrix: [1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  });
  const colored = encodeGlbFixture({
    material: { pbrMetallicRoughness: { baseColorFactor: [0.9, 0.1, 0.1, 1] } },
  });

  const results = [scaleThenRotate, rotateThenScale, matrixNode, colored].map(request);
  for (const result of results) assert.equal(result.status, 'ok', result.detail);
  assert.equal(results[3].facts.materials, 1);
  const digests = [base, ...results].map(result => result.facts.digest);
  assert.equal(new Set(digests).size, digests.length, `digests must differ: ${digests.map(d => d.slice(0, 8)).join(', ')}`);
  report('glb-transforms', { digests: digests.map(digest => digest.slice(0, 8)) });
});

test('a parsed GLB with no rasterisable triangles stays partial, never ok', () => {
  const lines = encodeGlbFixture({ mode: 1 });
  const result = previewAsset({
    assetId: 'auto-door',
    version: 5,
    contentHash: '8'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes: lines,
    engineVersion: ENGINE,
  });
  assert.equal(result.status, 'partial', result.detail);
  assert.equal(result.facts.picture, false);
  assert.equal(result.facts.rendered, false);
  assert.equal(result.facts.accessorParsed, true);
  assert.equal(result.facts.renderer, GLB_RENDERER_VERSION);
  assert.equal(result.facts.triangles, 0);
  assert.equal(result.facts.vertices, 3);
  assert.match(result.facts.renderReason, /RENDER_EMPTY_GEOMETRY/);
  assert.match(result.detail, /glb structure only/);
  report('glb-partial', { status: result.status, reason: result.facts.renderReason });
});

test('corrupt or unsupported GLB bodies fail and never report a picture', () => {
  const good = encodeGlb();
  const cases = [
    ['declared-length', (() => {
      const broken = Buffer.from(good);
      broken.writeUInt32LE(999999, 8);
      return broken;
    })()],
    ['truncated', good.subarray(0, good.length - 12)],
    ['bad-magic', (() => {
      const broken = Buffer.from(good);
      broken.write('nope', 0, 'ascii');
      return broken;
    })()],
    ['unsupported-version', (() => {
      const broken = Buffer.from(good);
      broken.writeUInt32LE(3, 4);
      return broken;
    })()],
  ];
  const details = [];
  for (const [name, bytes] of cases) {
    const result = previewAsset({
      assetId: 'auto-door',
      version: 2,
      contentHash: 'e'.repeat(64),
      mediaType: 'model/gltf-binary',
      bytes,
      engineVersion: ENGINE,
    });
    assert.equal(result.status, 'failed', `${name} must fail`);
    assert.notEqual(result.facts.picture, true, `${name} must not report a picture`);
    assert.notEqual(result.facts.rendered, true, `${name} must not report a render`);
    details.push([name, result.detail]);
  }
  assert.equal(details[0][1], 'CORRUPT_ASSET_BODY');
  assert.equal(details[1][1], 'CORRUPT_ASSET_BODY');
  assert.equal(details[2][1], 'CORRUPT_ASSET_BODY');
  assert.equal(details[3][1], 'UNSUPPORTED_GLB_VERSION');
  assert.throws(() => parseGlb(good.subarray(0, 24)), error => error.code === 'CORRUPT_ASSET_BODY');
  report('glb-corrupt', { details });
});

test('a GLB without POSITION data fails instead of faking a picture', () => {
  const noPosition = encodeGlbFixture({ omitPosition: true, omitIndices: true });
  const result = previewAsset({
    assetId: 'auto-door',
    version: 3,
    contentHash: 'f'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes: noPosition,
    engineVersion: ENGINE,
  });
  assert.equal(result.status, 'failed', result.detail);
  assert.equal(result.detail, 'MISSING_POSITION');
  assert.notEqual(result.facts.picture, true);
  assert.throws(() => parseGlb(noPosition), error => error.code === 'MISSING_POSITION');
  assert.throws(
    () => renderGlbStatic(noPosition),
    error => error.code === 'MISSING_POSITION' && /MISSING_POSITION/.test(error.message),
  );
  report('glb-no-position', { status: result.status, detail: result.detail });
});

test('a GLB render aborts with PREVIEW_TIMEOUT once the deadline passed', () => {
  const bytes = encodeGlb();
  assert.throws(
    () => renderGlbStatic(bytes, { deadline: Date.now() - 1 }),
    error => error.code === 'PREVIEW_TIMEOUT' && /PREVIEW_TIMEOUT/.test(error.message),
  );
  const timedOut = previewAsset({
    assetId: 'auto-door',
    version: 4,
    contentHash: '9'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes,
    deadline: Date.now() - 1,
    engineVersion: ENGINE,
  });
  assert.equal(timedOut.status, 'timeout');
  assert.equal(timedOut.detail, 'PREVIEW_TIMEOUT');
  assert.notEqual(timedOut.facts.picture, true);
  report('glb-timeout', { status: timedOut.status, detail: timedOut.detail });
});

test('WAV decodes real PCM while OGG stays container-only', () => {
  const wav = previewAsset({
    assetId: 'door-sound',
    version: 1,
    contentHash: 'f'.repeat(64),
    mediaType: 'audio/wav',
    bytes: encodeWav16(800),
    engineVersion: ENGINE,
  });
  assert.equal(wav.status, 'ok', wav.detail);
  assert.equal(wav.facts.pcmDecoded, true);
  assert.equal(wav.facts.sampleRate, 8000);
  assert.match(wav.facts.digest, /^[0-9a-f]{64}$/);

  const ogg = previewAsset({
    assetId: 'door-sound',
    version: 2,
    contentHash: '1'.repeat(64),
    mediaType: 'audio/ogg',
    bytes: encodeOggVorbis(),
    engineVersion: ENGINE,
  });
  // OGG PCM decoding is not implemented, so it is never reported as playable.
  assert.equal(ogg.status, 'failed', ogg.detail);
  assert.equal(ogg.detail, 'OGG_PCM_DECODE_NOT_IMPLEMENTED');
  assert.equal(ogg.facts.pcmDecoded, false);
  assert.equal(ogg.facts.playable, false);
  assert.equal(ogg.facts.reason, 'ogg-pcm-decode-not-implemented');
  assert.match(ogg.facts.digest, /^[0-9a-f]{64}$/);
  report('audio', { wav: wav.status, ogg: ogg.status, oggReason: ogg.facts.reason });
});

test('Godot package preview is static only and reports missing references', () => {
  const good = new Map([
    ['scenes/door.tscn', new TextEncoder().encode(
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://scripts/door.gd" id="1"]\n[node name="Door" type="Node3D"]\n',
    )],
    ['scripts/door.gd', new TextEncoder().encode('extends Node3D\n')],
  ]);
  const ok = previewAsset({
    assetId: 'auto-door',
    version: 1,
    contentHash: '2'.repeat(64),
    mediaType: 'application/x-godot-package',
    files: good,
    engineVersion: ENGINE,
  });
  assert.equal(ok.status, 'ok', ok.detail);
  assert.equal(ok.facts.executed, false);

  const bad = new Map([
    ['scenes/door.tscn', new TextEncoder().encode(
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Texture2D" path="res://art/missing.png" id="1"]\n[node name="Door" type="Node3D"]\n',
    )],
  ]);
  const rejected = previewAsset({
    assetId: 'auto-door',
    version: 2,
    contentHash: '3'.repeat(64),
    mediaType: 'application/x-godot-package',
    files: bad,
    engineVersion: ENGINE,
  });
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.facts.executed, false);
  assert.equal(rejected.facts.missing, 1);
  report('package', { ok: ok.status, rejected: rejected.detail });
});

test('unsupported media types never report success', () => {
  const result = previewAsset({
    assetId: 'mystery',
    version: 1,
    contentHash: '4'.repeat(64),
    mediaType: 'image/webp',
    bytes: new Uint8Array([1, 2, 3]),
    engineVersion: ENGINE,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.detail, 'UNSUPPORTED_MEDIA_TYPE');
  report('unsupported', result);
});

test('the worker isolates decoding and honours a hard timeout', async () => {
  const bytes = encodePng(16, 16, (x, y) => [x * 15, y * 15, 0, 255]);
  const ok = await runPreviewInWorker({
    assetId: 'door-texture',
    version: 1,
    contentHash: '5'.repeat(64),
    mediaType: 'image/png',
    bytes,
    engineVersion: ENGINE,
  });
  assert.equal(ok.status, 'ok', ok.detail);

  const timedOut = await runPreviewInWorker(
    {
      assetId: 'door-texture',
      version: 1,
      contentHash: '5'.repeat(64),
      mediaType: 'image/png',
      bytes,
      engineVersion: ENGINE,
    },
    { timeoutMs: 0 },
  );
  assert.equal(timedOut.status, 'timeout');
  assert.equal(timedOut.detail, 'PREVIEW_TIMEOUT');
  report('worker', { ok: ok.status, timeout: timedOut.status });
});

test('the preview path contains no window, input, playback or engine calls', () => {
  const sources = ['preview-service.mjs', 'preview-worker.mjs', 'decode/image-decode.mjs', 'decode/audio-decode.mjs', 'decode/godot-package.mjs', 'decode/glb-render.mjs']
    .filter(name => fs.existsSync(path.join(assetDir, name)))
    .map(name => [name, fs.readFileSync(path.join(assetDir, name), 'utf8')]);
  assert.ok(sources.length >= 3);
  for (const [name, text] of sources) {
    for (const forbidden of [
      'document.',
      'window.',
      'requestPointerLock',
      'new Audio(',
      'new AudioContext(',
      'new OfflineAudioContext(',
      '.play(',
      'BrowserWindow',
      'child_process.spawn(',
      'fetch(',
    ]) {
      assert.equal(text.includes(forbidden), false, `${name} must not contain ${forbidden}`);
    }
  }
  report('static-safety', { files: sources.map(([name]) => name) });
});
