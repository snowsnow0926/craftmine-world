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
const CACHE_KEY = 'c'.repeat(64);

function harness({
  beginStatus = 'pending',
  cached = false,
  retried = false,
  evidence,
  runner,
} = {}) {
  const calls = [];
  const claim = { claimId: 'f'.repeat(64), attempt: retried ? 2 : 1, owner: 'test', deadline: 0 };
  // Models the real core: the claim is single-use. The first finish applies and
  // clears it; any later finish for the same slot is a stale attempt.
  const state = { activeClaim: true };
  const call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'asset.previewBegin') {
      const live = cached && beginStatus !== 'pending' ? null : claim;
      return {
        jobId: 'apv-1',
        cacheKey: CACHE_KEY,
        cached,
        retried,
        resumed: false,
        timeoutMs: 20000,
        claim: live,
        preview: { status: beginStatus, detail: '', facts: {}, createdAt: 1, attempt: live?.attempt ?? 1 },
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
      if (!state.activeClaim) {
        return {
          applied: false,
          stale: true,
          reason: 'STALE_PREVIEW_ATTEMPT',
          status: payload.status,
          attempt: payload.attempt,
        };
      }
      state.activeClaim = false;
      return { applied: true, stale: false, status: payload.status, attempt: payload.attempt };
    }
    return {};
  };
  const defaultRunner = async (request, options) => {
    calls.push({ method: 'runPreview', payload: { request, options } });
    return evidence ?? {
      cacheKey: CACHE_KEY,
      status: 'ok',
      detail: 'png 8x4',
      facts: { decoder: 'image-decode.mjs@1', digest: DIGEST, thumbnailBase64: THUMBNAIL, picture: true, playable: false },
    };
  };
  const runPreview = runner ?? defaultRunner;
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

test('preview decodes the exact body and records evidence against the claim', async () => {
  const { service, calls } = harness();
  const result = await service.preview({ assetId: 'door-texture', version: 1, engineVersion: '4.7.2-stable' });
  assert.equal(result.status, 'ok');
  assert.equal(result.facts.thumbnailBase64, THUMBNAIL);
  assert.equal(result.applied, true);
  assert.equal(result.stale, false);
  const methods = calls.map(entry => entry.method);
  assert.deepEqual(methods, [
    'asset.read',
    'asset.previewBegin',
    'asset.bodyPath',
    'readFile',
    'runPreview',
    'asset.previewFinish',
  ]);
  const finish = calls.at(-1).payload;
  assert.equal(finish.status, 'ok');
  assert.equal(finish.facts.decoder, 'image-decode.mjs@1');
  assert.equal(finish.facts.digest, DIGEST);
  // The attempt identity is issued by the core and echoed by the service: a
  // retry can never replay the previous attempt's operation.
  assert.equal(finish.claimId, 'f'.repeat(64));
  assert.equal(finish.attempt, 1);
  assert.equal(finish.operationId, `preview-${CACHE_KEY}-a1-${'f'.repeat(64)}`);
  const run = calls.find(entry => entry.method === 'runPreview');
  assert.equal(run.payload.request.contentHash, DIGEST, 'the version content hash is used, not the file hash');
  assert.equal(run.payload.request.mediaType, 'image/png');
  assert.equal(run.payload.request.attempt, 1);
  assert.equal(run.payload.options.timeoutMs, 20000);
});

test('a cached ok preview does not re-run the decoder and has no claim', async () => {
  const { service, calls } = harness({ beginStatus: 'ok', cached: true });
  const result = await service.preview({ assetId: 'door-texture', version: 1 });
  assert.equal(result.cached, true);
  assert.equal(calls.filter(entry => entry.method === 'runPreview').length, 0);
  assert.equal(calls.filter(entry => entry.method === 'asset.previewFinish').length, 0);
});

test('a failed preview is retried as a new attempt with a new claim', async () => {
  const { service, calls } = harness({ beginStatus: 'timeout', cached: false, retried: true });
  const result = await service.preview({ assetId: 'door-texture', version: 1 });
  assert.equal(result.retried, true);
  assert.equal(result.attempt, 2);
  assert.equal(calls.filter(entry => entry.method === 'runPreview').length, 1);
  const finish = calls.at(-1).payload;
  assert.equal(finish.status, 'ok');
  assert.equal(finish.attempt, 2, 'the retry records against the new attempt');
});

test('a worker failure is recorded as failed, never as ok', async () => {
  const { service, calls } = harness({
    evidence: { cacheKey: CACHE_KEY, status: 'failed', detail: 'OGG_PCM_DECODE_NOT_IMPLEMENTED', facts: { playable: false } },
  });
  const result = await service.preview({ assetId: 'door-sound', version: 1 });
  assert.equal(result.status, 'failed');
  assert.equal(calls.at(-1).payload.status, 'failed');
  assert.equal(calls.at(-1).payload.facts.playable, false);
});

test('cancel terminates the live worker and a late result is discarded', async () => {
  let sawAbort = false;
  let markStarted; const started = new Promise(resolve=>markStarted=resolve);
  const runner = (request, options) =>
    new Promise(resolve => {
      const aborted = () => {
        sawAbort = true;
        resolve({ status: 'cancelled', detail: 'PREVIEW_CANCELLED', facts: { workerTerminated: true } });
      };
      // The cancel can arrive before the worker starts: an already-aborted
      // signal must terminate immediately instead of decoding.
      if (options.signal.aborted) {
        aborted();
        return;
      }
      options.signal.addEventListener('abort', aborted, { once: true });
      markStarted();
    });
  const { service, calls } = harness({ runner });
  const pending = service.preview({ assetId: 'door-texture', version: 1 });
  await started;
  const cancelled = await service.cancel({ assetId: 'door-texture', version: 1, detail: 'world switched' });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.applied, true);
  assert.equal(cancelled.abortSignalled, true);
  const late = await pending;
  assert.equal(sawAbort, true, 'the worker runner must be aborted');
  assert.equal(late.applied, false, 'the late worker result must not be recorded');
  assert.equal(late.stale, true);
  assert.equal(late.reason, 'STALE_PREVIEW_ATTEMPT');
  const finishes = calls.filter(entry => entry.method === 'asset.previewFinish').map(entry => entry.payload);
  assert.equal(finishes.length, 2);
  assert.equal(finishes[0].status, 'cancelled');
  assert.equal(finishes[0].claimId, 'f'.repeat(64));
  assert.equal(finishes[0].detail, 'world switched');
});

test('cancel never rewrites a cached ok preview', async () => {
  const { service, calls } = harness({ beginStatus: 'ok', cached: true });
  const result = await service.cancel({ assetId: 'door-texture', version: 1 });
  assert.equal(result.cancelled, false);
  assert.equal(result.reason, 'NO_ACTIVE_ATTEMPT');
  assert.equal(calls.filter(entry => entry.method === 'asset.previewFinish').length, 0);
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
