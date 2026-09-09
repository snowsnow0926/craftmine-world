# Side-view base (Godot 4.7.2)

A gravity platformer base for Craftmine World: run, jump, platform collision,
room-bounded camera, a real attack hitbox, checkpoints, hazards and persistent
abilities / rewards across room switches, saves and restarts.

Engine: `4.7.2-stable`, GDScript, `gl_compatibility`. Entry scene:
`res://scenes/main.tscn`. This directory is a self-contained Godot project.

## What ships

| World | Kind | Content |
| --- | --- | --- |
| `worlds/blank` | blank start | one flat room, floor/walls/ceiling, a decorative step, one checkpoint, one training dummy |
| `worlds/ruins` | example | three connected rooms with return paths, a spike pit, a one-time cache, a dummy, a breakable crate, a double-jump pickup and a 190 px high ledge |

The ruins example contains the ability gate: the high ledge on the right is
`190 px` above the floor. A single jump rises `136.1 px` and cannot pass; a
double jump rises `249.9 px` and opens the vault room. The numbers come from
`params/side_view_params.json` and are re-derived by `tools/gate-metrics.mjs`.

## Controls

| Action | Keys |
| --- | --- |
| Move | `Left` `Right` / `A` `D` |
| Jump / double jump | `Space` `Z` |
| Attack | `J` `X` |
| Interact | `E` `Up` |

Actions are registered at runtime in `scripts/runtime/side_view_runtime.gd`, so
the base does not depend on hand-written `project.godot` input blocks.

## Run

```powershell
# interactive (opens a window)
Godot_v4.7.2-stable_win64.exe --path <this directory>

# pick a world
$env:CRAFTMINE_SIDEVIEW_WORLD = "blank"   # or "ruins" (default)
```

The engine is pinned at `desktop/build/godot/4.7.2-stable/editor/`. The base
never downloads or builds an engine.

## Verify (real physics, headless, isolated)

```powershell
node tools/gate-metrics.mjs     # arithmetic: single jump blocked, double jump passes
node tools/verify.mjs           # 69 checks across 7 scenarios in isolated headless runs
```

`tools/verify.mjs` starts one real Godot process per scenario with
`--headless --fixed-fps 60`, an isolated save directory and a scripted input
plan. It presses buttons through the same input interface a keyboard uses and
reads the runtime probe. It never writes a coordinate, ability, checkpoint or
reward. Scenarios:

| Run | What it proves |
| --- | --- |
| `A_reach_ruins` | room transition by playing, checkpoint activation, one-time cache reward |
| `B_gate_locked` | without the ability, full-height single jumps never reach the ledge or the vault |
| `C_get_ability` | the ability is granted by the real pickup, on the platform, and is written to disk |
| `D_enter_vault` | fresh process: the ability survived restart, fires the double jump, clears the ledge and opens the vault |
| `E_revisit` | return trip keeps ability/checkpoints and never grants a reward twice |
| `F_hazard_respawn` | hazard death respawns at the real checkpoint and keeps progress |
| `G_blank_basic` | the blank start has movement, jump, attack and no ability |

Anti-cheat guards are part of the run: per-tick displacement limits (no
teleport), a source scan that only `place_at` writes the player position, a scan
that the headless verifier cannot write state, and a check that `place_at` is
only called from the room manager and the respawn path.

## Parameters

All tuning lives in `params/side_view_params.json` and is loaded at runtime, by
the acceptance harness and by the docs. Edit that file to retune; nothing else
duplicates the numbers.

## Authoring a new world

```powershell
node tools/new-world.mjs --world ruins --out D:/tmp/my-sideview-world --force
```

That copies the shared runtime plus one world and writes `worlds/default.json`,
which is the `source/` shape the host materializes for a build. World content is
data (`worlds/<id>/world.json`): rooms, solids, spawns, doors, checkpoints,
abilities, rewards, targets and hazards, all keyed by stable string ids.

## Host boundary

The base is game-side only. It does not build, export, launch Godot, read host
credentials or write outside its save directory (`CRAFTMINE_SIDEVIEW_SAVE_DIR`
when set, otherwise `user://save/<worldId>`). The headless verifier is dormant
unless `CRAFTMINE_SIDEVIEW_INPUT_PLAN` is set. See `docs/host-integration.md`.

## Branch proposals

The diggable sandbox is **not implemented** here and is not part of the
metroidvania path. `docs/sandbox-branch-interface.md` records only the interface
and the open questions, so the two are not mixed into one unfinished system.
