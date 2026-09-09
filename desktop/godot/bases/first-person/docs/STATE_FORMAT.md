# First-person base state format

Format id: `craftmine.godot-base-state/1`
State version: `1`
Written by: `scripts/core/world_state.gd` (capture/apply) and `scripts/core/save_store.gd` (durable file)

The state is plain JSON. It is validated on load; an unsupported version, a
mismatched base or any invalid field is rejected and **nothing is applied**.

## Why the state does not contain damage, cooldown or meshes

Damage, cooldown, range, magazine size, meshes, materials, mount transforms and
crosshair styles are *source*, not progress. They live in `data/equipment/*.tres`
and `data/ui/*.tres`. Changing them is a normal edit and must not require a state
migration, and it must not overwrite what the player has already done. Only
progress that the player produced is stored: position, look direction, magazine
and reserve counts, inventory, target damage and quest progress.

## Envelope

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | string | must equal `craftmine.godot-base-state/1` |
| `stateVersion` | int | `1`; a higher value is rejected as "newer than this base supports" |
| `base` | string | must equal `first-person` |
| `baseVersion` | string | base version that produced the save (informational) |
| `worldId` | string | world identity; a save is only readable by the same world |
| `savedAt` | string | UTC ISO-8601 timestamp, written by `SaveStore` |

## Blocks

### `player`

```json
{"position": [0.0, 0.9, 6.0], "yaw": 0.0, "pitch": 0.0, "onFloor": true}
```

`position` must be three finite numbers, `yaw` within `[-PI, PI]`, `pitch`
within `[-PI, PI]` (the live rig clamps to ±89°). `onFloor` is written for
diagnosis and ignored on load.

### `equipment`

```json
{"active": "pistol", "items": [{"id": "pistol", "magazine": 6, "reserve": 12},
                               {"id": "practice_sword", "magazine": 0, "reserve": 0}]}
```

Every catalog item must be present exactly once. `magazine` is an integer
`0..99999` and is **clamped** to the item's authored `magazine_size`; `reserve`
is an integer `0..99999`. An unknown id, a missing item or a non-integer count
rejects the whole state. Cooldown and reload progress are not saved.

Authored maxima (`magazine_size`, `max_health`, `total_uses`) are source and may
shrink between builds, so a saved value above the current maximum is clamped
rather than rejected: a source edit must not discard the player's progress.

### `inventory`

```json
{"slots": [{"id": "repair_kit", "count": 1}]}
```

Counts are integers `1..9999`, ids unique, at most `capacity` (16) slots.

### `targets`

An array matching the scene's `base_targets` group, ordered by node name:

```json
[{"id": "target_a", "health": 50.0, "destroyed": false, "hitCount": 0, "damageTaken": 0.0}]
```

`health` is a finite number `>= 0`, clamped to `max_health`. `destroyed` must
agree with `health == 0`. The array length must equal the number of state nodes
in the scene and each entry's `id` must equal the node's `state_id()`, so a save
cannot be applied to a different level or to the wrong target.

### `interactables`

An array matching the `base_interactables` group, ordered by node name. Crate
entries carry `usesLeft`; pickup entries carry `taken`. Length must match.

### `quests`

```json
{"quests": [{"id": "range_basic", "status": 1, "count": 0.0, "rewardGranted": false}]}
```

`status`: `0` inactive, `1` active, `2` completed. `count` is
`0..required_count`. `rewardGranted` may only be true when `status == 2`. Every
quest in the scene must be present; unknown ids are rejected. This is what makes
a completion reward pay out exactly once, including across a restart.

## Example

```json
{
  "format": "craftmine.godot-base-state/1",
  "stateVersion": 1,
  "base": "first-person",
  "baseVersion": "0.1.0",
  "worldId": "local-world",
  "savedAt": "2026-09-09T12:34:56Z",
  "player": {"position": [0.0, 0.9, 2.2], "yaw": 0.0, "pitch": 0.0, "onFloor": true},
  "equipment": {"active": "pistol", "items": [
    {"id": "pistol", "magazine": 6, "reserve": 10},
    {"id": "practice_sword", "magazine": 0, "reserve": 0}
  ]},
  "inventory": {"slots": [{"id": "repair_kit", "count": 1}]},
  "targets": [
    {"id": "target_a", "health": 50.0, "destroyed": false, "hitCount": 0, "damageTaken": 0.0},
    {"id": "target_b", "health": 26.0, "destroyed": false, "hitCount": 2, "damageTaken": 24.0},
    {"id": "target_c", "health": 50.0, "destroyed": false, "hitCount": 0, "damageTaken": 0.0}
  ],
  "interactables": [
    {"id": "AmmoCrate", "enabled": true, "usesLeft": 3},
    {"id": "RepairKit", "enabled": true, "taken": false}
  ],
  "quests": {"quests": [{"id": "range_basic", "status": 1, "count": 0.0, "rewardGranted": false}]}
}
```

## File location and durability

`user://worlds/<sha256(worldId)>/state.json`

`SaveStore.save()` validates the state, writes `state.json.tmp`, checks the write
result, then replaces `state.json`. An interrupted write therefore cannot leave a
half-written save. `load_state()` re-checks the format and the `worldId` before
handing the state to `WorldState.apply()`.

## Migration policy

`WorldState._migrate()` is the only place a new `stateVersion` may be handled. It
currently accepts version 1 and rejects anything else; there is no guessing at
missing fields. Adding a field means: keep the old field readable, add the new
one, bump `STATE_VERSION`, and add an explicit step in `_migrate()`. Never
silently drop player progress.
