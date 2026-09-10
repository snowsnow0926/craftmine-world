// Independent, headless preview worker (agent N).
//
// Runs one preview request in its own worker thread so a slow or hostile
// decoder cannot block the host. No window, no focus, no input, no playback and
// no shared data directory are used; the worker is stateless and only returns
// evidence for the Rust layer to record.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import { PREVIEW_TIMEOUT_MS } from './preview-service.mjs';

/**
 * Runs `request` in a worker with a hard timeout. A timeout or an abort signal
 * terminates the worker; it never reports success for an unfinished decode.
 * The caller (asset-service) owns the attempt claim, so a terminated worker's
 * late message can never be recorded.
 */
export function runPreviewInWorker(request, { timeoutMs = PREVIEW_TIMEOUT_MS, signal } = {}) {
  if (signal?.aborted) {
    return Promise.resolve({
      cacheKey: null,
      status: 'cancelled',
      detail: 'PREVIEW_CANCELLED',
      facts: { workerTerminated: false },
    });
  }
  // Main is bundled into index.js. Never spawn import.meta.url itself: that
  // would load the entire Electron Main module inside a Node worker.
  const worker = new Worker(fileURLToPath(new URL('./asset-preview-worker.js', import.meta.url)), {
    workerData: { previewRequest: request },
  });
  return new Promise(resolve => {
    let settled = false;
    let timer = null;
    let response = null;
    const terminate = () => {
      worker.terminate().catch(() => {});
    };
    const onAbort = () => {
      terminate();
      finish({
        cacheKey: null,
        status: 'cancelled',
        detail: 'PREVIEW_CANCELLED',
        facts: { workerTerminated: true },
      });
    };
    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve(value);
    };
    timer = setTimeout(() => {
      terminate();
      finish({
        cacheKey: null,
        status: 'timeout',
        detail: 'PREVIEW_TIMEOUT',
        facts: { workerTerminated: true },
      });
    }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    worker.once('message', message => {
      if (message?.ok) {
        response = message.result;
      } else {
        response = {
          cacheKey: null,
          status: 'failed',
          detail: String(message?.error || 'PREVIEW_FAILED').slice(0, 200),
          facts: {},
        };
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
        if (code === 0 && response !== null) { finish(response); return; }
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
