# Ordinary player task accounting

New Craftmine task owners default to `maxRequests: null`, `maxCompactions: null`,
`maxTokens: null`, and `deadlineAt: null`. This applies to the ordinary product
path, independently of acceptance flags or provider choice. Null means no
cumulative boundary of that kind. Accounting, unknown-usage reservations,
single-request context capacity, cancellation, ownership and generation gates
remain enforced. Numeric policies remain supported for explicit callers.

The plugin forwards Rust's complete policy. It never injects a 30-minute task
deadline and cannot widen a configured policy through acceptance environment
flags. A lost reservation reply retains the same request and policy.

## Existing task owners

Startup and backup migration preserve stored policies, including old 80-request,
8-compaction and one-million-token defaults. Those records lack reliable origin
metadata; matching a number cannot establish player authorization to replace it.
Ordinary continuation keeps the same owner, accounting and limits. New unrelated
tasks use the new default. Failed turns remain in the transcript and journal.

For an interrupted current task with an actually exhausted request, compaction or
deadline boundary, the player can explicitly release local execution limits.
`budget.releaseExecutionLimits` accepts exactly `projectId`, `sessionId`,
`worldId`, `taskId`, `generation`, and `operationId` (non-empty, at most 160 bytes).
The host binds the player action; the model cannot invoke it. Rust checks the
current head, world, generation, cancelled/interrupted state and exhausted
durable counters before the transaction. It sets requests, compactions and the
deadline to null, preserves `maxTokens`, and records an immutable receipt with
previous/new limits, exhaustion reasons, original binding and complete current
accounting. No raw limits or provider operation are accepted. Existing ordinary
resume follows only after the release receipt is confirmed.

Exact action replay returns its receipt; altered arguments fail. Read-only
`budget.findExecutionReleaseReceipt` accepts the same identity and can retrieve
the historical receipt after resume changes the head. It never permits another
mutation against an old task. A missing receipt returns null. Neither action is
part of `budget_call`, the model tool list, or the sidecar request allowlist.

An explicit token budget can still prevent the resumed request. Releasing local
execution limits does not imply permission to change that budget.

Validation: durable Core tests cover request 81, compaction 9, restart,
idempotence, preserved old policies, player release, exhausted-token preservation,
foreign identity rejection, stale-head fencing and historical receipt retrieval.
