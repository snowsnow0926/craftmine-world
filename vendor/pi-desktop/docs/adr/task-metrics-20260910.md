# Decision: durable operation metrics from actual provider attempts

Status: accepted for the P4 data slice; Main/UI integration is owned by P10/P5.

An assistant bubble can span retries, tools and several models, while a parent
message can already include delegated usage. Summing rendered bubbles cannot
provide an exact operation total and can lose attribution when selection changes.

Use the existing host-core turn identity and SQLite owner. A wrapper inside each
admitted provider stream factory emits a UUID-bearing start and terminal fact.
Capture turn/provider binding before invoking the provider; delegated and
automatic compaction attempts use the same owning turn. Keep existing provider
retry behavior, visible assistant messages and legacy usage unchanged. P5 reads
the new host DTO instead of reusing the old visual-group accumulator.

Main serializes these finite facts per explicit session/turn. Host receipts are
immutable after termination, with exact replay accepted and conflicting values
rejected. One exact retry handles a lost persistence response. A durable gap
prevents apparently complete results after a failed write. Recovery preserves
known usage and marks unknown actual end time in the same transaction as the
existing boot settlement. It does not estimate missing calls or tokens.

The private endTurn method accepts one optional boolean `metricsUnavailable`.
It writes the gap inside the existing terminal transaction, allowing Main to
settle a task even when an earlier metrics RPC failed. Gap insertion and task
closure fail atomically; the fallback never relabels an earlier terminal state.

Expose normalized provider total as recorded, without adding cache/reasoning
twice. Report model bindings separately. TPS uses matched output tokens and
first-delta-to-terminal duration, and does not combine overlapping rates.
Bounds on call count, timestamp duration and token magnitude keep arithmetic
finite and exactly representable. No independent DB, background model request,
new tool command, arbitrary renderer write or pricing lookup is introduced.

The data is operational telemetry, not billing proof: gateways may hide their
backend model, providers may omit usage, and failed attempts can remain unknown.
Existing old turns remain unknown rather than being silently reconstructed from
incomplete or already-aggregated history. The renderer must label partial and
unknown states and cannot substitute its current model selector for history.
