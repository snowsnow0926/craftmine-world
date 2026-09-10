# ADR P1: additive progress migration for equipment added by a candidate

Status: implemented and verified on the pinned engine (`4.7.2-stable`).
Owner: P1 (save compatibility). Files: `desktop/godot/shared/progress-migration.mjs`,
`vendor/pi-desktop/crates/craftmine-core/src/godot_additive_progress.rs`,
`tests/godot-final-install-assets/progress-migration*.mjs`.

## Context

A real model action added one equipment definition (`thunder_hammer`) to the
first-person catalog. Every save written before that action has no entry for the
new identity, and the base refuses to restore it:

```
State is missing equipment: thunder_hammer
```

`equipment_state.gd::restore` requires one saved entry per catalog item, because
the catalog is authored source and the save must describe every item the player
can select. The previous additive migration only merged `body.targets` and
`body.interactables`, so a candidate that grows the equipment catalog made old
saves unloadable. Loosening `restore` (for example by inventing ammunition for
missing ids, or by skipping catalog items) would silently discard real progress
and would move an authoring concern into the runtime loader.

## Decision

The existing additive migration is extended to the fixed path
`body.equipment.items`, with the same rule set that already governs targets and
interactables. There is still exactly one migration entry point, it takes exactly
two snapshots, and it accepts no caller-supplied path, rule, default or deletion
semantics.

`deriveAdditiveProgress(previousSnapshot, defaultsSnapshot)` is pure:

1. `previousSnapshot` is the world's saved progress (the trusted check input).
2. `defaultsSnapshot` is captured from a fresh process running the candidate
   scene, never edited by hand and never derived from the old save.
3. The result is a new snapshot in which every old identity keeps **every** field
   exactly as saved, and every identity that only the candidate scene knows takes
   the values captured from that scene.

Per-field rules for `body.equipment` (both snapshots are validated first):

| Field | Rule |
| --- | --- |
| `equipment` keys | exactly `active` and `items`; unknown keys are rejected |
| `active` | string and must name an item present in that same snapshot |
| `items` | array, at most 4096 entries, ids unique, non-empty, at most 256 code units |
| item keys | exactly `id`, `magazine`, `reserve`; unknown keys are rejected |
| `magazine`, `reserve` | integers in `0..99999` (fractions, strings, booleans, negatives and out-of-range values are rejected) |
| removed identity | an id present in `previousSnapshot` but absent from `defaultsSnapshot` is rejected (`MIGRATION_ENTITY_REMOVED` / `GODOT_ADDITIVE_REMOVAL_REJECTED`) |
| changed shape | an old entry whose key set or field kinds differ from the candidate entry is rejected |
| selection | `active` is copied from the old save, so a candidate cannot silently reselect the player's weapon |
| order | the merged list follows the candidate scene order, which is also the order the native `snapshot()` writes, so the saved order stays canonical |

`active` is deliberately *not* taken from the candidate scene: the model authors
which item a fresh world starts with, but an existing player's selection is
progress. The same rule already applies to damaged targets.

## Trust boundary

Two independent derivations must agree:

- JavaScript (`progress-migration.mjs`) runs in the host candidate coordinator to
  produce the proof that travels with the check output.
- Rust (`godot_additive_progress::derive`) re-derives from the trusted check
  descriptor snapshot and the stored `defaultsSnapshot`, and
  `validate_prepared` requires the prepared input to equal the core derivation
  (`APPLICATION_PROGRESS_CHANGED` otherwise).

The core therefore never trusts the JavaScript proof: `verify_proof` recomputes
the snapshot and the `added` list and compares them, so an inflated magazine, a
hidden addition, a rewritten old entry or a swapped defaults block is refused.
The hashes in the proof are diagnostic only and are intentionally not compared,
because JavaScript canonical JSON and `serde-json/1` spell integral floats
differently.

## Consequences and known limits

- A candidate may add equipment; it may not remove or rename an existing identity.
  Removing a definition is a player-visible loss, so it stays refused instead of
  guessing at a replacement.
- A candidate may not change the ammunition of an item that already exists in the
  save. Authored ammunition only reaches a save at the moment the identity first
  appears; `equipment_state.gd::restore` still clamps a saved magazine down to the
  current authored `magazine_size`, so shrinking a magazine cannot discard the
  player's rounds.
- A save that predates several identities gains all of them at once from the same
  candidate capture; there is no per-item migration step or version stamp.
- Observed but not changed here: the native `equipment_state.restore` tolerates a
  duplicated id inside the `items` list (last entry wins). The core rejects
  duplicates before any snapshot is written, and the world store only ever holds
  snapshots that passed `validate_prepared`, so this is not reachable through the
  product path. It is recorded rather than patched so that a save-format decision
  is not smuggled into this change.

## Verification

- `node --test tests/godot-final-install-assets/progress-migration.test.mjs` — 10
  pure derivation tests, including a save that predates several items, a no-op
  candidate, input immutability and both-sided rejection.
- `cargo test --locked -p craftmine-core` — 298 passed, 0 failed, 7 ignored, with
  6 equipment tests in `godot_additive_progress::equipment_tests` and equipment
  additions and forgeries inside `godot_applications::tests`.
- `node --test tests/godot-final/additive-protocol-host.mjs` — 3 host-protocol
  tests, including "defaults differing from the independently bound core result
  cannot stage or promote".
- `node tests/godot-final-install-assets/progress-migration-native.mjs` — 14
  headless engine runs from the pinned cache: capture an old training-range save
  (damage, fired rounds, a reload and a changed selection), add a definition and a
  catalog entry to a candidate source copy, capture the defaults from a fresh
  process, show that the unmigrated save is still refused with
  `State is missing equipment: thunder_hammer`, derive, load, save durably and
  reopen in a fresh process, then confirm the added item is usable by equipping it
  and dealing its authored 35 damage to a real target.
