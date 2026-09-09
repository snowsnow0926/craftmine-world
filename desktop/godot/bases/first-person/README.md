# First-person base (Godot 4.7.2)

An editable first-person base for craftmine world / 最中幻想. It ships a blank
starting point and a small training range, both driven by the same scripts,
resources and parameters.

**Status: authored reference base.** This is developer-written source, not
evidence that the product model has completed A03/GD3. The model-facing task set
and its frozen assertions live in [docs/MODEL_ACCEPTANCE_TASKS.md](docs/MODEL_ACCEPTANCE_TASKS.md)
and are deliberately **not** implemented here.

The GD0 fixture under `desktop/godot/probes/first-person` is untouched and stays
the fixed integration probe.

## What is real

| Requirement | Implementation |
| --- | --- |
| Movement and collision | `CharacterBody3D` with gravity, acceleration, jump and slide collision (`scripts/core/player_controller.gd`) |
| Camera | yaw on the rig, pitch on the pivot, `Camera3D` at eye height (`scripts/core/camera_rig.gd`) |
| Pointing interaction | a real ray from the camera every physics frame drives the prompt, highlight and `interact` (`scripts/core/aim_query.gd`) |
| Screen-centre crosshair | full-rect `Control` drawn from its own `size / 2`, so it is centred at any resolution (`scripts/ui/crosshair.gd`) |
| Camera weapon mount | the display model is a child of the real `Camera3D`, positioned by the equipped item's `mount_offset` (`scripts/core/equipment_visuals.gd`) |
| Gun / sword switching | one `EquipmentState` owns the active item; model, crosshair and attack behaviour all read it (`scripts/core/equipment_state.gd`) |
| Ray hit, ammo, cooldown, damage feedback | `ranged_attack.gd`, `melee_attack.gd`, `attack_dispatcher.gd`, `target_dummy.gd`, `ui/hud.gd` |
| Versioned state and persistence | `world_state.gd` + `save_store.gd`, format `craftmine.godot-base-state/1` |

Everything the player sees while an item is equipped comes from that item's
`EquipmentDefinition` resource: mesh, material, mount transform, crosshair
visibility and style, attack mode, damage, cooldown, range, magazine and reload
time. There is no second copy of "what is equipped" anywhere, so editing a
weapon's damage or swapping its mesh cannot desynchronise the reticle or the
attack.

## Layout

```
base_manifest.json          machine-readable base id, version, entry scenes, state format
project.godot               engine config, input map, physics layer names
scenes/
  blank_start.tscn          blank starting point: player, camera, crosshair, equipment, save
  training_range.tscn       example world: three targets, cover, ammo crate, pickup, quest
  actors/player.tscn        player, camera rig, weapon mount, aim query, attack dispatcher
  actors/target_dummy.tscn  destructible target
  props/                    ammo crate, cover crate, one-time pickup
  ui/hud.tscn               crosshair plus live readouts
scripts/core/               gameplay and state
scripts/ui/                 crosshair and HUD
scripts/adapters/           thin build/run integration (see "Shared interfaces" below)
data/equipment/*.tres       weapon definitions and the catalog
data/ui/*.tres              crosshair styles
data/quests/*.tres          quest definitions
data/balance/*.tres         movement and feel parameters
assets/meshes/*.obj         original low-poly geometry, plain text
assets/materials/*.tres     original materials
assets/provenance/          asset and licence record
tools/generate_meshes.mjs   regenerates the meshes (the meshes are also source)
tests/                      independent acceptance runs
docs/                       base spec, state format, model tasks, decision record
```

Every scene, script, resource and parameter is plain text and can be read,
edited, duplicated and re-saved. The `.obj` meshes are hand-authored text and
can be regenerated or edited directly; `node tools/generate_meshes.mjs --check`
fails if the committed meshes drift from the generator.

## Running it

Human play (a real window, real mouse capture on click):

```powershell
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
& "$env:CRAFTMINE_GODOT_CACHE_DIR\editor\Godot_v4.7.2-stable_win64.exe" --path desktop/godot/bases/first-person
```

Controls: `WASD` move, `Space` jump, left mouse attack, `R` reload, `E` interact,
`1` / `2` / `Q` switch equipment, `F5` save, `Esc` release the mouse. The mouse is
captured only after a real click, so an automated run never requests pointer lock.
Every action above is bound in `BaseWorld._unhandled_input` and drives the same
real systems the scripted operations use (`EquipmentState.request_reload()`,
`AimQuery.interact()`, `EquipmentState.equip*()`, `BaseWorld.quicksave()`).

## Creating a world from this base

```powershell
node tools/new-world.mjs --template blank --world-id my-blank --out D:/tmp/my-blank --force
node tools/new-world.mjs --template training-range --world-id my-range --out D:/tmp/my-range --force
node tools/new-world.mjs --check-template blank   # refuses a template that ships progress
```

The tool copies the base source, selects the template entry scene and writes
`world.json` (`craftmine.godot-first-person-world/1`) and `world-build.json`
(`craftmine.godot-world-build/1`, every file hashed) — the same creation
contract the top-down and side-view bases write.

Automated acceptance (headless engine, isolated profile, no input simulation):

```powershell
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
node desktop/godot/bases/first-person/tests/acceptance_headless.mjs
node desktop/godot/bases/first-person/tests/acceptance_web.mjs   # real composited pixels
```

Both write a `report.json` with per-check evidence under `test-results/`.

## Parameters a model can change without touching a script

| Parameter | File |
| --- | --- |
| damage, cooldown, range, spread, magazine, reload time, mount transform, crosshair style | `data/equipment/pistol.tres`, `data/equipment/practice_sword.tres` |
| equipment list and switch order | `data/equipment/equipment_catalog.tres` |
| reticle shape, size, colours | `data/ui/crosshair_precision.tres`, `data/ui/crosshair_melee.tres` |
| move speed, jump, sensitivity, gravity, hit flash | `data/balance/training_range.tres` (the blank start uses `data/balance/blank_start.tres`) |
| objective kind, required count, one-time reward | `data/quests/range_basic.tres` |
| target health, flash time | `scenes/actors/target_dummy.tscn` instance properties |
| crate payload and uses | `scenes/props/ammo_crate.tscn` instance properties |
| add or remove equipment, switch order | `data/equipment/equipment_catalog.tres` (the shipped catalog also carries an `inspection_tool` with no attack, no model and no reticle) |

## Shared interfaces

The authored-base contract is frozen as `craftmine.godot-base-contract/1`; the
manifest declares the engine, world/state/progress/probe formats, the two
templates and the reusable components. All transport coupling still lives in two
thin adapters and nowhere else:

- `scripts/adapters/base_ops.gd` — the operation set, implemented once.
- `scripts/adapters/preview_bridge.gd` — Web transport adapter
  (`craftmine.godot-preview/1`), used by the exported build.
- `scripts/adapters/probe_runner.gd` — headless driver that executes a JSON
  command list, used by the headless acceptance run.

No scene, gameplay script or resource references a transport. Task C can replace
`preview_bridge.gd` without touching gameplay; task B can consume
`base_manifest.json` for the project identity, entry scenes and state format.

## Not verified here

- Model-authored creation from the blank start (that is the point of
  `docs/MODEL_ACCEPTANCE_TASKS.md`).
- Product PI/Rust project transactions, application receipts and world migration.
- OS-level isolation of untrusted generated projects. The existing AppContainer
  prototype has not passed its runtime gate; nothing here changes that.
- Player feel and hardware GPU performance. Headless runs prove logic, physics,
  state and geometry; the Web run proves composited pixels; neither proves feel.
