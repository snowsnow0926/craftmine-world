# Versioned world composition recipes

The existing PI Desktop asset library adds **Compose gameplay**. It operates on
the selected world and its existing conversation. It does not create a parallel
editor or silently replace the world with a template.

## Player flow

1. Open an existing example, saved world or template through the normal world
   picker, then open Asset library → Compose gameplay.
2. Select companion exploration, rain exploration or collect-to-unlock-flight.
   Choose whether to preserve scenery or add a forest gateway/city street
   fragment, whether to add the approved white Pomeranian companion, whether to
   keep weather or add controllable rain, and 1–12 collection targets for flight.
   Additional wishes are preserved verbatim. A fragment is never described as
   an entire city and does not replace a whole-city request.
3. **Inspect composition** reads exact pinned source ZIPs and the current world
   source. It shows reusable components, source adaptation requirements,
   outstanding gameplay logic, a real-runway requirement and remaining checks.
4. **Continue with AI** reads the plan again. A changed source/reference produces
   an updated review and requires another explicit handoff. An unchanged plan
   is appended to the existing world's Composer without focus or auto-send.
   The user sends it through their ordinary chosen backend/model/settings.
5. The Agent re-reads the recipe against its actual task, inspects installed
   instances, uses normal source proposals/edits and checks, then the existing
   player candidate-adoption flow. Plans do not represent applied content.

Changing any choice invalidates a previous plan. Closing the surface or switching
worlds invalidates late replies. A pending Composer prefill is never overwritten.
The existing renderer conversation/selected-world identity checks still apply.

## Read contract

`godot_source_library` retains search/read/propose/propose-group and adds:

- `mode: "recipes"`: immutable catalog format
  `craftmine.world-composition-catalog/1`, three recipe IDs/current version 2 and
  choices. Exact historical recipe version 1 remains supported by `compose`.
- `mode: "compose", request: {recipeId, recipeVersion, choices, wish?}`: plan
  format `craftmine.world-composition-plan/1`. Choices require all four fields:
  `scenery`, `companion`, `weather`, `collectionCount`. The selected recipe and
  its exact version are mandatory; no keyword inference or `latest` is accepted.

UI uses only `package.request` methods `compositionCatalog` and
`compositionPlan`. Both require the current world. Only the private service
chooses the read context; a renderer cannot provide source revisions, paths,
task contexts, archive bytes, apply flags or another world. Main checks selected
world before and after the read. The existing source-library service handles
archive byte reading/integrity; this feature adds no filesystem permissions.

Pins fix asset ID, integer version, ZIP SHA-256 and resource root content hash.
The catalog's asset content hash remains distinct from the package root hash.
Plan resolves actual catalog records, verifies those pins and reads the bytes
through the existing archive validator before describing their contracts.
Original licence/provenance remains unchanged, including unverified generated
model rights. A raw GLB is never selected as a playable companion or aircraft.

Recipe version 1 retains the released Pom/rain component version 1 pins. Recipe
version 2 selects Pom/rain version 2, which adds the exact placement-preview
bridge source cohorts while retaining the three released requirement profiles.
Other selected components retain their original versions. The built-in catalog
has 30 version rows: all 28 preview22 rows remain byte-identical, with separate
`.v2.zip` files for the two additions. `latestOnly` selects version 2 for normal
browsing; turning it off or reading an exact old reference still yields version
1. An old version is never silently redirected to version 2. See
[component bridge compatibility](component-preview-compatibility.md).

Source preflight pages `godotProject.index` at its actual Core limit of 32 rows,
pins every continuation to the first revision/hash, bounds inspection at 8192
descriptors, and checks the current revision again before returning. It compares
base/engine and common/alternative source-requirement cohorts by exact hashes.
Existing component source files are an inspection hint, not proof of a running
instance or permission to add a duplicate. No source/task/SQLite writes occur.

## Meaning of checks

`source-requirements-matched` is only a static source-cohort result. Overall
compatibility remains `not-runtime-verified`, `applied` remains false, and the
plan lists placement, controller/camera, input routing and independent saved
state checks. Selecting rain adds exclusive-weather ownership inspection;
known existing rain files produce a possible-conflict result.

The flight recipe resolves the real reusable aircraft and records its 2400 m ×
56 m level runway, negative-Z direction, unit scale/identity parent, aircraft
center 2.18 m above the real surface and required airspace. The stock 64 m world
is insufficient. An Agent must inspect/build suitable ground without removing
the requested scene, call actual aircraft runway checks and verify takeoff,
landing and on-foot restoration.

Collection and boarding-unlock logic are **missing logic for Agent source
adaptation**, not a shipped, verified gameplay module. The Agent must create
stable reachable collectible identities, one-time collection and visible saved
progress, connect completion to an aircraft-scoped boarding gate, preserve
normal runway/collision conditions and landed exit, and test unfinished/finished
quest states plus save/cold reopen. Compilation alone does not accept the wish.

This release does not add automatic arbitrary-world merging, a new physics
controller, a general rule interpreter or a public community service. A real
composition produced by the ordinary Agent may be saved with the existing
template-publication flow after actual checks/player confirmation.

## Validation

- `node --test tests/world-composition.test.mjs`: real product ZIP integrity,
  exact pins, options, source pages/cohorts, stale reads, cancellation and no
  hidden writes (Core transport fixture; not native gameplay evidence).
- Desktop `test/world-composition.test.mjs`: main gateway, selected-world race,
  request parity, receipt refusal and Composer text.
- `node tests/world-composition-ui.mjs`: real React forms in independent headless
  Chromium with host fixtures; choice changes, stale plan reread, explicit
  handoff, switched-world late results and Chinese/English labels.
- Integrated native/model composition and resulting saved-template acceptance
  are separate evidence. They cannot be inferred from the above fixtures.
