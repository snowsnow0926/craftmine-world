import assert from 'node:assert/strict';

/** A scheduling acknowledgment can precede the first new initialization read.
 * Only the exact prior failure may remain visible during that bounded handoff.
 * This is a test observation rule; it never retries or changes product state. */
export function classifyLegacyRetryHandoff(row, baseline, elapsedMs, seenPreparing) {
  assert.ok(baseline?.id && baseline.state === 'failed', 'LEGACY_FAILED_BASELINE_REQUIRED');
  assert.equal(row?.id, baseline.id, 'LEGACY_WORLD_IDENTITY_CHANGED');
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0, 'LEGACY_HANDOFF_TIME_INVALID');
  if (row.state === 'ready') return 'ready';
  if (['initializing', 'checking'].includes(row.state)) return 'preparing';
  if (!seenPreparing && elapsedMs < 30000 && row.state === 'failed' && JSON.stringify(row) === JSON.stringify(baseline)) return 'old-failed-handoff';
  throw Error('LEGACY_NEW_FAILURE_OR_HANDOFF_TIMEOUT:' + JSON.stringify(row));
}
