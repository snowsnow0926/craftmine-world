# Matched courtyard reuse experiment

This is a small playable-world pilot, not an estimate for recreating all four
historical promotional worlds. Every run uses the actual local Codex CLI
`0.154.0-alpha.6.2`, `gpt-6-astra` and `xhigh`, confirmed by the normal app-server
connection. Each condition starts with a fresh Codex thread and independent Rust
world/profile. No request-count, token or whole-turn duration limit is added.

The shared player objective is a finished courtyard within the original 64×64 m
field: two enterable red-roof timber/stone houses, an open twin-tower south gate,
a flat sandy street, proper collisions, unchanged original player/controls and
durable save/reopen. The prompt requests actual architecture rather than block
placeholders. The modes differ in available reuse, not in the number of required
buildings or the gameplay goal:

- **Fresh authoring:** explicitly make the architecture from scratch, without
  existing model/component/world reuse; use ordinary bundled Blender tools.
- **Component composition:** discover exact existing local catalog packages,
  propose their placement and use normal player confirmation/check/adoption.
- **Reference template:** create an independent world through the actual
  player-world library/factory from a completed same-goal reference, then let a
  fresh Agent inspect or adapt it. This is source-template reuse, not screenshot
  reconstruction. Native creation can already be playable without model calls;
  fresh-Agent validation time/tokens must be reported separately.

Source-generated geometry/style may differ between fresh and component modes.
They satisfy the same functional/thematic goal; this is not pixel-identical
reconstruction, a blinded quality study or a statistical performance claim.

The existing author CLI and live host are the execution path. The runner records
the exact requests, actual event stream, model/effort, process and native-turn
times. Native operators confirm frozen proposals, read existing matching checked
candidates or request the missing check, preview/adopt, and save. Operators never
hand-edit authored source or fabricate a model result. Real visual defects and
repairs remain in the totals. A source receipt or model's final text is never
accepted as playable completion.

The gameplay operator first verifies ordinary page-dispatched W input without
OS input or Pointer Lock, then feeds bounded axes through the actual base
CharacterBody3D controller, including acceleration and collision. It records
waypoints and actual positions, captures real frames, refuses blocked motion,
saves and launches a new private runtime to verify restored player/world state
and identical source/applied OIDs. A blocked unpromised shortcut may be retried
via a real route with its original failure retained; no teleport or source edit
is used to conceal it. This scripted semantic check is not human control-feel
acceptance.

Accounting uses per-turn differences of the CLI's cumulative token counters.
Cached input remains visible and is not charged as ordinary input in any inferred
price. Reasoning is already included in output. Missing counters stay missing.
Active Agent/tool time, native operator time, reference publication time, direct
template initialization and observed request-to-application wall time are separate.
The latter can contain experimental orchestration or human gaps; they must not
be silently presented as product latency. Concurrent runs are identified.

The first development-catalog run and final fixed-catalog rerun use separate
profiles and immutable plugin/catalog copies. Archive/content hashes identify
which package was tested; matching IDs/version numbers alone cannot substitute
a later package into the earlier evidence. The first template harness setup
error (`worldsRoot` argument) involved no model call and is retained separately
from product/model failures.

Entry points: `scripts/courtyard-benchmark.mjs`,
`scripts/courtyard-benchmark-operator.mjs`,
`scripts/courtyard-benchmark-reference.mjs`, and
`scripts/courtyard-benchmark-walk.mjs`. The reference is the native player-world
ZIP format, not a manually assembled near-compatible archive. The selected
saved progress is explicit and is not silently reset. Normal CLI cancellation
remains available while an Agent is running.

The completed 2026-09-13 results are recorded in the repository-level
`docs/PLAYER_COURTYARD_REUSE_LIVE_2026-09-13.md`, with compact immutable evidence
and actual unedited frames under `docs/evidence/courtyard-reuse-2026-09-13/`.
All three outcomes passed actual traversal, save and cold reopen. The reference
Agent's redundant identical-source check remains a recorded artifact-conflict
failure, separate from its successful initial check/application and gameplay.
Reports must preserve that distinction and the earlier development catalog run.
