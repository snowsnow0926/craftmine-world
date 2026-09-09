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
