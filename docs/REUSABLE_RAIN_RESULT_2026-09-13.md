# Reusable rain-control delivery

Implemented `cw.module.rain-control@1` as a normal playable source-library package
for existing creation-sandbox worlds. The package is 13,968 bytes, below both the
4 MiB source and 5 MiB ZIP limits. It adds one rain volume and a small HUD while
keeping the existing player, camera, ground, environment and authored world.
All 22 previously shipped library entries retain their exact IDs, versions and
payload hashes; a new fixture pins those entries from the sealed Windows client.

Controls: U suspends rain and then reverses it, I restores normal rain and cancels
automatic casting, O performs a complete automatic sequence. The same 2,200
drop positions are integrated in both directions. Suspended rain remains fixed
while the player moves. Controls are configurable, do not mutate InputMap and
reject existing unmodified action bindings. F2/world pause blocks simulation and
casting. Different raw-key scripts still need agent review when composing skills.

The existing component ledger stores exact float32 drop heights in four base64
chunks plus phase, velocity, phase age, clock, cast count and automatic intent.
The captured state in the fixture is 12,038 bytes. Invalid state is rejected
before mutation. Duplicate weather owners, including the original rain world's
legacy control contract, fail validation instead of silently doubling weather.

Native verification passed **35 checks**, plus **6 checks in a second engine
process** restoring an on-disk saved world and rain state. The actual original
creation controller moved the player 5.74 world units while all suspended drop
heights remained equal. Reversal, return to normal rain, continued automatic
timers, cancel without delayed restart, paused input, invalid restores and
conflicting keys/owners passed. Protected world/player/camera/project source and
the complete approved rain-world source inventory stayed unchanged. No AI calls
or player profiles were used.

Ten package/source/catalog regressions passed, including deterministic wrapper
line endings, inherited shader provenance, source-scene insertion and the exact
original 22 payload hashes. The existing library builder now produces 23 entries
in this branch; other parallel components are integrated by the parent task.

The first native attempt is retained in evidence. It found the optional ledger
validator needed the existing zero-argument signature and confirmed that Godot's
headless dummy renderer cannot supply meaningful MultiMesh transform readback.
Both were addressed without adding a production startup probe. Final native
tests prove simulation, mesh-resource construction and persistence; they do not
claim visible rendering, engine FPS, full product installation or human playtest.
The integrated client must separately render and adopt the package normally.

Source and repeatable checks:

- `desktop/godot/components/rain-control/`
- `desktop/build-rain-control-package.mjs`
- `tests/rain-control-package.test.mjs`
- `tests/godot-components/rain-control.mjs`
- `docs/evidence/reusable-rain-20260913/native-final.json`
- `docs/evidence/reusable-rain-20260913/native-first-failure.json`

Current limitations: a fixed local volume, no roof occlusion, no courtyard or
global sky replacement, one weather owner per world, and explicit source-profile
compatibility. The code, shader and procedural geometry are distributed with MIT
license and accepted-source provenance. Existing gameplay inputs and camera
ownership remain with the target world.
