# Authored bases in the managed runtime

This package connects the actual first-person, top-down and side-view bases to the existing craftmine.godot-runtime/2 Web bridge. The JavaScript host and Rust durability boundary remain separate components. It does not add permission to execute arbitrary generated projects.

## Materialization

Import materializeBase from materialize.mjs and supply baseId, worldId, template and a fresh absolute output directory. World ids use the portable lowercase 2–48 character rule required by the top-down generator. Supported templates are first-person blank/training-range, top-down blank/town and side-view blank/ruins. The materializer copies the authored project, adds CraftmineRuntime as an autoload, disables standalone file persistence in managed mode and emits managed-base.json with source file hashes. Only the selected adapter is copied; global class names from different bases must never be mixed in a project.

After Godot boot, the tree is paused. The host must load an explicit snapshot (null for a fresh instance), then resume. The bridge remains active while paused. Load, restore-state, snapshot and save use the complete native body; 2D coordinates are never converted into a legacy voxel player.

## Progress and receipts

The snapshot result has base, worldId and state. State is:

    {format: "craftmine.godot-progress/1", worldId, baseId, baseVersion,
     stateVersion: 1, body: <native state, including the same worldId>}

Native bodies:

- First-person 0.1.0: player placement/look/contact, equipment and ammunition, inventory, target health/hits, interactables, quests and stable savedAt metadata. Capturing or saving does not rewrite savedAt. A restored floor-contact observation is retained while paused and refreshed by the next real physics step.
- Top-down 1.0.0: player scene/placement/facing, per-scene positions, coins, inventory, shop stock, quests, one-time rewards and flags. Restoration validates and stages the authored scene, then binds its real nodes. A failed bind retains the previous scene, progress and dirty status. Managed mode does not read or overwrite standalone user:// saves.
- Side-view 1.0.0: room/placement/facing, ability/checkpoint/reward ledgers, room visits, counters, inventory, stable target health and player health/death recovery timers. Room reconstruction during restoration does not increment visit counts or grant rewards. Existing native v1 saves without entities/vitals migrate to authored target defaults and full health; the reward ledger still prevents defeated targets from respawning. Unknown entity/vital fields and incompatible target/reward combinations are rejected.

This is complete native progress, not a rewind of every transient physics frame. Velocity, an active attack hitbox and animation frame remain controller state outside the native progress schema. Author-defined body fields must survive the adapter or produce an explicit rejection. Unknown outer fields and future versions are rejected rather than silently removed. Known extensible ledgers retain their keys.

State is limited to 1 MiB UTF-8. The JavaScript wire allows 8 MiB because the response includes the state, snapshot and escaped exact text. Save returns status=confirmed plus runnerReceipt, state and snapshot. The runner receipt contains format=craftmine.godot-runner-receipt/1, worldId, buildId, instanceId, snapshotText, snapshotSha256 and UTF-8 bytes. It confirms a consistent runtime snapshot, not disk durability. Rust verifies the exact text/hash and returns craftmine.godot-progress-receipt/1. Acknowledge requires the world/build/live instance and snapshotSha256 of the latest confirmed save. Restoring invalidates the earlier confirmation. Rust snapshotHash is a separate canonical hash and must not be substituted for snapshotSha256.

## Managed observation and gameplay

The `observe` request is a read-only live observation and works while paused. E returns its world snapshot; F includes live scene, animation and physical overlap observations; G includes player, current room, target health and sprite visibility/texture/screen coordinates. These observations are separate from persisted progress and do not add transient fields to the save schema.

F managed gameplay accepts `move`, `wait`, `buy`, `deliver`, `talk`, `gather`, `interact` and `focus` (an in-game interaction target, not window focus). Movement axes are finite values within -1..1 and move/wait commands are bounded to 600 ticks. Purchases, gathering and delivery still enforce live proximity and business rules. Standalone probe scene/position/reset helpers are refused by the managed adapter. Crossing a real door safely ends movement on the old actor and returns the newly bound scene; door replacement is deferred beyond the Area2D physics flush.

G accepts `control` with `{segments: [{ticks, move?, jump?, attack?, interact?}, ...]}`. There are at most 64 segments and 600 physics ticks in total; ticks must be positive integers, move must be finite within -1..1, and buttons must be booleans. Unknown fields are rejected. The temporary input source supplies ordinary controller buttons and has a finite consumption deadline. It cannot set coordinates, health, abilities or rewards. This is runtime control, not a new model tool permission or arbitrary execution grant. Tests use no OS input or Pointer Lock.

## Verification

Run node desktop/godot/shared/tests/progress.mjs with CRAFTMINE_GODOT_CACHE_DIR pointing to the verified pinned cache. The suite runs real Godot 4.7.2 headless in independent processes and profiles. It exercises complete restart, paused live restore, malformed/foreign/future/oversized input, unsupported custom fields, target damage, and receipt acknowledgement. All state fields are compared; no timestamp or contact field is removed. The fixed historical timestamp case protects against captures that accidentally regenerate metadata.

The fixture deliberately supplies rich native state to exercise every ledger. Side-view damage calls real node methods. These tests supplement the original bases' physics/gameplay acceptance suites; they are not evidence of model-authored gameplay, OS isolation, rendering fidelity or A17 readiness.

`node tests/godot-runtime-native.mjs` runs all three authored bases through actual Web export, isolated offscreen Electron, the production host/adapter and Rust durability. `--base first-person|top-down|side-view` selects one. Supply `CRAFTMINE_NATIVE_DEPENDENCY_ROOT`, `CRAFTMINE_ELECTRON_BIN`, `CRAFTMINE_CORE_BIN` and the pinned Godot cache when dependencies live outside the worktree. `CRAFTMINE_GODOT_HOST_ROOT` is an explicit read-only host source override for integration work; the report records its source hash and the core binary hash. The test performs real gameplay, compares every persisted field across full process restart, rejects bad snapshots, retains state after storage failure and captures nonempty rendered pixels. G also asserts that the living player actually appears in the captured image: keeping RoomManager in the Node2D canvas subtree prevents its background covering the Player sibling. It uses fixed authored projects and test-only executor/application registration, not real-model authoring or release approval. Renderer diagnostics and any software WebGL warnings remain in raw evidence.

Side-view editor shutdown previously leaked three script resources through static factories with self-typed returns and direct self-class construction. Factories now avoid both references; callers that need static typing declare it locally. Persistence fixtures retain the real res://scripts/runtime resource paths. Full imports are checked for errors and leaks rather than filtering these diagnostics.
