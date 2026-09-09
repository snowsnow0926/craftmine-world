# Authored bases: creation manifest and component catalog

This directory holds the three delivered Godot bases. Two generated files sit
next to them; both are derived from the base manifests and must be regenerated
after a manifest or component-file change:

| File | Format | Consumer |
| --- | --- | --- |
| `base-catalog.json` | `craftmine.godot-base-catalog/1` | UI world creation (task E), host materialization, tests |
| `component-catalog.json` | `craftmine.godot-component-catalog/1` | reuse/packaging (task H), model tools (task L) |

```powershell
node desktop/godot/shared/tools/build-base-catalog.mjs           # regenerate
node desktop/godot/shared/tools/build-base-catalog.mjs --check   # fail on drift
```

## Base catalog

Every base exposes one `blank-start` and one `example` template, the pinned
engine, the world/state/progress/probe formats and the world-id rule the product
must enforce:

| Base | Version | Blank | Example |
| --- | --- | --- | --- |
| `first-person` | 0.1.0 | `blank` | `training-range` |
| `mining-sandbox` | 1.0.0 | `blank` | `mine-camp` |
| `top-down` | 1.0.0 | `blank` | `town` |
| `side-view` | 1.0.0 | `blank` | `ruins` |

Creation is one call per base. The catalog records the exact command, and the
host can use `materializeBase` from `desktop/godot/shared/materialize.mjs` for the
managed (runtime-bridge) layout:

```js
import { materializeBase } from './desktop/godot/shared/materialize.mjs';
const manifest = materializeBase({ baseId: 'side-view', worldId: 'my-ruins', template: 'ruins', out: 'D:/tmp/my-ruins' });
```

Rules the catalog and the tools enforce:

- world ids match `^[a-z0-9][a-z0-9-]{1,47}$`;
- a `blank-start` template ships no completed quest, claimed reward, checkpoint,
  target or ability;
- every created world gets a new world id and writes a hashed build receipt
  (`craftmine.godot-world-build/1` for first-person/top-down,
  `craftmine.godot-sideview-materialize/1` for side-view).

## Component catalog

28 components are declared across the four bases: door, interactable, NPC
dialogue, shop, quest, gather zone, spawn marker, player, checkpoint, ability
pickup, reward pickup, target, hazard, equipment item, crosshair, terrain
material, ore vein, crafting recipe, crafting station and more. Each declares:

- `identity` — the stable field saved state is keyed by (never a node path);
- `persistentState` — the state format, the exact fields, and the capture/restore
  functions that own them;
- `initialState` — what a brand new instance starts with;
- `files` — every file the component needs, with byte count and SHA-256;
- `install` — how the component is materialized into a world (see below).

`desktop/godot/shared/components.mjs` is the library:

```js
import { loadComponentCatalog, componentPackageInput, extractInstance, planInstallation, applyInstallation } from './desktop/godot/shared/components.mjs';

const catalog = loadComponentCatalog('desktop/godot/bases/component-catalog.json');
const pkg = componentPackageInput(catalog, { componentId: 'sv.reward-pickup' });          // for H
const found = extractInstance({ catalog, componentId: 'sv.target', projectDir, entityId: 'dummy_ruins' });
const plan = planInstallation({ catalog, componentId: 'sv.reward-pickup', projectDir, entityId: 'reward_second_cache', roomId: 'start', placement: { x: 320, y: 320 } });
applyInstallation({ catalog, plan, sourceDir: 'desktop/godot/bases/side-view', projectDir });
```

Installation always assigns a **new** entity id and starts from the component's
initial state, so copying a component never copies the source author's progress.
Data-driven components (side-view entities in `world.json`, top-down
`data/**` resources) are written by the tool.

### Scene components are materialized, not described

A scene-node component declares an `install` block and is written into a real
`.tscn` by `desktop/godot/shared/scene_materializer.mjs`:

```jsonc
"install": {
  "mode": "script-node",              // or "instance" when the component ships a scene
  "scene": "scenes/overworld.tscn",   // default target; the caller may pass `scene`
  "parent": ".",                      // node path inside the scene
  "nodeType": "Area2D",               // base class for script-node mode
  "script": "scripts/base/door_zone.gd",
  "identityField": "entity_id",
  "identityType": "string",           // or "stringname"
  "groups": ["entities"],
  "exports": { "target_scene": "\"\"", "target_spawn": "\"\"" },
  "inputActions": ["interact"]
}
```

The materializer:

- allocates a deterministic `ext_resource` id and writes `type` before `parent`,
  the ordering Godot's scene parser expects;
- reuses the script's real `uid://` when the base ships a `.gd.uid`;
- quotes plain strings as GDScript literals;
- refuses a duplicate node name or identity value **before** writing anything;
- appends only: existing ext_resources, nodes and author edits are preserved;
- adds a missing required input action to `project.godot`.

Scene paths in `install` are relative to a materialized world project, which is
why top-down scripts appear as `scripts/base/*.gd` (the base's `core/scripts` are
copied there by `tools/new-world.mjs`).

## Verification

```powershell
node --test tests/godot-remaining/F/contracts.test.mjs tests/godot-remaining/F/components.test.mjs tests/godot-remaining/F/observation.test.mjs tests/godot-remaining/F/base-creation.test.mjs
node tests/godot-round2/R3/scene-install.mjs                             # real engine: scene materialization
node desktop/godot/shared/tests/progress.mjs                             # real engine: managed lifecycle, 4 bases
node desktop/godot/bases/tests/audit-persistence.mjs                     # real engine: native save rejection, 4 bases
node desktop/godot/bases/first-person/tests/acceptance_headless.mjs      # real engine
node desktop/godot/bases/top-down/tools/verify.mjs --godot <pinned-engine> # real engine
node desktop/godot/bases/side-view/tools/verify.mjs                       # real engine
node tests/godot-remaining/G/a16-acceptance.mjs                           # real engine: mining sandbox, 45 assertions
```

Set `CRAFTMINE_GODOT_CACHE_DIR` to the pinned 4.7.2 cache for the first-person
suite and `CRAFTMINE_GODOT_BIN` for the side-view suite.
