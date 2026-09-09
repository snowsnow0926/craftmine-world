# Cycle 06 bases: real Web persistence and visible gameplay

E/F/G now have actual Godot Web + offscreen Electron + Rust acceptance, with complete process restart comparison. The final combined run passed 42 checks: E 12, F 15 and G 15. No saved field is removed or normalized to make that comparison pass. The previous native suite covered only E.

## Changes

- Added read-only managed `observe` for each base and bounded G virtual controller segments. G movement, jumps, pickup and attack run through the ordinary physics/input contract. F managed operations now explicitly reject standalone teleport, scene switch and reset helpers; move/wait input is bounded. Neither change grants product tools arbitrary execution or state-setting permission.
- Fixed F movement holding a freed player after crossing a real door. Door scene replacement now runs after the Area2D physics flush, removing a real Godot error that appeared over the shop screen. Both committed generated examples and their hashes match regeneration.
- Fixed G room backgrounds covering the live player. A plain Node room manager disconnected the CanvasItem hierarchy; using Node2D keeps the room background below the Player sibling. A live/visible player node was insufficient proof: the new screenshot assertion verifies actual player pixels.
- Generalized the existing native fixture for three bases, retained E's durability/exit checks, and added bad-state atomicity, full state protection after storage failure, renderer diagnostics, pixel evidence and source provenance. The real production host and adapter are bundled, while executor registration/application seeding remain test fixtures.

## Accepted evidence

All paths below are inside the archived `evidence/` directory. `raw-evidence-index.json` records each original path, archive path, byte count and SHA-256. The archive contains 177 exact-byte raw files (2,839,480 bytes); its local attributes prevent line-ending conversion. Generated Godot projects, engine copies and Web binaries remain in the independent test-results directories and are not duplicated into Git. Per-base `managed-base.json` records source hashes.

| Run | Result | What it establishes |
| --- | --- | --- |
| godot-runtime-native-2xS6qX | 42/42 | Final three-base actual Web/Electron/Rust chain, captured images, no Godot errors/status overlay, no input/focus/Pointer Lock calls, every native field preserved across full restart |
| godot-managed-progress-mqgWG4 | 20/20 | Headless full-state and atomic invalid-state cases, receipt binding, original timestamp, real entity damage |
| g6-bases-regression-AeSkoI | F 40/40, G 80/80, sync 2/2 | Standalone actual physics, animation, proximity, shops, one-shot rewards, ability gates, room visits, damage, restart and generated examples |
| godot-runtime-native-b9ri2m | F 15/15 | Clean real shop render after deferred door fix, full restart |
| godot-runtime-native-Ew3Mpy | G 15/15 | Visible player after canvas hierarchy fix, full restart |

F's managed run walks to a herb patch, gathers three herbs, delivers the quest once, walks through the real doorway, buys bread at the real merchant and saves a non-entry position facing left. Restart preserves shop scene, coordinates/facing, 64 coins, bread and reward apple, stock, quest and reward ledgers. Out-of-range gathering/buying and duplicate delivery reject.

G's managed run crosses the spike pit into ruins, jumps to collect double jump, approaches and attacks the live dummy. Its health changes from 2 to 1 in both the live node and entity ledger. Full restart retains room, position, ability, entity health, vitals and all other native fields. The final image contains 3,200 matching player-colored pixels. More extensive room/checkpoint/reward and hazard/death scenarios remain covered by the 80-check original physics suite.

Each native base rejects foreign outer world, foreign native world, future version and malformed player without any partial mutation. Injected Rust storage failure blocks departure/quit and leaves the entire checkpoint unchanged. A subsequent successful save and full Electron/Rust shutdown/relaunch restore that checkpoint exactly. The test retains all schema fields, including savedAt and contact observations. Existing transient controller velocity, animation frame and active hitbox exclusions have not changed.

The final combined run read the sibling's production host containing its pending-view bounds fix. The report records source SHA-256 `cdf13e717c5013b077189a49da41b5cf8b65452e93023e4ca5b6fca6fc4ee972`, verified unchanged after the run, and the stable core executable hash. Integrate that host change alongside this branch; it is not copied into this branch. The core binary was the read-only `D:/cm-g6-root/test-results/runtime-core-g6initial.exe` snapshot.

## Preserved failures and superseded checks

| Run | Outcome and interpretation |
| --- | --- |
| godot-runtime-native-k5Essp | Failed F delivery because the scripted walk stopped outside actual NPC range. Corrected the route; did not weaken proximity rules. |
| godot-runtime-native-ALHp5q | Old F logic suite reported 14 checks but screenshot exposed physics-flush errors. Superseded; not clean render acceptance. |
| godot-runtime-native-HxdpAV | Old G logic suite reported 13 checks while the player was invisible under the room background. Superseded; not visible gameplay acceptance. |
| godot-runtime-native-27FDal | Stronger G pixel assertion correctly failed: live node visible=true but zero player pixels. This is the direct failing evidence for the canvas fix. |
| godot-runtime-native-qRqcMv | Earlier E 11-check pass; retained as the export source shared for sibling candidate testing, superseded by final E 12 checks. |

An initial managed-progress launch in the fresh worktree failed before creating its run directory because test-results did not exist. The runner now creates the parent directory; no raw file existed for that startup error. A later 20-check run succeeded. The archive preserves the actual gameplay/render failures instead of relabeling them as accepted runs.

## Limits and remaining work

This is fixed repository-authored project evidence with **zero model calls**. It proves the runtime/base/durable storage chain under the fixture, not model creation quality, OS sandbox enforcement, the complete production main coordinator, release readiness or A17. Those remain separate parent/host/executor work. It does not claim manual player-feel or real input acceptance. There were no real mouse/keyboard calls, user-browser actions, foreground windows or requested Pointer Lock.

The final renderer logs still contain software-offscreen WebGL framebuffer/buffer warnings, including zero-size attachment messages, despite nonempty clean final images and no Godot script/engine errors. The host's initial bounds fix alone did not eliminate them. Their exact remaining origin is not established here; they are retained in renderer-console.jsonl and the reports. The zero-Godot-error assertion must not be described as zero renderer warnings. No further severe base-state defect was found in the exercised paths; that is a bounded conclusion, not a claim that all base behavior has been tested.

Reproduce with the pinned Godot cache and dependency/core/Electron paths documented in `desktop/godot/shared/README.md`; the default native command runs all three bases. No shared cache, dependency, licensing declaration or other worktree was edited. No merge, push or cleanup was performed by this agent.
