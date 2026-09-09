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

/** Minimal static GLB with one triangle. */
function encodeGlb() {
  const positions = Buffer.alloc(9 * 4);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(3 * 2);
  [0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const binary = Buffer.concat([positions, indices]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Triangle' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length },
    ],
    buffers: [{ byteLength: binary.length }],
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
  assert.match(decoded.digest, /^[0-9a-f]{64}$/);
  const result = previewAsset({
    assetId: 'auto-door',
    version: 1,
    contentHash: 'd'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes,
    engineVersion: ENGINE,
  });
  assert.equal(result.status, 'partial', result.detail);
  assert.equal(result.facts.triangles, 1);
  assert.equal(result.facts.picture, false);
  assert.equal(result.facts.rendered, false);
  assert.equal(result.facts.renderReason, 'model-render-not-implemented');
  const broken = Buffer.from(bytes);
  broken.writeUInt32LE(999999, 8);
  const failed = previewAsset({
    assetId: 'auto-door',
    version: 2,
    contentHash: 'e'.repeat(64),
    mediaType: 'model/gltf-binary',
    bytes: broken,
    engineVersion: ENGINE,
  });
  assert.equal(failed.status, 'failed');
  report('glb', { ok: result.facts, broken: failed.detail });
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
  const sources = ['preview-service.mjs', 'preview-worker.mjs', 'decode/image-decode.mjs', 'decode/audio-decode.mjs', 'decode/godot-package.mjs']
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
