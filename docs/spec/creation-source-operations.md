# Persistent creation source operations

Creation operations compile into ordinary `godotProject.patch` source edits.
They never mutate the live scene, invoke a model, apply a candidate, or edit player
progress. The existing source transaction, build/check, candidate review and apply
pipeline remains responsible for publication and its durable operation receipt.

`plugins/craftmine-world/creation-operations.cjs` exports
`compileCreationOperation({source,targetSnapshot,request})`. Its companion
`creation-operation-schema.cjs` exports `CREATION_OPERATION_SCHEMA` for the broker.
The compiler is pure and returns `{document,operations,receipt,sourceBinding,replayed}`.
`operations` are existing `put` records with a complete text and an exact
`expectedHash` (null only for new files). All edits must be committed atomically.

## Source and target contract

`source` contains `worldId`, `buildId`, `instanceId`, `revision`, `manifestHash`, and
`files`, a map from source-relative path to `{text,sha256}` read from the indexed
source revision. Required source is `world/creation.json`; optional source is
`world/creation-operations.json`. Generated rule paths are source-relative too.
Each supplied file is bounded and its bytes are verified against its hash.

`targetSnapshot` comes from the trusted host, not model arguments. It contains
`snapshotId`, `worldId`, `buildId`, `instanceId`, `sourceRevision`, `manifestHash`,
`playerPosition` (feet), and `target:{entityId,position,normal,surface,revision}`.
The target revision is the creation document revision. Optional `obstacles` is a
bounded array of `{id,position,halfExtents}` AABBs. The host derives these values
from actual runtime observation and is responsible for capture freshness. An
opaque renderer capture ID cannot supply or override any of these values.

The request repeats the exact observed world/build/instance/source/manifest and
`targetSnapshotId` under `expected`. New operations reject mismatches. A replay
of an already recorded identical operation returns its original receipt without
new source edits, even when the source head advanced. Reusing that operation ID
with changed arguments fails. Applying a different operation against an older
capture requires host revalidation; the compiler never silently rebases a target.

## Operations and limits

- `place` creates tree, rock, chest, door or marker. Without explicit `position`,
  it requires an actual ground/entity hit. An explicit named position is allowed
  within the same bounded world. Optional offset is limited to eight units per axis.
- `modify` updates declared position, yaw, scale, color or parameters of the exact
  captured entity. Entity ID and kind cannot change. Chest reward ID and amount
  are immutable; color/movement changes cannot mint another one-time reward.
- `duplicate` creates one to eight copies with deterministic new stable IDs and
  a nonzero bounded offset. Every new collider is validated before any source edit.
- `environment` updates only `defaults.timeOfDay` in the range 0 through 24.
- `sequence-door` declares and generates a new source-owned rule for two to sixteen
  distinct marker IDs and one existing door. It is not a runtime magic command.

The scene format is `craftmine.creation-scene/1`, with a monotonically increasing
document revision, at most 128 unique entities, x/z from -28 to 28, y from 0 to 16,
scale from .25 to 4, yaw from -180 to 180 and a six-digit hex color. Parameters are
kind-specific: chest `rewardId/rewardCount`, door `initiallyOpen`, marker `label`,
and empty objects for rock/tree. The shared runtime schema remains authoritative.

The compiler uses the runtime's collider half-extents, rotated around y and scaled,
to reject world-boundary overflow, entity/obstacle overlap and player overlap.
Player overlap uses a conservative .5-unit horizontal envelope. Removed targets,
nonfinite coordinates, undeclared fields, invalid reward values and oversized
duplicates fail before producing a patch.

The separate `craftmine.creation-operations/1` source journal stores at most 64
operation/request-hash/semantic-receipt entries. It does not enter runtime state.
It rejects a full journal rather than pruning IDs and allowing replay. Created
entity IDs remain reserved in this journal after removal. The runtime's separate
opened-chest ledger remains the final one-time-reward authority across source
removal/restoration. Each source file is at most 120,000 UTF-8 bytes and the full
patch-operation envelope at most 170,000 bytes, leaving room for host identity in
the existing 180,000-byte tool limit.

## Generated sequence rule

The generated `.gd` file is at `scripts/creation/rules/<ruleId>.gd` and its exact
SHA-256 is declared in the optional scene `rules` list. Runtime validates path,
hash and entity references before loading. The generic extension interface is
`configure(host,definition)`, `on_entity_interacted(entityId)`, `snapshot()`,
`validate_state(data)` and `restore(data)`. Successful ordered interactions latch
completion and call `host.set_door_open(doorId,true)`; an incorrect marker resets
the sequence. Completion and cursor are saved separately from source. Rule IDs
and generated source paths cannot be overwritten by this bounded operation.

## Validation scenarios

Run `node --test tests/creation-operations.test.mjs` for deterministic compiler
fixtures. To also run the actual generated-source behavior fixture, set
`CREATION_GODOT_EXE` to an existing trusted Godot console executable and run
`tests/creation-sequence-rule.test.mjs`. The latter uses `--headless`, hidden process
launch, a temporary project and isolated user-data environment. It uses no mouse,
keyboard, Pointer Lock, browser, model call or live microphone.

Integrated acceptance must verify: source placement survives candidate adoption
and restart; modifications keep identity; duplication is bounded; stale/removed
targets and overlap produce no candidate; identical replay creates no extra entity;
opened chests do not reward again after source changes; and the generated sequence
rule opens its door only after the declared sequence and restores after restart.
