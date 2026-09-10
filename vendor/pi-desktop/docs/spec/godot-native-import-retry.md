# Bounded native import crash retry

Only a managed check job's import can automatically retry once after the pinned
engine exits with Windows access violation 0xc0000005. This is recovery, not a
claim that the engine crash's root cause has been fixed. The first failure,
source identity and complete task log remain recorded.

The broker must exit normally, report zero active job processes, validate its
own process/network isolation, preserve every claimed source byte, and verify
cleanup, profile removal, work removal and journal retirement. The sampled
resource policy must not have triggered. A subsequent recovery scan must have
no unknown/skipped entries. The private task log must be an ordinary file at the
exact owned path, match the receipt's full hash/length, and contain no script or
unknown runtime errors. A durable ledger records the consumed retry before a
fresh random task identity is allocated; failure to persist it prevents retry.

The repeated import still undergoes every original import, export, artifact and
actual runtime gate. A second crash is failed. Cancellation, timeout, malformed
transport, changed source, resource violations or unknown cleanup never retry.
There is no automatic export or application replay.

Protocol tests in `tests/godot-remaining/C/executor-protocol.mjs` distinguish the
scripted broker fixture from actual engine/client results. Preserve actual
failed-run reports and test `world.creationRetry` on the same owned failed
profile, followed by play/save/restart and unchanged other worlds. New clean
client runs do not substitute for that failed-profile recovery evidence.

`world.creationRetry` is an explicit main-window navigation action accepting
only the selected world ID. It cannot supply a source path, task, generation or
launch receipt. Copies, exports, candidate applications, restore and model turns
block it. The initializer reads the matching interrupted initialization task
and invokes the existing generation-bound task resume route before beginning a
new turn. Automatic status polling cannot authorize that resume. This preserves
the existing initialization draft and keeps model replay disabled. An existing
initialization attempt finishes before an explicit retry starts.

While an explicit retry is scheduled but Core still reports its previous
terminal failure, the client shows a separate `retry` preparation stage with
zero progress and only the details action. It does not mark any build stage as
passed or rewrite the durable failure. A newer Core build/confirmation state
supersedes this presentation. Concurrent requests for the same pending retry
share one recovery; asynchronous preparation errors become actionable status.

The `running` reply acknowledges in-process scheduling, not a committed Core
job or durable retry intent. A client closed before job submission can reopen
with the previous failure and require another explicit retry. Tests must wait
for a new attempt or a new terminal outcome, rather than interpreting the old
failure returned immediately after acknowledgement as the retry result.

The current pinned broker declares exactly two log records, `preflight.json`
and `task.log`. The retry guard verifies both ordinary files against their
bounded declared sizes and hashes, rejects duplicates/unknown declarations,
and requires the native JSON to match the receipt's complete six-check denial
observation. Identity sidecars in the same directory are separate records and
are not mistaken for additional declared logs. Only the engine log is parsed
for script errors. A single-log fixture does not represent this broker.
