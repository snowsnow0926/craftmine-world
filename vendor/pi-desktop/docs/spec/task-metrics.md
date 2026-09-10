# Durable task metrics

One operation is one existing host-core `sessionId` + `turnId`, opened by
`session.beginTurn` and closed by `session.endTurn`. It includes that operation's
agent attempts, delegated attempts and automatic compaction calls. It does not
include unrelated one-shot completions or another user submission.

`packages/shared/src/task-metrics.ts` defines the renderer DTO. The private
`session.observeModelCall {sessionId,turnId,call}` records finite `model_call`
events. Calls have independent UUIDs per actual stream factory invocation,
including retries hidden behind a reused assistant bubble. Start/end replay is
idempotent; differing terminal receipts are conflicts. Ownership never falls
back to the currently selected session or current active turn.

`session.turnMetrics {sessionId,turnId?,messageId?}` returns a `TaskMetrics` or
null. At most one selector is allowed; without one it selects the latest turn.
A message selector resolves its stored owning turn. The renderer cannot submit
usage, paths, timestamps or model bindings. Main owns the private write route.

Coverage is `complete` only when every observed call has terminal provider usage;
`partial` when at least one has usage and another does not; otherwise `unknown`.
Running snapshots are explicitly still running, even when usage so far is complete.
Zero observed calls is unknown, not a fabricated zero-cost operation. Legacy
turns without call observations remain unknown. No character estimate is part of
this exact ledger. Provider-normalized total includes its cache accounting;
reasoning and cache components are not added again. The old subagent rollup is
not added to these per-call records.

TPS is measured output tokens divided by corresponding generation milliseconds.
Only matched terminal usage/timing pairs contribute. No mean of rates, division
by task wall time, or speed addition is allowed. Overlapping measured generation
intervals make the aggregate TPS unavailable; per-model groups remain available
where their own intervals are sequential. Missing timing makes coverage partial
or unknown. The declared model identity is the runtime binding used for each
call, not an assertion about a gateway's undisclosed backend model.

Wall time is the durable turn start through end, or observation time while
running. Backwards clocks and interrupted runs whose actual end is unavailable
must not invent a duration. Runtime generation time is separate from tool/wait
time. Errors, aborts and process restarts preserve recorded usage and ownership.

## Main integration (P10)

Consume `model_call` before parent-only event filtering. Persist observations in
a per-(sessionId,turnId) ordered queue with the envelope's explicit identity,
including child envelopes carrying `parentToolCallId`. Never substitute the
current active turn. Await the queue before `session.endTurn`; expose only the
read query to renderer IPC. Preserve write failures as unavailable/partial
accounting, never manufacture success. A failed write queue must be retried with
the exact call receipt or surfaced; do not silently drop it. P5 consumes only the
host DTO, not another UI accumulator. No model network request is required for
validation of this contract.
