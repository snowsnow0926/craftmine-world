# ADR 0001 — First-person base architecture

- Status: accepted for base version 0.1.0
- Date: 2026-09-09
- Scope: `desktop/godot/bases/first-person`

## Context

The GD0 fixture (`desktop/godot/probes/first-person`) proves that the pinned
engine can import and run a small 3D project and that a real camera attachment,
ray hit and equipment visibility can be observed headlessly. It is a fixed
integration probe with a single `world.gd` that builds its scene in code, keeps
`equipped`/`ammo`/`target_health` as loose script variables, and exposes a probe
command set written for that one fixture.

That shape cannot serve as the base a model extends. Everything is in one
script, the scene is constructed imperatively, there is no versioned save format,
and the crosshair, model and attack behaviour read separate variables. Copying it
would carry those problems into every world built on top.

## Decision

Build a separate base with the following structure, and leave the probe untouched.

### 1 One equipment state, many derivations

`EquipmentState` is the only owner of "what is equipped" and of the magazine,
reserve, cooldown and reload timers. Consumers (`EquipmentVisuals`, `Crosshair`,
`AttackDispatcher`, `Hud`, `AimQuery`) receive the active `EquipmentDefinition`
through `equipment_changed` and derive everything from it.

Rejected alternative: keep `equipped`, `weapon_visible`, `crosshair_visible` and
`ammo` as independent members and update them together. That is what the probe
does and it is exactly the class of bug the product requirement targets ("the
equipped item, displayed model, crosshair and attack method must come from the
same real state").

### 2 Data over code for weapon and feel parameters

Damage, cooldown, range, spread, magazine, reload time, mount transform, mesh,
material and crosshair style are `EquipmentDefinition` / `CrosshairStyle`
resources. Movement and sensitivity live in a `BalanceProfile` resource. A model
changes gameplay by editing `.tres` text, not by editing a script. This also makes
"change the damage and keep playing" a source edit rather than a state migration.

### 3 Versioned, validated, minimal state

`WorldState` captures only player-produced progress and stamps
`craftmine.godot-base-state/1` with `stateVersion`. `apply()` validates the whole
envelope and every block before touching a node, and restores its own pre-apply
snapshot if any block fails, so a rejected save leaves the world untouched.
Deliberately excluded from state: damage, cooldown, meshes, materials and
crosshair styles, because those are source.

Rejected alternative: serialise the whole scene tree. It would make a save
incompatible with any source edit and would let a save overwrite authored values.

### 4 Text assets, generated and versioned

Meshes are hand-authored `.obj` text produced by `tools/generate_meshes.mjs`.
Text is readable, diffable, editable and re-savable; a model can change a mesh
without a binary asset pipeline. `--check` fails if the committed meshes drift
from the generator. Structural geometry (floor, walls) stays as `BoxMesh` /
`BoxShape3D` in the scene, which is also plain text and parametric.

### 5 Explicit binding instead of long NodePaths

Consumers implement `bind_world(world)`; `BaseWorld._ready()` calls it once for
the core nodes and for every node in the `base_interactables` group. A copied or
rearranged scene keeps working, and a missing dependency is a warning rather than
a silent null. Long relative `NodePath` exports across five levels were rejected:
they break silently when a scene is reorganised.

### 6 Movement, including scripted movement, goes through one path

`PlayerController._physics_process` is the only place that applies velocity and
calls `move_and_slide()`. `walk(axis, frames)` sets an axis override that
`_read_move_axis()` returns instead of the keyboard vector. An earlier version
looped its own `move_and_slide()` and fought `_physics_process`, producing a
crawl instead of a walk; the override fixed it and made scripted acceptance test
the real movement code.

### 7 Thin adapters for unfrozen shared interfaces

Task B (build checklist) and task C (run protocol) are not frozen. All coupling
lives in `scripts/adapters/`: `base_ops.gd` (the operation set, implemented once),
`preview_bridge.gd` (Web transport, `craftmine.godot-preview/1`) and
`probe_runner.gd` (headless JSON command list). No scene or gameplay script
references a transport, so either adapter can be replaced without touching the
base. `base_manifest.json` publishes the identity, entry scenes and state format
that a build checklist can consume.

### 8 No input capture in automated runs

Mouse capture requires a real left click and is disabled on the headless display
driver. The Web harness disables `requestPointerLock` and never dispatches
synthetic input, so acceptance cannot pass by driving the game like a player.

## Consequences

- A model can add a weapon, a target or a reticle behaviour by adding resources
  and scripts, without editing the base's core files.
- The state format is small and stable; adding a field requires an explicit
  migration step.
- The base cannot hot-reload a modified project into a running world; acceptance
  restarts the process, which is also what the product's "keep the progress"
  requirement needs to prove.
- Anything that needs a frozen shared interface must wait for tasks B and C, or
  be added to `base_ops.gd` and re-exported.
