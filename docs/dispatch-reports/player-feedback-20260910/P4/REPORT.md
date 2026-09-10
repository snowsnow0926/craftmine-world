# P4: durable task usage data

Baseline: `eae279915094f09d987ef0eb747eba20ef92cd0e`.
Branch: `codex/fb-p4-20260910`; worktree: `D:/cm-fb-p4-20260910`.
Contract commit: `9491db0` (already transferred to P10/P5). The implementation
and this report are one following logical commit; see its Git commit identity.

## Delivered

The shared finite DTO is consumed directly by P5. The real runtime observes each
admitted provider attempt, including retries, delegates and automatic compaction.
The existing session/turn identifies one user operation. An independent Main
queue preserves that identity, performs one exact lost-response retry, checks
actual write receipts and persists known accounting gaps. Host-core owns the
additive SQLite ledger and query; immutable terminal receipts reject conflicts.
Existing turn end, crash recovery and retention own lifecycle settlement.

The host query returns actual normalized totals, explicit partial/unknown
coverage, provider/model bindings, per-model usage, matched generation TPS and
separate task wall time. Overlapping TPS is unavailable. Cache/reasoning are not
added twice. Legacy unknown data, absent usage and interrupted end times are not
invented. No UI-based accumulator, separate DB, general-purpose telemetry RPC,
model request, pricing request or credential read was added.

P10 owns Main index/read IPC/API and P5 owns UI. This branch intentionally does
not modify those files or `assistant-turns.ts`: P5 is replacing its visual-group
usage source with actual message-ID-bound `session.turnMetrics` queries.

## Integration

- Construct `createTaskMetricsRecorder({call: (method,params) => host.call(method,params)})`.
- Before parent/subagent event filtering, pass `model_call` envelopes to observe.
  Keep their original nonempty `sessionId` and `turnId`; do not use active selection.
- Before every `session.endTurn` path (complete/error/abort), await drain for that
  identity. A partial result has an already-persisted gap. A rejection means the
  storage failure itself could not be persisted and must be surfaced. Main can
  then send private `session.endTurn` with `metricsUnavailable:true`, which writes
  the gap and terminal status atomically. A whole-transaction failure remains an
  actual persistence error. Invalid boolean types are rejected. Release
  only after settlement. Retain the existing finite host RPC timeout.
- The new private gap RPC is `session.metricsUnavailable {sessionId,turnId}`.
  Renderer access is read-only `session.turnMetrics` using the frozen query.
- Main synchronous queue/identity admission failures must also be surfaced, not
  swallowed. Queries for another session's message/turn return null.

## Validation performed

All outputs and temporary directories were on D. Offline dependencies used
`node C:/Users/WINDOWS/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.mjs install
--offline --frozen-lockfile --ignore-scripts --store-dir D:/.pnpm-store` in the
owned vendor workspace, with owned TEMP/TMP/PNPM_HOME. No dependency downloads.

- Runtime/shared `tsc -b`: pass. New Main helper strict standalone tsc: pass.
- `node --test tests/player-feedback/task-metrics.mjs`: **8/8**, production
  stream wrapper, actual runtime identity-capture method and Main queue with
  deterministic provider event fixtures. Includes no-usage abort/setup failure,
  separate attempt IDs, result-only compaction, late turn/provider mutation,
  exact lost response retry, durable gap failure and bounded capacity.
- Existing runtime/provider-retry/subagent Vitest files: **168/168**.
- `cargo test --offline --manifest-path vendor/pi-desktop/Cargo.toml -p host-core
  task_metrics -- --test-threads=1`: **5/5** actual SQLite tests. This includes
  process-style reopen after a completed last stream but an unclosed task,
  unchanged exact receipt replay, ownership, duration bounds and delete cascade.
  Fault triggers independently refuse gap insertion and terminal update to prove
  the new endTurn fallback cannot leave a half-committed success.
- Existing Rust `turn_end` checkpoint settlement tests: **3/3**. The earlier
  `end_turn` name filter matched zero tests; that output is retained and is not
  counted as verification.
- Same-source `cargo build --offline ... -p host-core` with
  `CARGO_BUILD_JOBS=1` and owned `CARGO_TARGET_DIR`: pass.
- `node tests/player-feedback/task-metrics-core.mjs`: **6/6** actual Rust stdio
  scenarios through the production Main queue. Lost reply is injected only after
  actual commit. Real message mapping, mixed model/delegate/summary totals,
  missing usage, strict error codes and field rejection, late closed-turn refusal,
  exact completed metrics after process restart, interrupted unknown time, and
  atomic endTurn gap/replay semantics all passed. Binary hash and actual exits are in
  [core-report.json](core-report.json).

The core harness intentionally uses owned SIGTERM plus bounded actual close to
exercise interruption recovery. It does **not** claim graceful host EOF shutdown.
The first run used an incorrect default binary filename; the next used the wrong
RPC error property and attempted EOF shutdown, which timed out at five seconds.
Those original outputs and the failed report are preserved. Corrections use the
actual binary name, exact `error.data.errorCode` and explicitly identified owned
interruption. A first JS harness used CommonJS loading for the ESM-only pi-ai
package; the corrected harness uses its actual ESM module. Initial pnpm launcher
resolution failed until the known offline direct entry was used. None of these
failures were counted as product acceptance or hidden by weakened assertions.

## Remaining acceptance boundary

No Electron/client/model/player test was run for this data branch. P10 must wire
and validate Main completion/error/abort drains, then P5 must show the read DTO.
P8 remains responsible for separately authorized actual provider reconciliation.
The stream timing is first-delta-to-terminal observation, not hidden backend
compute time; gateway backend identity and missing provider usage remain unknown.
No merge, push, old profile access, visible window or user input was performed.
