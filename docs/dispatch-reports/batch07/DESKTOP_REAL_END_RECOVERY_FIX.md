# Real host error lifecycle recovery

This P1 follow-up fixes the actual `workspace.endTurn(error|aborted)` lifecycle, which previously cancelled a task and released its lease without marking it recoverable. A player could remove an exhausted token allowance but still could not resume the same task budget owner.

## Change

Rust now records the first host end result as authoritative. For a running current session head with recovery `none`, an error/abort atomically sets task status `cancelled`, recovery `interrupted`, revokes that task's pending verification/review/application work, and releases its writer lease. Completed turns remain finished. Repeated or conflicting later lifecycle delivery does not turn a completed task into a failed/recoverable one. There is no extra Main-side before-end hook and no model replay.

Pending usage remains reserved at end so legitimate late host settlements still work. Startup converts any unreturned reservations to unknown without clearing their estimated charge, as before. Existing actual and unknown usage, requirements, draft and budget owner are preserved. A normal new workspace turn is explicitly rejected until the player resumes or discards the interrupted task.

Startup additionally repairs old-release records only when all evidence matches: the task is cancelled, is the current session/world/project head, has recovery `none`, and has a durable matching `craftmine_ended_turns` row marked `error` or `aborted`. Completed, discarded, resumed/noncurrent tasks and cancelled rows lacking ended-turn proof are not revived. Repair is idempotent and never restarts a model.

## Validation

- Full Rust library: **57/57 passed**.
- Host/domain Node regression: **10/10 passed**, including three actual Rust-process integrations.
- New actual process/gateway regression uses no `task.interrupt`: limit 120, actual usage 20, pending reservation 100, next request exhausts the finite allowance, actual `workspace.endTurn(error)`, process restart, player `task.budget` to unlimited, then gateway `task.resume`. It retains budget owner, actual 20, unknown reservation 100, original draft hash and goal, while advancing generation once. An ordinary prompt cannot reset the account first.
- Rust tests simulate old database rows across reopen and exercise only proven current failed heads; completed/discarded/old-head/no-ended-row controls remain excluded. First-result lifecycle idempotence is tested for completed/error/aborted.
- One old durable test assumed ordinary workspace creation after abort. It now asserts `EXPLICIT_RECOVERY_REQUIRED`, explicitly resumes, then tests discard on the resulting generation. Its original settlement/late-write/draft-retention assertions remain.

Production Rust was built directly with existing integrated private routes; no overlay was used. Evidence is in `evidence/desktop-real-end-rust-tests.txt`, `desktop-real-end-domain-tests.txt`, and `desktop-real-end-hashes.json`. This is an actual Rust endpoint plus gateway test with host callbacks as fixtures, not a live provider/UI automation or fresh-Windows claim. No user data was opened or changed.
