import assert from 'node:assert/strict';

/** An OS exit code is necessary, but does not prove owned teardown completed. */
export function assertCleanHeadlessShutdown(launch) {
  assert.equal(launch.exit?.code,0,'Client must exit zero');
  assert.ok(!launch.forcedStop,'Client must not require forced stop');
  assert.deepEqual(launch.audit?.violations,[],'Input isolation violations');
  assert.deepEqual(launch.audit?.pageErrors,[],'Renderer errors');
  assert.deepEqual(launch.audit?.shutdownFailures,[],'Owned shutdown is incomplete or unaudited');
}
