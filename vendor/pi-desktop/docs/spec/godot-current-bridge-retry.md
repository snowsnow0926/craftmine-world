# Retry with the current initial-load bridge

Normal retry of the original failed side-view world refused the exact shipped
bridge as customized. The legacy repair gate only knew the original
`318fdb…` and frame-independent `faf11c…` versions; the current `418bbb…`
bridge already contains the frame-independent behavior plus bounded actions.

Accept only the exact current hash with exact matching bundled replacement as
a no-op. The original pinned bridge upgrades only to the archived `faf11c…`
resource, which retains its original dependency closure without the current
bridge's additional action helper. The host chooses this bundled resource from
the existing bridge hash; it is not copied into newly materialized worlds.
customized bytes and unrecognized replacement hashes stay refused. This does
not rewrite the current world, change Godot, suppress an import failure, or
declare a candidate passed. The original initialization and check transaction
still determine execution and adoption.

The private `godotJob.continue` router is separately corrected to the existing
Core arguments: context, worldId, originJobId and toolCallId. No model/panel
authority is added. Real Core tests verify stale-source, active-job and
foreign-world refusals and exact retry receipts.

A proposed initializer continuation rewrite was discarded after real Core
testing contradicted its premise: a resumed ordinary initialization turn can
create a fresh check using the existing start path. Its new request remains
idempotent, and the old failed output is retained. The product initializer's
job scheduling is therefore unchanged. Tests use synthetic executor output;
full recovery of the original failed profile in a newly sealed client remains
required. The earlier native crash's root cause is still unknown.
