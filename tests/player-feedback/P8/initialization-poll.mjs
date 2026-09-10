import { setTimeout as delay } from 'node:timers/promises';

// World creation is a mutating operation and is never retried. The poll that
// follows it is a read, and the plugin's core client gives every read 5000 ms
// (`core-client.cjs` rejects with exactly this message). A world that is still
// doing its first build/check can therefore make a perfectly healthy list read
// time out, which must not be mistaken for "the world failed to build".
//
// This module owns that distinction and nothing else: it only ever calls the read
// callback it is given, it retries only the one precisely identified transient
// error, and it stops on the overall deadline. A terminal state, a different
// error, or an expired deadline is reported as it is.
export const INITIALIZATION_DEADLINE_MS = 900000;
/** The one transient error, matched exactly: the product's read timeout, with or
 * without the `Error: ` prefix the host may add when it serialises it. */
export const TRANSIENT_READ_TIMEOUT = /^(?:Error: )?Craftmine Rust request timed out$/;
const TERMINAL_STATES = Object.freeze(['failed', 'cancelled', 'interrupted']);

export function isTransientReadTimeout(error) {
  // Only a real Error carrying exactly the product's read-timeout message counts.
  // A thrown string, a wrapped timeout, or a timeout from another subsystem is not
  // this error and is reported as it is.
  if (!(error instanceof Error) || typeof error.message !== 'string') return false;
  return TRANSIENT_READ_TIMEOUT.test(error.message);
}
export function terminalState(row) {
  const state = row && typeof row.state === 'string' ? row.state : null;
  return state !== null && TERMINAL_STATES.includes(state) ? state : null;
}

/**
 * Poll `read()` until the requested world reports `ready`.
 *
 * `read` must be a read-only navigation call. `deadline` is an absolute
 * millisecond timestamp for the whole step, so retries never extend the budget.
 */
export async function pollWorldInitialization({ read, worldId, deadline, retryDelayMs = 1000, sleep = ms => delay(ms), now = () => Date.now(), onRetry = () => {} }) {
  if (typeof read !== 'function' || typeof worldId !== 'string' || !worldId) throw Error('P8_INITIALIZATION_CONFIGURATION');
  if (!Number.isFinite(deadline)) throw Error('P8_INITIALIZATION_DEADLINE_REQUIRED');
  let reads = 0, retries = 0, last = null, lastError = null;
  for (;;) {
    if (now() >= deadline) throw Error('P8_INITIALIZATION_TIMEOUT:' + JSON.stringify({ worldId, reads, retries, lastState: last?.state ?? null, lastError }));
    reads += 1;
    let rows;
    try { rows = await read(); lastError = null; }
    catch (error) {
      if (!isTransientReadTimeout(error)) throw error;
      retries += 1; lastError = String(error.message ?? error);
      onRetry({ attempt: reads, message: lastError });
      // A retry never extends the deadline: the loop re-checks it on entry.
      if (now() + retryDelayMs > deadline) throw Error('P8_INITIALIZATION_TIMEOUT:' + JSON.stringify({ worldId, reads, retries, lastState: last?.state ?? null, lastError }));
      await sleep(retryDelayMs);
      continue;
    }
    last = (Array.isArray(rows?.worlds) ? rows.worlds : []).find(row => row?.id === worldId) ?? null;
    const state = terminalState(last);
    if (state) throw Error('P8_INITIALIZATION_TERMINAL:' + state + ':' + JSON.stringify(last));
    if (last?.state === 'ready') return { row: last, reads, retries };
    await sleep(retryDelayMs);
  }
}
