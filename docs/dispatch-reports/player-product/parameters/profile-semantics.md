# Profile-aware parameter source contract

Code commit `e85afaa` consumes Plato's explicit-override base compatibility fix
`a0c9186` (already integrated separately by root). This code commit changes no
base script. The supported target/profile script hashes are the corrected
versions; actual legacy source fixtures are explicitly rejected for editing.

The pure configuration module now consults exact known BaseWorld root script,
its selected external BalanceProfile `.tres`, and exact known profile script.
Effective value precedence is explicit instance, explicit PackedScene root,
profile literal, then 120 ms. Root scripts, profile resources and all consulted
scripts join the target binding hashes. Unknown roots/profiles, expressions,
inheritance, duplicate declarations, invalid property order and stale inputs
fail before source mutation. A bare unscripted Node3D is accepted only without
custom balance-profile properties.

An implicit profile value of 250 ms is described as 250. Setting 120 in that
case generates a real explicit 120 ms instance override. The declared platform
default remains 120, but no longer replaces the effective profile value in the
description. No operation to delete overrides or reset gameplay state is added.

## Validation

- 38 unit regressions passed: 11 configuration, 7 service, 3 finite observation,
  9 existing observation/operation and 8 existing private route tests.
- `profile-semantics/target-feedback-observation-dlDIcw`: the **normal training
  scene with active profile** now loads the authored 500 ms value in two actual
  Godot processes. Other observation fields and complete progress are unchanged
  by observation. Each process also checks eight invalid-runtime cases and
  excludes outside-world/unknown-script nodes. No profile-disable fixture flag.
- `profile-semantics/target-feedback-observation-PVqWxf`: an explicitly authored
  250 ms profile is read by the real parser, which describes 250 and generates
  a 120 ms override. Two real Godot process loads observe 120 with the profile
  still active. This exercises the distinction between implicit and explicit
  120 that a pure default-value comparison would miss.
- `profile-semantics/target-feedback-native-rx1kfM`: unchanged direct-node
  1/500/1000 ms damage/flash/material-restoration acceptance, 3/3 passed against
  the new explicit-override target script.
- `profile-semantics/target-feedback-core-95WXmy`: real Rust/SQLite/Git service
  transactions, one adjustment write/check and unchanged formal progress/build,
  with restart receipt replay. Its executor result is explicitly a fixed
  fixture, not an engine-check claim.

`profile-semantics/index.json` records raw copied files, lengths and SHA256,
verified against originals. Earlier 500/120 failures remain in
`runtime-observation/` and were not overwritten. The successful normal-scene
run resolves that source-initialization blocker; these tests still do not claim
complete Electron candidate adoption or saved-profile restart. Root performs
those actual client checks using the merged source.

## Independent review of the base compatibility fix

The target's export setter records explicit serialization assignments. A
separate profile method sets the value only when no explicit assignment exists,
so scene/template overrides, including explicit 120, survive BaseWorld readiness.
The profile no longer writes every target's exported property directly. Its
effects on player movement and crosshair remain in the same profile operation.
The accepted script hashes bind these exact semantics; old-source worlds remain
readable but require an ordinary checked source upgrade before parameter editing.

Zero remains unsupported because the flash loop's zero-duration material
behavior was not changed. The platform contract stays 1–1000 integer ms.
