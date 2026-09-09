// Independent, headless preview worker (agent N).
//
// Runs one preview request in its own worker thread so a slow or hostile
// decoder cannot block the host. No window, no focus, no input, no playback and
// no shared data directory are used; the worker is stateless and only returns
// evidence for the Rust layer to record.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import { PREVIEW_TIMEOUT_MS, previewAsset } from './preview-service.mjs';

if (!isMainThread && workerData?.previewRequest) {
  try {
    parentPort.postMessage({ ok: true, result: previewAsset(workerData.previewRequest) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.message || error) });
  }
}

/**
 * Runs `request` in a worker with a hard timeout. A timeout or cancel
 * terminates the worker; it never reports success for an unfinished decode.
 */
export function runPreviewInWorker(request, { timeoutMs = PREVIEW_TIMEOUT_MS } = {}) {
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: { previewRequest: request },
  });
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      finish({
        cacheKey: null,
        status: 'timeout',
        detail: 'PREVIEW_TIMEOUT',
        facts: {},
      });
    }, timeoutMs);
    timer.unref?.();
    worker.once('message', message => {
      worker.terminate().catch(() => {});
      if (message?.ok) {
        finish(message.result);
      } else {
        finish({
          cacheKey: null,
          status: 'failed',
          detail: String(message?.error || 'PREVIEW_FAILED').slice(0, 200),
          facts: {},
        });
      }
    });
    worker.once('error', error => {
      finish({
        cacheKey: null,
        status: 'failed',
        detail: String(error?.message || error).slice(0, 200),
        facts: {},
      });
    });
    worker.once('exit', code => {
      if (!settled) {
        finish({
          cacheKey: null,
          status: 'failed',
          detail: `WORKER_EXIT_${code}`,
          facts: {},
        });
      }
    });
  });
}
