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
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let stopTimer = null;
    let response = null;
    let stopping = null;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      if (stopTimer !== null) clearTimeout(stopTimer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const terminate = value => {
      if (settled || stopping !== null) return;
      stopping = value;
      if (timer !== null) clearTimeout(timer);
      // A termination request is not proof of termination. Keep ownership until
      // exit; fail explicitly if the platform cannot confirm it within 5 s.
      stopTimer = setTimeout(() => {
        if (settled) return;
        settled = true; cleanup();
        reject(Error('ASSET_PREVIEW_WORKER_STOP_TIMEOUT'));
      }, 5000);
      worker.terminate().catch(() => {
        // The exit event may still arrive. Otherwise the bounded stop timer
        // rejects; never convert a rejected terminate request into success.
      });
    };
    const onAbort = () => {
      terminate({
        cacheKey: null,
        status: 'cancelled',
        detail: 'PREVIEW_CANCELLED',
        facts: {},
      });
    };
    const finish = value => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    timer = setTimeout(() => {
      terminate({
        cacheKey: null,
        status: 'timeout',
        detail: 'PREVIEW_TIMEOUT',
        facts: {},
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
      terminate({
        cacheKey: null,
        status: 'failed',
        detail: String(error?.message || error).slice(0, 200),
        facts: {},
      });
    });
    worker.once('exit', code => {
      if (!settled) {
        if (stopping !== null) {
          finish({...stopping, facts: {...stopping.facts, workerTerminated: true, workerExitCode: code}});
          return;
        }
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
