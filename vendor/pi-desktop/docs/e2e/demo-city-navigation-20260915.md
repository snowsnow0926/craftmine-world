# Retained city navigation acceptance

Run `tests/city-companion-navigation-native.mjs` with three explicit arguments:
an extracted original test-only demo source directory, its `initial.json`, and
the pinned Godot executable. The fixture must match the repair planner's source
hashes. This is a deterministic, model-free engine regression, not an ordinary
player or AI creation acceptance run.

The runner copies the source to an independent directory, applies the planned
wrapper replacement, imports using headless Godot, then performs ordinary adapter
restore from the actual exported saved state. It simulates 3,000 physics frames,
requires arrival near the player on the upper ramp, bounds per-frame displacement
to reject teleportation, and invokes the original collision placement validator.
It verifies the player, inventory, opened chests, doors, rules, both companion
identities/settings/source settings/interaction counts and the waiting companion's
position. A separate cold engine process restores and compares the complete JSON
wire state. Published v2 source bytes must remain identical; warnings or errors fail.

Before repair, retained source produces a stationary companion despite nonempty
routes. The intermediate navigation repair exposes `PET_RESTORE_TRANSFORM_UNSUPPORTED`
after repeated turns; this failed run remains in local evidence. The final wrapper
passes 23 engine assertions including complete cold restore, with maximum observed
per-frame displacement approximately 0.0471 metres.

Product acceptance additionally uses an independent hidden/offscreen desktop
profile and the ordinary history source save/check/preview/apply sequence. It must
verify actual Web runtime movement, save and cold reopen, then publish/export a
new template via existing product UI. Do not mark that layer passed from the CPU
fixture alone. No OS input, foregrounding, Pointer Lock, model substitution, database
mutation or invented saved positions are permitted.
