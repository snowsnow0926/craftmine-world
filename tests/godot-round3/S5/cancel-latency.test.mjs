/**
 * S5 measurement: real preview-worker cancellation latency and memory.
 *
 * The worker runs in its own thread, headless, with no window, focus or input.
 * The cancel path is an AbortSignal that terminates the worker; this test
 * records the actual latency and the process RSS delta instead of asserting a
 * hand-picked number.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { runPreviewInWorker } from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/preview-worker.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');

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

/** Deterministic RGBA PNG of the requested size (no random, no time). */
function png(width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 4;
      raw[at] = (x * 7 + y * 3) & 0xff;
      raw[at + 1] = (x * 5) & 0xff;
      raw[at + 2] = (y * 11) & 0xff;
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

function previewRequest(bytes) {
  return {
    assetId: 'cancel-latency',
    version: 1,
    contentHash: 'a'.repeat(64),
    mediaType: 'image/png',
    path: 'textures/large.png',
    bytes: new Uint8Array(bytes),
    engineVersion: '5.0',
    settingsHash: 'default',
  };
}

test('cancelling a live preview worker terminates it and reports the latency', async () => {
  const bytes = png(1024, 1024);
  const controller = new AbortController();
  const rssBefore = process.memoryUsage().rss;
  const started = Date.now();
  const pending = runPreviewInWorker(previewRequest(bytes), {
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  // Give the worker a real chance to start decoding before the player cancels.
  await new Promise(resolve => setTimeout(resolve, 15));
  controller.abort(new Error('PREVIEW_CANCELLED'));
  const result = await pending;
  const latencyMs = Date.now() - started;
  const rssDelta = process.memoryUsage().rss - rssBefore;
  console.log(
    `[measure] preview worker cancel: latency=${latencyMs}ms rssDelta=${Math.round(rssDelta / 1024)}KiB bytes=${bytes.length}`,
  );
  assert.equal(result.status, 'cancelled');
  assert.equal(result.detail, 'PREVIEW_CANCELLED');
  assert.equal(result.facts.workerTerminated, true);
  // A cancel must not wait for the 30 s timeout.
  assert.ok(latencyMs < 5_000, `cancel latency ${latencyMs}ms must be far below the timeout`);
});

test('a preview cancelled before the worker starts never decodes', async () => {
  const bytes = png(64, 64);
  const controller = new AbortController();
  controller.abort(new Error('PREVIEW_CANCELLED'));
  const started = Date.now();
  const result = await runPreviewInWorker(previewRequest(bytes), {
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  const latencyMs = Date.now() - started;
  console.log(`[measure] preview worker pre-start cancel: latency=${latencyMs}ms`);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.facts.workerTerminated, false, 'no worker was started');
  assert.ok(latencyMs < 1_000);
});

test('the cancellation path uses no window, input or playback API', async () => {
  const source = await import('node:fs').then(fs =>
    fs.readFileSync(
      path.join(root, 'vendor', 'pi-desktop', 'apps', 'desktop', 'electron', 'craftmine-assets', 'preview-worker.mjs'),
      'utf8',
    ),
  );
  for (const forbidden of ['BrowserWindow', 'requestPointerLock', 'new Audio(', 'dispatchEvent(', 'document.']) {
    assert.equal(source.includes(forbidden), false, `preview-worker.mjs must not contain ${forbidden}`);
  }
});
