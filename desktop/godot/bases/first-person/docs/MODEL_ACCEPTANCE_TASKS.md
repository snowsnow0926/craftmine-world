# Model acceptance tasks for the first-person base

For task I. These are the model-facing exam questions and their frozen
assertions. **None of them is implemented in this base.** The base provides the
blank starting point, the training range, the shared runtime and the assertion
harness; the model must author the work below from `scenes/blank_start.tscn` (or
a copy of it).

Status of this document: authored specification. It is not evidence that a model
has passed. Passing evidence must come from a real run of the assertion harness
against a real model-authored project.

## 0 Preconditions given to the model

- The base project at `desktop/godot/bases/first-person` (this directory), Godot
  4.7.2-stable, GDScript, `gl_compatibility`.
- Entry scene for the task: `scenes/blank_start.tscn`.
- The read/write tools for project files, and the ability to import and run the
  project headlessly.
- The assertion style of `tests/acceptance_headless.mjs`: a JSON command list
  (`{op, args}`) executed by `scripts/adapters/probe_runner.gd` against the real
  runtime, with the result printed as one `CRAFTMINE_FP_BASE=<json>` line.
  Available ops: `snapshot`, `equip`, `look`, `attack`, `reload`, `interact`,
  `walk`, `wait`, `resize`, `crosshair`, `hud`, `state`, `save`, `restore`,
  `restore-state`, `next-equipment`, `probe-aim`.
- The model may add scenes, scripts, resources and assets. It may not change
  `tests/`, the adapters, or the assertion definitions in this file.

## 1 Task M1 — burst-fire marksman rifle

**Goal.** From the blank start, add a second ranged weapon `marksman_rifle` with
its own authored mesh, material, crosshair style and parameters, registered in
the equipment catalog.

**Required behaviour.**

1. One attack input fires a burst of exactly three rays; the whole burst is
   resolved within 0.15 s of the input.
2. Each ray applies the item's `damage` to the collider it hits.
3. The item has `magazine_size = 12`, `starting_reserve = 24`,
   `cooldown_seconds >= 0.75`, and a non-zero `reload_seconds`.
4. A burst consumes exactly three rounds. If fewer than three rounds remain, the
   burst is refused as a whole and no round is consumed.
5. The rifle's crosshair is visible and uses a style that is not the pistol's.
6. Magazine and reserve are part of the saved state; damage, cooldown, mesh and
   crosshair style are source and are not.
7. The pistol and sword keep their existing behaviour.

**Frozen assertions.** Each is a hard pass/fail check.

| Id | Assertion |
| --- | --- |
| M1.A1 | The catalog contains `marksman_rifle`, and `next_id('pistol')` returns it. |
| M1.A2 | `equip marksman_rifle` yields `display.meshPath` ending in the new mesh, `equipment.attackMode == "RANGED"`, `crosshair.visible == true`, and `crosshair.shape` equal to the new style's shape (not the pistol's). |
| M1.A3 | With at least three rounds, one `attack` yields `fired == true`, `hits.length == 3`, total applied damage equal to `3 × damage`, all on the same target, and `equipment.magazine` decreased by exactly 3. |
| M1.A4 | An `attack` issued immediately after a burst yields `fired == false`, `reason == "cooling-down"`, and an unchanged magazine. |
| M1.A5 | With exactly two rounds remaining, `attack` yields `fired == false`, `reason == "empty"`, and an unchanged magazine. |
| M1.A6 | `reload` increases the magazine by `min(capacity - magazine, reserve)` after the authored reload time and decreases the reserve by the same amount. |
| M1.A7 | `save`, then a brand-new process, then `restore`, reproduces magazine, reserve and every target's health exactly. |
| M1.A8 | Editing the rifle's `damage` in its `.tres` and re-importing changes the damage of the next burst while M1.A7's restored progress is preserved. |
| M1.A9 | The pistol still has its original damage, cooldown, magazine size and crosshair style, and the sword still uses `MELEE` with no ammunition. |
| M1.A10 | Switching pistol → sword → rifle → pistol keeps model path, crosshair visibility and attack mode consistent with the active item at every step. |

## 2 Task M2 — patrolling moving target

