# Reused side-view foundation — declared dependency

The mining sandbox is a **separate base** (`desktop/godot/bases/mining-sandbox/`),
not an extension of the side-view base. It reuses the side-view 1.0.0 movement
model instead of writing a second one, and this file records exactly what was
taken, from which bytes, and what was deliberately not taken.

Frozen source: `side-view` `baseVersion 1.0.0`, `baseProtocolVersion 1`, engine
`4.7.2-stable`, present in this repository at commit `e462147` (the base itself
landed in `564e43a`, cycle 06). The side-view directory is **read-only** for this
task: no file under `desktop/godot/bases/side-view/**` or
`desktop/godot/shared/**` was modified.

## Source files and hashes

| Source (read-only) | SHA-256 | Used for |
| --- | --- | --- |
| `desktop/godot/bases/side-view/scripts/player/side_view_player.gd` | `2194ad1ce2427c86bec2219a791e0531cf4f1144a656149078a00306eaa14d05` | movement model, body conventions, camera smoothing, scripted input hook |
| `desktop/godot/bases/side-view/scripts/player/input_source.gd` | `bd6a12ce4f1389a2e583bcba5970600e7fc7420452b28158de3d757981bc7cd5` | `InputSource` abstraction (human and scripted input share one path) |
| `desktop/godot/bases/side-view/scripts/player/human_input_source.gd` | `b36175bbc02dcbeaee09ddf483328927c9e1735e77308ba4f859cb381f6d6597` | real input source shape |
| `desktop/godot/bases/side-view/scripts/player/scripted_input_source.gd` | `d1e4a37a2fd96838165546dc2e74c6acdcb081d06047cf0a5e2fd68f5a3961c6` | scripted input source shape used by the probe |
| `desktop/godot/bases/side-view/scripts/runtime/side_view_config.gd` | `80cd3440b4855eacd55f2248ea94d324e40610b9542b8e7a4d442bfbce487b59` | typed parameter loading from a single JSON source |
| `desktop/godot/bases/side-view/params/side_view_params.json` | `fe804eed0415ef9635d481d44ad114c7ca0d4e5cc6ec77f19a5b8595ed61de06` | the movement numbers inherited unchanged |
| `desktop/godot/bases/side-view/manifest.json` | `fd09410510beae7b8b18e282332f7026c95e1298d8955ae0c0843b38b2b17cc0` | base manifest conventions (`craftmine.godot-base/1`) |
| `desktop/godot/bases/side-view/project.godot` | `27c7e16e8672f7f974daac8f5d265a1c564dd10ba12bb97fe4849ea0fa9f9274` | project settings conventions (viewport, physics tick, renderer) |

`tests/godot-remaining/G/a16-acceptance.mjs` (assertion G34) re-hashes these
files on every run, so this table cannot silently rot.

## What is reused verbatim

1. **Movement numbers.** `params/mining_sandbox_params.json` `movement` copies the
   side-view values unchanged: gravity 1800, maxFallSpeed 1200, runSpeed 260,
   groundAccel 2400, groundDecel 2600, airAccel 1800, airDecel 900, jumpVelocity
   -700, coyoteTime 0.1, jumpBufferTime 0.12, jumpCutMultiplier 0.45, up = up.
2. **Body conventions.** Origin at the feet, `MOTION_MODE_GROUNDED`,
   `up_direction = UP`, +Y down.
3. **Camera.** `Camera2D` with smoothing and world-bound clamping (the sandbox
   clamps to the finite map instead of a room).
4. **Input abstraction.** `InputSource` / `HumanInputSource` / `ScriptedInputSource`
   with the same `poll(delta)` contract, so the probe drives the same code path a
   player does.
5. **Parameter single source.** One JSON file read by the runtime and the tools;
   no tuning constants duplicated in scripts.

## Declared deviations (not silent retunes)

| Deviation | Reason |
| --- | --- |
| Body is 12x26 px instead of 10x40 px | A one-tile-wide (16 px) shaft must be walkable and diggable; a 10 px half-width body cannot fit a 1-tile tunnel with wall collision. |
| No `room_manager` lifecycle | The sandbox has a finite chunked map, not one room at a time; the side-view manager frees a room on transition, which is the wrong lifecycle for digging. |
| No ability gates, hazards, checkpoints, attack hitbox | Out of scope for GD5/A16; those stay with side-view. |
| Attack/health are not carried over | The sandbox has no combat; `health` is stored for schema stability only. |

## What F must own for the shared surface

The shared adapter and materializer belong to task F (`desktop/godot/shared/**`
is read-only here). The contract this base needs is written in
`docs/INTERFACE_BC.md` section 4 and a reference adapter implementation is
provided as `contracts/shared-adapter.mining-sandbox.gd` for F to place at
`desktop/godot/shared/adapters/mining-sandbox.gd`. Until F lands it, this base
ships its own `tools/new-world.mjs` materializer and is **not** registered as a
delivered base in the product enumerations.
