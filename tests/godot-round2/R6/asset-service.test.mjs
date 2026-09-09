// R6 asset service tests: pure logic with a fake core and a fake worker.
// No window, no input, no audio playback and no real core process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAssetService } from '../../../plugins/craftmine-world/asset-service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const serviceSource = fs.readFileSync(
  path.join(root, 'plugins', 'craftmine-world', 'asset-service.mjs'),
  'utf8',
);

const DIGEST = 'b'.repeat(64);
const THUMBNAIL = Buffer.from('fake-png').toString('base64');

function harness({ beginStatus = 'pending', cached = false, retried = false, evidence } = {}) {
  const calls = [];
  const call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'asset.previewBegin') {
      return {
        jobId: 'apv-1',
        cacheKey: 'c'.repeat(64),
        cached,
        retried,
        timeoutMs: 20000,
        preview: { status: beginStatus, detail: '', facts: {}, createdAt: 1 },
      };
    }
    if (method === 'asset.read') {
      return {
        version_: {
          assetId: payload.assetId,
          version: payload.version,
          contentHash: DIGEST,
          files: [{ path: 'textures/door.png', sha256: DIGEST, bytes: 9, mediaType: 'image/png' }],
        },
        state: {},
      };
    }
    if (method === 'asset.bodyPath') {
      return { blobPath: 'C:/store/blob', sha256: DIGEST, bytes: 9, mediaType: 'image/png' };
    }
    if (method === 'asset.previewFinish') {
      return { status: payload.status, detail: payload.detail };
    }
    return {};
  };
  const runPreview = async (request, options) => {
    calls.push({ method: 'runPreview', payload: { request, options } });
    return evidence ?? {
      cacheKey: 'c'.repeat(64),
      status: 'ok',
      detail: 'png 8x4',
      facts: { decoder: 'image-decode.mjs@1', digest: DIGEST, thumbnailBase64: THUMBNAIL, picture: true, playable: false },
    };
  };
  const readFile = async blobPath => {
    calls.push({ method: 'readFile', payload: blobPath });
    return new Uint8Array([1, 2, 3]);
  };
  return { service: createAssetService({ call, runPreview, readFile }), calls };
}

test('read-only channels are forwarded unchanged to the core', async () => {
  const { service, calls } = harness();
  await service.search({ scope: 'local-library', offset: 0, limit: 20 });
  await service.read({ assetId: 'door-texture', version: 1 });
  await service.versions({ assetId: 'door-texture', offset: 0, limit: 10 });
  await service.scan({ sourceRoot: 'C:/player' });
  assert.deepEqual(
    calls.map(entry => entry.method),
    ['asset.search', 'asset.read', 'asset.versions', 'asset.scan'],
  );
  await assert.rejects(() => service.preview({ version: 1 }), /ASSETID_REQUIRED/);
  await assert.rejects(() => service.preview({ assetId: 'x', version: 0 }), /VERSION_REQUIRED/);
});

test('preview decodes the exact body and records real evidence', async () => {
  const { service, calls } = harness();
  const result = await service.preview({ assetId: 'door-texture', version: 1, engineVersion: '4.7.2-stable' });
  assert.equal(result.status, 'ok');
  assert.equal(result.facts.thumbnailBase64, THUMBNAIL);
  const methods = calls.map(entry => entry.method);
  assert.deepEqual(methods, [
    'asset.previewBegin',
    'asset.read',
    'asset.bodyPath',
    'readFile',
    'runPreview',
    'asset.previewFinish',
  ]);
  const finish = calls.at(-1).payload;
  assert.equal(finish.status, 'ok');
  assert.equal(finish.facts.decoder, 'image-decode.mjs@1');
  assert.equal(finish.facts.digest, DIGEST);
  assert.equal(finish.operationId, `preview-${'c'.repeat(64)}`);
  const run = calls.find(entry => entry.method === 'runPreview');
  assert.equal(run.payload.request.contentHash, DIGEST, 'the version content hash is used, not the file hash');
  assert.equal(run.payload.request.mediaType, 'image/png');
  assert.equal(run.payload.options.timeoutMs, 20000);
});

test('a cached ok preview does not re-run the decoder', async () => {
  const { service, calls } = harness({ beginStatus: 'ok', cached: true });
  const result = await service.preview({ assetId: 'door-texture', version: 1 });
  assert.equal(result.cached, true);
  assert.equal(calls.filter(entry => entry.method === 'runPreview').length, 0);
});

test('a failed preview is retried instead of staying locked', async () => {
  const { service, calls } = harness({ beginStatus: 'timeout', cached: false, retried: true });
  const result = await service.preview({ assetId: 'door-texture', version: 1 });
  assert.equal(result.retried, true);
  assert.equal(calls.filter(entry => entry.method === 'runPreview').length, 1);
  assert.equal(calls.at(-1).payload.status, 'ok');
});

test('a worker failure is recorded as failed, never as ok', async () => {
  const { service, calls } = harness({
    evidence: { cacheKey: 'c'.repeat(64), status: 'failed', detail: 'OGG_PCM_DECODE_NOT_IMPLEMENTED', facts: { playable: false } },
  });
  const result = await service.preview({ assetId: 'door-sound', version: 1 });
  assert.equal(result.status, 'failed');
  assert.equal(calls.at(-1).payload.status, 'failed');
  assert.equal(calls.at(-1).payload.facts.playable, false);
});

test('cancel records a cancelled state through a claimed slot', async () => {
  const { service, calls } = harness();
  await service.cancel({ assetId: 'door-texture', version: 1, detail: 'world switched' });
  assert.deepEqual(calls.map(entry => entry.method), ['asset.previewBegin', 'asset.previewFinish']);
  assert.equal(calls.at(-1).payload.status, 'cancelled');
  assert.equal(calls.at(-1).payload.detail, 'world switched');
});

test('the asset service contains no window, input or playback calls', () => {
  for (const forbidden of [
    'requestPointerLock',
    'document.',
    'window.',
    'new Audio(',
    'new AudioContext(',
    '.play(',
    'BrowserWindow',
    'dispatchEvent(',
  ]) {
    assert.equal(serviceSource.includes(forbidden), false, `asset-service.mjs must not contain ${forbidden}`);
  }
});
