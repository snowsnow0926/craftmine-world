# First-person base behaviour spec

Version 0.1.0. This describes observable behaviour that the base already
implements and that the acceptance runs check. It is a specification of *this*
base, not a promise about the product model's work.

## 1 Single source of truth for equipment

`EquipmentState` owns exactly one thing: which catalog item is active, plus that
item's magazine, reserve, cooldown and reload timer. On `equip(id)` it emits
`equipment_changed(id, definition)` and every consumer re-derives from the
returned `EquipmentDefinition`:

| Consumer | Derived from the definition |
| --- | --- |
| `EquipmentVisuals` | `display_mesh`, `display_material`, `mount_offset`, `mount_rotation_degrees`, `display_scale` |
| `Crosshair` | `crosshair_visible`, `crosshair_style` (shape, size, gap, thickness, colours) |
| `AttackDispatcher` | `attack_mode`, `damage`, `cooldown_seconds`, `range_meters`, `pellets`, `spread_degrees`, `melee_arc_degrees`, `hit_mask` |
| `Hud` | `display_name`, `attack_mode`, `magazine_size` |
| `AimQuery` | `hit_mask` (world / damageable / interactable) |

Rules:

- An attack cannot start while `attack_block_reason()` is non-empty
  (`no-equipment`, `no-attack`, `cooling-down`, `reloading`, `empty`).
- `try_begin_attack()` consumes exactly one round for an ammo item and starts the
  cooldown before the behaviour runs. There is no path that deals damage without
  paying that cost.
- A melee item has `magazine_size == 0`, so it never consumes ammunition and its
  `capacity()` is zero.
- The crosshair is hidden for the duration of any item with
  `crosshair_visible == false`; this is the same state that selected the model and
  the attack mode, so they cannot disagree.

## 2 Crosshair

`Crosshair` is a `Control` anchored to the full rect of the root viewport. Its
draw geometry is computed from `size * 0.5`, never from a hard-coded screen
position, so its centre is the centre of the actual viewport at any resolution or
window resize. `measure()` returns the same geometry `_draw()` uses
(`segments`, `center`, `viewportCenter`, `offsetFromViewportCenter`), so a check
and the visible reticle cannot drift apart.

State reactions:

- hit confirmed → `hit_color` for `hit_flash_seconds`
- cooldown running or reloading → `cooldown_color`
- otherwise → `color`

## 3 Held model

`EquipmentVisuals` is a child of `WeaponMount`, which is a child of the real
`Camera3D`. The model's transform is `mount_offset` / `mount_rotation_degrees` in
*camera space*. Consequences that the acceptance checks:

- rotating the camera leaves `model.transform` unchanged and
  `model.global_transform == camera.global_transform * model.transform`;
- the model's world position and forward direction follow the camera;
- a `display_mesh` with no mount rotation points exactly where the camera looks
  (`forwardDot == 1`).

## 4 Attacks

Ranged: a physics ray from `camera.global_position` along `-camera.basis.z`, up to
`range_meters`, against `hit_mask`, excluding the player body. `pellets` rays are
fired; `spread_degrees` widens them around the aim direction using a seeded
generator so a scripted run is reproducible. Each hit calls
`apply_damage(damage, {point, direction, source})` on the collider if it has that
method.

Melee: a sphere sweep placed in front of the camera
(`radius = max(0.25, range * 0.75)`, centred at `eye + aim * range * 0.5`),
filtered to targets whose *collision volume* is within `range_meters + 0.5` and
within `melee_arc_degrees / 2` of the aim direction. The direction is measured
towards the target's `CollisionShape3D` centre, not its scene origin, so a target
whose origin sits on the floor is still inside a forward arc.

Both return `{fired, reason, hits, damage, hit, attackMode, equipment}`.

## 5 Aim and pointing interaction

`AimQuery` casts the same origin/direction every physics frame and exposes
`collider`, `point`, `interactable` and `prompt`. `can_interact()` requires the
hit distance to be within `interaction_distance`. `interact()` calls the aimed
node's `interact()`; the base crate adds reserve rounds through `EquipmentState`
and the pickup adds an inventory stack once.

## 6 Movement

`PlayerController` is a `CharacterBody3D`: gravity, floor snap, `move_toward`
acceleration on the ground and a lower rate in the air, jump on the floor, and
`move_and_slide()` against the scene. `walk(axis, frames)` feeds a scripted axis
through the *same* `_read_move_axis()` path the keyboard uses, so scripted
acceptance exercises the real acceleration, collision and sliding instead of a
teleport.

The mouse is captured only after a real left click
(`capture_mouse_on_click`), and never on the headless display driver, so automated
runs do not request pointer lock.

## 7 Damage feedback

`TargetDummy.apply_damage()` returns `{applied, remaining, destroyed}`, flashes
its material, and emits `damaged` / `destroyed`. `AttackDispatcher` re-emits
`damage_dealt`, which the crosshair turns into a hit marker and the HUD turns into
a floating damage number and a live quest update.

## 8 Quest state

`QuestTracker` records progress from real signals (`damage_dealt`, target
`destroyed`). On completion it sets `status = 2`, grants `reward_reserve_rounds`
and `reward_item` exactly once, and sets `rewardGranted`. `rewardGranted` is part
of the saved state, so a restart cannot pay the reward twice.

## 9 Out of scope for this base

- Multiple worlds loaded at once, world switching UI and migration from the legacy
  runner. The base exposes a `worldId` and namespaces `user://` by it; the
  surrounding world management is the product's job.
- Networking, save encryption, anti-cheat.
- Hot reload of a modified project while a world is running. The acceptance run
  deliberately restarts the process.
