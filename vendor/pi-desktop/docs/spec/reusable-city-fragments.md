# Reusable approved-city components

These local catalog entries extend the existing pi-desktop asset library. All
use the shared `reusable-world-content` tag and retain Chinese/English aliases.

| Asset ID | Content | GLB size | Geometry / collision triangles | Approximate dimensions |
| --- | --- | --- | --- | --- |
| `cw.city.ward-building` | One red-roof enterable ward house | 97,244 B | 1,514 / 160 | 11.49 × 9.15 × 13.25 m |
| `cw.city.gate-section` | Twin towers, open passage and trimmed wall ends | 336,200 B | 5,908 / 652 | 48 × 22.70 × 11.13 m |
| `cw.city.ward-street` | Two enterable houses and original sand ground | 182,324 B | 3,042 / 334 | 27 × 9.15 × 44 m |

Dimensions are X/Y/Z. Ground anchors are fixed at source coordinates
`(-23,0,-52)`, `(0,0,-36)` and `(-23,0,-63)` respectively. The building and gate
expect receiving-world ground; the street includes a flat ground surface. The
single building's entrance approaches from local `(4,0,7)` toward `(0,0,0)`.
The gate passage follows local X=0, Z=9 to -10. The street route follows local
X=12, Z=20 to -20; its house centers are `(0,0,11)` and `(-1,0,-10)` with entry
directions approximately 60 and 30 degrees in the X/Z plane.

The packages contain static geometry, collision, materials and independent root
identities. They do not contain guards, quests, driving, weather, replacement
cameras or a full-city map. Requests for a whole city still use the world
template or compose sufficient modules; these entries are not reported as
whole-city recreation. Agent examples include adding two enterable houses beside
an existing path, adding a walk-through city gate, or reusing a two-house street
without replacing the current world. The agent reads exact catalog references,
dimensions and routes before placement, then uses normal check and adoption.

Source preservation:

- `orgrimmar-city.glb`: SHA-256 `32cac65f6bee1b9cc262f6093ada6b78fae3910db8ab925311acee1281f07c6c`.
- `orgrimmar-wards.glb`: SHA-256 `95ed0a416b2d5abb69b1865b24b7e95d346913091e4153a7ad11939d61069465`.
- Derived GLBs, provenance, script, shader, source license declaration and real
  PNG previews are pinned in each component manifest. Regeneration refuses a
  changed geometry/wrapper/shader with an old preview.
- Existing 4 MiB copied-source and 5 MiB ZIP ceilings are unchanged. ZIPs including
  previews are approximately 184 KB, 262 KB and 223 KB. No Blender/model call is
  needed to build or install these derivatives.

`desktop/build-city-fragment-packages.mjs` returns normal source packages plus an
optional sibling preview `{file, bytes}`. Catalog `entry.preview` is the bounded
descriptor `{file, bytes, sha256, scope:'component-view'}`; each PNG is below
512 KiB. The package also embeds the same PNG and exact rendering provenance.
Native preview seeding may use this descriptor without accepting renderer bytes.

Verification remains separated:

1. `tests/city-fragments.test.mjs` regenerates byte-identical derivatives and
   checks package identities, provenance, bounds and dependencies.
2. `tests/city-fragments-native.mjs` imports through Rust, searches aliases,
   installs two copies of each package through the actual source installer,
   preserves receiving-world content and verifies exact source after Core
   restart. A missing executor is reported as `source-saved-check-blocked`;
   this is not formal adoption or player-progress acceptance.
3. `tests/city-fragments-engine.mjs` uses isolated pinned headless Godot physics.
   Six root instances have distinct identities. Ten capsule-motion routes pass:
   the two single-house entrances, two gate passages, two 40 m street traversals,
   and four entrances covering both houses of both street copies. Existing
   ground and an unrelated object remain intact. The successful run is
   `city-fragments-engine-eVYufB`; the earlier incorrect entry-angle fixture and
   dummy-renderer shader failure remain in test evidence.
4. `tests/city-fragments-visual.mjs` exports actual Godot Web, uses an isolated
   headless Chromium profile with Pointer Lock disabled and no simulated input,
   and captures all three real component views. The inspected successful run is
   `city-fragments-visual-JcVVMa`; no page/runtime console errors were present.

Product-level check/adopt/player-save/reopen stays part of the integrating
player-flow acceptance, not inferred from these source or geometry receipts.
