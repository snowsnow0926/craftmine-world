# Side-view base: host integration notes

This file records how the side-view base adapts to the interfaces published by
task B (managed build / job / candidate / application) and what it needs from
task C (host world view, save slots, UI). It is an interface note, not a claim
that host integration is finished.

## 1 Identity the base declares

| Field | Value |
| --- | --- |
| `baseId` | `side-view` |
| `baseVersion` | `1.0.0` |
| `stateVersion` | `1` |
| `entryScene` | `res://scenes/main.tscn` |
| `godotVersion` | `4.7.2-stable` |
| `renderer` | `gl_compatibility` |
| `target` | `web` (the base itself is engine-agnostic; target comes from the host build) |

The host scene record (task B, section 6.2) can therefore carry
`build.scene.baseId = "side-view"` and `build.scene.entry = "res://scenes/main.tscn"`.
World list labels should read `build.godot.baseId` / `build.scene.baseId`, and
fall back to the old runner when the field is absent.

## 2 Materializing `source/`

`node tools/new-world.mjs --world <blank|ruins> --out <dir>` copies the shared
runtime (`project.godot`, `manifest.json`, `params/`, `scripts/`, `scenes/`),
one world directory and a `worlds/default.json` pointer, then writes
`MATERIALIZED.json`. That directory is the `source/` shape a build materializes.
The tool copies files only: it does not run Godot, build or export.

For task B's `buildId` input, the base contributes `baseId`, `baseVersion` and
the source manifest hash; `stateVersion` travels with the world data.

## 3 Launch evidence and progress

Task B's `godotApplication.commit` requires a launch receipt with
`launch.stateHash` and `player` in `craftmine.progress/1`. The base provides:

- `SideView.probe().stateHash` — SHA-256 over the canonical persistent facts
  (`abilities`, `checkpoints`, `activeCheckpoint`, `rewards`, `counters`,
  `inventory`). Walking around does not change it, so it is stable evidence that
  a launched instance loaded the same progress.
- `SideView.progress_dict()` — `craftmine.progress/1` with the side-view plane
  mapped to `x`/`y` and `z = 0`, `yaw = 0`, `pitch = 0`. A 3D host receipt can
  consume it unchanged.

Open item for task B: the launch receipt also needs a `buildId` and
`instanceId` supplied by the executor. The base can emit its own instance marker
on request; that is a small addition, not yet implemented.

## 4 Save slot ownership

The base writes only `<save root>/<worldId>/state.json` plus its temp/backup
siblings, where `<save root>` is `CRAFTMINE_SIDEVIEW_SAVE_DIR` when set and
`user://save` otherwise. Open item for task C: the host must decide the per-world
save root and pass it in, so a world's progress is tied to the host's world
identity rather than to a machine-wide default. Until then the base is safe but
the slot is not host-addressed.

## 5 Restart and resume

On boot the base reads the saved room and placement, prefers the active
checkpoint over a stale mid-air position, rebuilds that room from world data and
reapplies persistent facts. A rebuilt room never re-grants a pickup or respawns
a defeated target, because those facts are keyed by stable ids in the save.
Acceptance run `D_enter_vault` proves the ability survives a full process
restart and still clears the gate by real physics.

## 6 Test interface and isolation

The headless verifier (`SideViewVerifier` autoload) is dormant unless
`CRAFTMINE_SIDEVIEW_INPUT_PLAN` is set. When active it can press the scripted
buttons and read the probe; it has no entry point to write a position, ability,
checkpoint or reward, and `tools/verify.mjs` asserts that by scanning its
source. Acceptance runs use `--headless`, `--fixed-fps 60`, an isolated save
directory and a pinned engine, per the project `AGENTS.md`: no real mouse or
keyboard, no pointer lock, no window activation, no user data touched.

## 7 Requests to other tasks

| To | Request |
| --- | --- |
| B | accept `baseId: "side-view"` in the build input and scene record; confirm whether the launch receipt should carry a base-emitted instance marker |
| C | pass the per-world save root into the base; show the side-view base label from `build.scene.baseId`; expose the checkpoint/ability summary from the probe |
| I | register the side-view base only after the unified workbench runs the acceptance matrix in one integration pass |

## 8 Not claimed here

Host build/apply wiring, Electron world view, world list UI, installer contents
and the diggable sandbox are out of this base's scope. The base is developed and
verified standalone; it is not registered as a delivered product base until the
unified workbench integration and acceptance pass.
