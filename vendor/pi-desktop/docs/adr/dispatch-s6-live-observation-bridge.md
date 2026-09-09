# ADR: live Godot observation crosses the host bridge, never the journal

Status: implemented in the round-three S6 wiring.

The round-two audit found that the Craftmine model tools accepted live-sampling,
budget and executor providers that the production constructor never passed.
`godot_runtime_state scope=live` therefore answered
`LIVE_OBSERVATION_NOT_WIRED` in the shipped product, and a queued build job was
never claimed by the managed executor.

Live state is not durable state. The per-request host snapshot injected by the
agent runtime carries only durable identity (applied build, world and draft
revision, the last journaled source head, the executor gate and verification
count) and must never carry a camera, an equipped weapon, entities or quests: it
would then be replayed after a compaction as if it were current. Durable progress
is a save, not equipment, so it cannot stand in for a sample either.

The trusted main process now exposes exactly one live-reading capability to the
Craftmine plugin: `craftmine.godotLiveState`. It is gated to the
`craftmine.world` plugin and only exists when the host registered the sampler.
`createCraftmineLiveSampler` reads the additive `observe-envelope` op of the
running formal instance, validates the envelope against the shared observation
schema and stamps the host's own world, build and instance identity. A caller may
narrow the request; any mismatch is refused, and a stopped instance returns
`null` so "not running" is never reported as an empty sample.

The plugin validates the identity a second time, flattens the payload, and
reports a sample that is missing identity, belongs to another world, build or
instance, carries a progress body, or is outside the freshness window as unknown
with its reasons. It never substitutes the last confirmed save.

The same provider bundle is the contract for the seven-kind limit ledger read
from the task's own durable row (`budget.inspect`), the live managed-executor
status, the hand-off of a queued build/check job to the executor, and the
discussion-only predicate. `godot_capability_report` reports which providers the
process actually received, with the owning agent and the host method that would
close each gap. A missing provider stays unknown; it is never zero.

Consequences: the budget ledger does not need a second host channel, because the
plugin already holds the core client; task continuation keeps its accumulated
cost because the ledger is keyed by task; and a build started by the model is
handed to the live executor in the same turn, with the real reason reported when
no executor is available. No new permission, no token-gated method and no engine
process is exposed to the model.
