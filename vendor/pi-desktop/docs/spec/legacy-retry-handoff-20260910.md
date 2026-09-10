# Legacy bridge retry acceptance: bounded scheduling handoff

The actual 688 package run `desktop-native-lr-xkLzVU` failed at the test's
immediate assertion after `world.creationRetry` acknowledged scheduling.
The entire returned world row was identical to the previous failed row,
including its timestamp, initialization operation, confirm stage and error.
The test then quit before a new import/export reached the executor ledger.
The original result remains failed; it is not product recovery evidence.

The tracked driver now records the full failed baseline and verifies it again
immediately before dispatch. It increments and persists `retryCalls` before
exactly one mutation and checks the scheduling reply's world and status.
Only an identical old failed row may remain visible for strictly less than
30 seconds before any preparing observation. A changed failed row, another
world, missing row, cancelled/interrupted/unknown status, or expired handoff
is an immediate test failure. Once initializing/checking has been observed,
even the original failed row fails immediately. No mutation is repeated.

Baseline, scheduling receipt, transition observations and the last failure
row are retained in the report. A ready projection only advances the test:
the existing actual runtime, pixels, independent Core new-job/candidate and
applied-build assertions must still pass. Both bridge hashes, old source
revision, original aborted application, managed file inventory, complete
saved progress and restart checks remain unchanged. Strict native exit and
input-isolation audits remain mandatory.

`node --test tests/player-feedback/P1/legacy-retry-handoff.test.mjs` covers
the pure classification boundary and executes the actual checked-in retry
step under controlled callbacks. It covers one dispatch through old/preparing/
ready, new failures, failed-after-preparing, changed pre-dispatch baseline,
and wrong-world acknowledgment. It performs no model, native, UI or input
operation. Actual recovery must be rerun on the next immutable package.
