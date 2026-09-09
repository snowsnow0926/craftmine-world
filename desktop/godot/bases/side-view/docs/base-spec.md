# Side-view base behaviour spec

Base id `side-view`, base version `1.0.0`, state version `1`. Engine
`4.7.2-stable`, GDScript, `gl_compatibility`, 60 Hz physics.

## 1 Scope

The base owns movement, collision, camera, attack, checkpoints, room
transitions, persistence and the observable probe. It does not own world
identity, build/apply transactions or model tooling: those stay with the host.

## 2 Movement model

All values come from `params/side_view_params.json`. With the shipped numbers:

| Quantity | Value |
| --- | --- |
| gravity | `1800 px/s²` |
| run speed | `260 px/s` |
| ground accel / decel | `2400` / `2600 px/s²` |
| air accel / decel | `1800` / `900 px/s²` |
| jump impulse | `-700 px/s` |
| double jump impulse | `-640 px/s` |
| max fall speed | `1200 px/s` |
| coyote time | `0.10 s` |
| jump buffer | `0.12 s` |
| variable jump cut | `0.45×` on release while rising |

Derived reach (constant-gravity impulse, which is what the controller does):

- single jump rise `v²/2g = 700²/3600 = 136.111 px`
- double jump extra rise `640²/3600 = 113.778 px`
- maximum total rise `249.889 px`, achieved by firing the second impulse at the
  apex. Firing earlier is strictly worse because the second impulse **sets**
  vertical velocity instead of adding to it.
- single jump air time `0.778 s`, horizontal reach `202 px`
- double jump air time `1.100 s`, horizontal reach `286 px` (apex-triggered)

There is no wall slide and no wall jump. The ledge face is a plain vertical
wall, so a jump cannot be converted into height.

## 3 The gate

`worlds/ruins` declares a gate:

```json
{ "id": "gate_vault_ledge", "requiredRise": 190.0, "requiredAbility": "double_jump",
  "from": { "x": 810, "y": 440 }, "to": { "x": 880, "y": 250 } }
```

The ledge solid occupies `x 820..960, y 250..440`, so its left face is a wall
from the floor up to the ledge top. The only route onto the ledge is a vertical
jump from the floor beside it.

- single jump: `136.111 < 190` → blocked with `53.889 px` margin
- double jump: `249.889 > 190` → passes with `59.889 px` margin

`tools/gate-metrics.mjs` recomputes both margins from the parameters and the
world data and fails if either condition stops holding. That is a separate,
arithmetic proof; the headless runs then confirm it in real physics.

## 4 Combat

`attackCooldown 0.35 s`, active window `0.12 s`, reach `34 px`, height `30 px`,
damage `1`. The attack area is an `Area2D` on mask layer 4, toggled on for the
active window. Hits are resolved from `get_overlapping_areas()` against targets
with `receive_hit(damage, facing)`, so a hit is a real overlap, never a scripted
call. Targets (`dummy`, `breakable`) drop their one-time reward exactly once,
keyed by `rewardId` in persistent state; a rebuilt room does not respawn a
defeated target.

## 5 Checkpoints, hazards, death

Checkpoints are `Area2D` volumes with a stable id. Touching one sets
`activeCheckpoint` and saves. Hazards deal the player's full health through the
normal damage path, so death, the respawn delay and the respawn position are the
same code a boss fight would use. Respawn returns to the active checkpoint in
the current room and saves.

## 6 Rooms and return paths

One room is alive at a time; the player node is persistent. Room exits are
full-height `Area2D` volumes, so a jump that crosses a room edge still
transitions. On entry the player is placed at the named spawn and doors are
armed two physics frames later, which removes any bounce-back loop.

`worlds/ruins` rooms and links:

```
entrance  <-- door_entrance_east / door_ruins_west -->  ruins  <-- door_vault / door_vault_west -->  vault
```

The vault return spawns the player on the ledge (`spawn_from_ledge`), so the
return path does not require re-clearing the gate.

## 7 Persistence

`craftmine.godot-sideview-state/1`, one file per world at
`<save root>/<worldId>/state.json`. Written atomically: temp file, previous file
moved to `state.json.bak`, temp renamed into place, with a rollback if the
rename fails and recovery from `.bak` if a crash lands between the two steps.

Persisted facts, all keyed by stable string id:

- `abilities` — `double_jump` and future ids
- `checkpoints` (activated) and `activeCheckpoint`
- `rewards` (one-time, never granted twice)
- `rooms` — `visited` and `entries`
- `counters`, `inventory`
- `player` — room, x, y, facing

Save triggers: room entry, checkpoint, ability, reward, target defeat, death,
respawn, run end. A state version mismatch is refused rather than silently
cleared; migration belongs to the host.

## 8 Observable interface

`SideView.probe()` returns a read-only snapshot (`craftmine.godot-sideview-probe/1`)
with abilities, checkpoints, rewards, rooms, counters, inventory, the player
placement and a `stateHash` over the persistent facts. There is no setter. The
headless verifier writes `craftmine.godot-sideview-run/1` traces containing the
per-tick samples and the full event log.

## 9 What this base does not claim

- no diggable sandbox, terrain editing or chunked storage (see the branch
  proposal)
- no animation, audio, dialogue, shop or quest systems
- no engine-level isolation; isolation belongs to the host executor
- the acceptance runs prove headless physics and state, not GPU rendering,
  visible composition or player feel

## Integration audit persistence requirements

See [the shared authored-base audit contract](../../tests/PERSISTENCE_AUDIT.md) and
[the state-boundary decision](../../tests/ADR-0001-audit-state-boundary.md).
Foreign or rejected progress must not mutate live state or overwrite the prior save.
The audit regression entry point is `desktop/godot/bases/tests/audit-persistence.mjs`.