**Goal.** Add a `PatrolTarget` that moves between two authored waypoints using
real physics, is damageable and destructible, and whose progress is saved.

**Required behaviour.**

1. It moves continuously between two waypoints at a non-zero speed, on the
   ground, without teleporting.
2. It is hit by the existing ranged and melee attacks through the normal
   `apply_damage` path.
3. Its health, destroyed flag and position are part of the saved state.
4. It counts towards the existing quest objective that counts destroyed targets.

**Frozen assertions.**

| Id | Assertion |
| --- | --- |
| M2.A1 | Two snapshots 1 s apart while alive show a position change of at least 1 m. |
| M2.A2 | Every sampled position is within 0.1 m of the authored waypoint segment, and `player.onFloor`-style ground contact holds for the target (its y stays within 0.05 m of the floor height along the whole path). |
| M2.A3 | A real `attack` that reports the patrol target as its collider reduces its health by the equipped item's damage and increments its `hitCount`. |
| M2.A4 | After health reaches zero, `destroyed == true`, further damage applies 0, and its position stops changing. |
| M2.A5 | `save`, new process, `restore` restores health, destroyed flag and a position within 0.25 m of the saved position. |
| M2.A6 | Destroying the patrol target advances the quest counter by exactly one, and completing the quest still grants its reward exactly once across a restart. |

## 3 Task M3 — reticle driven by the same real state

**Goal.** Make the reticle react to real movement, cooldown and confirmed hits
without introducing a second copy of any gameplay state.

**Required behaviour.**

1. The drawn reticle grows while the player is actually moving and shrinks when
   the player stops, using the player's real velocity.
2. The reticle colour follows the live cooldown and the hit confirmation, exactly
   as the base already does for its own styles.
3. Nothing is stored outside `EquipmentState` / the player controller that a
   second consumer could contradict.

**Frozen assertions.**

| Id | Assertion |
| --- | --- |
| M3.A1 | The bounding box of `crosshair.segments` while walking at full speed is strictly larger than while standing still, by at least 2 px on each axis. |
| M3.A2 | While `equipment.blockReason == "cooling-down"` or `"reloading"`, `crosshair.color` equals the style's `cooldown_color`; once ready it returns to the style's `color`. |
| M3.A3 | Within one physics frame of a confirmed hit, `crosshair.color` equals the style's `hit_color`; after `hit_flash_seconds` it returns to the style's `color`. |
| M3.A4 | `crosshair.offsetFromViewportCenter` stays within 0.5 px at 1280×720, 800×600 and 1920×1080. |
| M3.A5 | Reverting only the new reticle behaviour reproduces the base reticle byte-for-byte in `crosshair.segments` and `crosshair.color`, proving no residual state was added elsewhere. |

## 4 Evidence each task must produce

For every task, the model's report must contain:

1. The list of files it created and modified, with the project-relative paths.
2. The command it ran and the full `report.json` produced by the assertion
   harness, including a failed check if any check failed.
3. For M1: the authored `.tres` values and the new mesh file.
4. For M2: a sampled trace of the target position over at least 2 s.
5. For M3: the `crosshair.segments` and `crosshair.color` values for the
   still, moving, cooling-down and post-hit cases.
6. The first failure it hit and how it was repaired, if any.

## 5 What does not count as passing

- A HUD text label standing in for a reticle, or a reticle drawn at a fixed
  screen coordinate instead of the viewport centre.
- A burst implemented as one ray with multiplied damage, or as three inputs that
  the harness had to space out itself.
- A moving target that teleports, or that is animated visually while its
  collision body stays put.
- Ammo, damage or cooldown values read from a second source that can disagree
  with `EquipmentState`.
- Assertions edited, skipped, weakened, or a `report.json` that was written by
  hand rather than produced by the run.
- Passing only on the Web export or only headlessly when the task's assertions
  require both.

## 6 How task I should consume this

Task I owns the frozen assertion harness and the scoring. This file supplies the
questions and the assertions; the base's own `tests/acceptance_headless.mjs`
already demonstrates the harness pattern (real engine, real physics, real
filesystem, isolated profile, no input simulation) that the model tasks should
reuse. Task I should keep the assertion ids above stable, add the model's project
as a separate artefact, and record failures in the denominator rather than
retuning the assertions after seeing them fail.
