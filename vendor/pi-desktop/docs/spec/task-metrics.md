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
The actual window starts at the first text, thinking or tool-call delta and ends
at the terminal provider event. It includes any terminal-response latency; it is
not a claim about hidden backend compute time. Result-only calls and streams
without a delta keep known token usage but have unknown generation time.
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

`createTaskMetricsRecorder({call,isCurrent})` in
`apps/desktop/electron/main/task-metrics-recorder.ts` exposes `observe(envelope)`,
`drain({sessionId,turnId})` and `release(identity)`. Main calls observe before
delegation filters; every completion, error and cancellation path drains before
endTurn and releases only after settlement. The host call adapter must preserve
its existing finite RPC timeout. A lost reply gets one exact retry. Permanent
refusal is followed by private `session.metricsUnavailable {sessionId,turnId}`;
this stores a durable gap and drain returns `{complete:false,errors}`. If even
the gap write fails, drain rejects. Main must surface this persistence failure,
not silently present complete statistics or substitute another active turn.
The required `isCurrent(identity)` compares the exact envelope session/turn with
Main's registered active ownership. It only admits or ignores; it never replaces
an identity. After settlement Main releases the queue and removes that ownership
without an intervening asynchronous operation. Old late events cannot recreate
released queues, even after hundreds of old sessions. Current root-owned child
model events remain admitted regardless of `parentToolCallId`. Main also records
admission failures only for that same current identity, avoiding an old-turn set
leak. No unbounded tombstone history is needed.

Processing continues after a failed write and failed durable-gap attempt: the
queue's processing tail remains fulfilled, while a separate per-turn failure
latch makes every later drain reject. Healthy events appended during that failure
are still persisted. A later successful write cannot erase the failed gap or
make accounting appear complete. Drain follows the newest appended queue tail
before reporting the latched failure.
Main can still close that task with private `session.endTurn` and the optional
strict boolean `metricsUnavailable:true`. The original terminal transaction then
also inserts the gap. Replaying a closed turn retains the same gap but cannot
replace its terminal status or timestamp. This is the fallback for drain rejection
or synchronous observation admission failure. If that whole transaction fails,
the end receipt remains a failure: do not pretend either write succeeded.
Synchronous identity/queue admission errors also require an explicit failure
surface; they must not be ignored. Renderer query methods do not expose writes.

Storage uses additive `task_metric_calls`, `task_metric_gaps` and
`task_metric_interruptions` tables under the existing host-owned SQLite schema.
Opening a host records interrupted turns and gaps in the same transaction as
the existing boot abort settlement. No call receipt is invented at recovery;
wall time is null even if the last recorded stream ended before the crash.
`endedAtMs` remains the persisted turn settlement timestamp; after interruption
it is not a measured last-runtime timestamp. Missing legacy call records are
never backfilled from visual messages or the older already-summed turn usage.
Deleting a turn/session cascades its metric records through foreign keys.

Bounds: 4,096 calls per turn; 256 UTF-8 bytes per identity; nonnegative finite
safe-integer timestamps; at most seven days per call; at most 10^12 per token
component per call. These bounds keep aggregate integer counts exact in JS.
Main permits 128 concurrent queue identities and 8,192 event writes per identity.
Excess events create one durable gap; diagnostics retain at most 32 bounded
messages. Tokens with no positive report from the pinned pi usage normalizer
remain unknown, since its zero-filled error placeholders cannot prove zero cost.

Validation commands (from repository root unless stated):

```text
node vendor/pi-desktop/packages/agent-runtime/node_modules/typescript/bin/tsc -b vendor/pi-desktop/packages/agent-runtime
node --test tests/player-feedback/task-metrics.mjs
cargo test --offline --manifest-path vendor/pi-desktop/Cargo.toml -p host-core task_metrics -- --test-threads=1
cargo build --offline --manifest-path vendor/pi-desktop/Cargo.toml -p host-core
node tests/player-feedback/task-metrics-core.mjs <owned-target>/debug/pi-desktop-host-core.exe
```

Set `TEMP`, `TMP` and `CARGO_TARGET_DIR` to owned D-drive locations and
`CARGO_BUILD_JOBS=1`. The core harness creates fresh isolated data and explicitly
terminates only its own process to verify interruption recovery. It does not
claim natural host shutdown, Electron integration, paid provider reconciliation
or player acceptance. Main/P5 integration and authorized P8 provider comparison
are separate acceptance boundaries.

### Compaction presentation ownership

A PI compaction divider does not create another user operation. The transcript keeps the real first assistant message as the host lookup anchor and mounts its metrics panel only on the final visible segment before the next user message. Earlier segments relinquish the panel and cancel outstanding reads. Memoized transcript rows must compare this ownership field. Totals still come exclusively from the durable host DTO; grouping supplies placement, never usage arithmetic.
