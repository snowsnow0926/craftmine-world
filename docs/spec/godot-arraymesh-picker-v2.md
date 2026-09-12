# Static ArrayMesh selection evidence, V2

The creation adapter can now retain an imported static module under the center
ray without discarding its real physics hit merely because its GLB imports as an
ArrayMesh. A versioned picker supports native static base-surface triangles.
The legacy picker and adapter remain byte-identical; the separately versioned
controller adapter supplies this picker and preserves the legacy dependency.

## Contract

The class extends `res://craftmine_shared/scene_mesh_picker.gd`. It retains the
legacy `pick(root, camera, exclusions, physicsHit)` signature, status fields and
EPS tie rule. Physics at or before the nearest supported triangle yields
`blocked/nearer-or-tied-physics-hit`, with `blockRaySelection=false`: the ordinary
adapter keeps the physics body as `sceneObjectTarget`, then stores its live weak
reference in `sceneObjectRefs`. This is not a selection failure. Only
`fallback` clears an uncertain ray target. Runtime object IDs are stable while
the actual node lives, not durable IDs across rebuilds or cold starts.

Each result includes `scope=bounded-static-base-mesh-triangles`,
`geometryBasis=base-surface-arrays`, `renderLodVerified=false` and
`pixelAccurate=false`. A hit adds `surfaceIndex`, `surfaceTriangleIndex` and
the flattened `triangleIndex`. Full controller-cohort observation propagates
the scope fields to `sceneObjectSelection`.

Exact native ArrayMesh resources with no attached script support indexed and
nonindexed TRIANGLES. Each surface uses material_override, then its surface
override, then its own mesh material. Only ordinary opaque native
StandardMaterial3D is certified. Triangle intersections and normals use the
actual positive invertible instance transform and per-surface culling. An AABB
hit alone is never a target.

Limits are 512 nodes, 64 ray candidates, 16 surfaces per ArrayMesh, 12,288 vertices
and 4,096 triangles per mesh, 49,152 vertices and 16,384 triangles per call, 8
exclusion roots and an 80-unit ray. All candidate metadata and aggregate budgets
are checked before reading face/array data. Read-back lengths, finite vertices
and index ranges are validated. No geometry cache, collider, project method
invocation, viewport setting or world mutation is introduced.

Scripted/custom geometry, skinning, bones/weights, blend shapes, dynamic vertex
updates, 2D vertex arrays, custom bounds, unbounded shader/material deformation
and depth changes fail closed. Transparent geometry, unsupported primitive
shapes, negative scale and visibility ranges remain bounded uncertainty
blockers. A nearer or tied unknown cannot expose a known object behind it.
Budget exhaustion also fails closed; it does not report partial successful
coverage. Ordinary BoxMesh remains supported; unsupported primitive/native
classes are not silently promoted.

## Measured scope and LOD

The fixed 4.7.2 engine imports Kenney building-small-a as 734 vertices and 1,356
indices, one opaque StandardMaterial3D surface, without skinning or blend shapes.
It generates two serialized LOD entries. Road-straight has 88 vertices and 162
indices with no serialized LOD entry.

The bounded public ArrayMesh API exposes base arrays, not a bounded enumeration
or certification of the rendered active LOD. V2 does not inspect the potentially
unbounded serialized `_surfaces` property or change viewport LOD. Its base
triangle evidence therefore does not certify current rendered LOD visibility or
pixel coverage. The forensic test alone inspects `_surfaces` of the fixed,
previously audited 39 KB building and 6 KB road resources.

## Verification and delivery boundary

See `docs/evidence/gu2-arraymesh-picker-20260912/`:

- `legacy-negative.json`: 5 actual checks. The formally installed building was
  placed independently at (0, 0, -4), with the road hidden. Actual physics hit
  the building while legacy returned unsupported-mesh-type. Moving the building
  off ray to x=20 still blocked a BoxMesh control.
- `controller-v2.json`: 37 real LPAC/Web checks using the complete controller
  cohort, followed by ordinary runtime bridge `observe`. The imported building
  body appears with its exact node path and live ID in target/references; a
  second instance has a distinct target ID. Physics sampling increments. Tests
  cover index/nonindex and two surfaces, material precedence/culling, AABB-only
  misses, transforms, uncertainty, custom resource/skin/blend/bone/dynamic
  rejection and per-mesh/aggregate preflight budgets.
- `legacy-regression.json`: all 44 existing native legacy checks passed.
- `building-alone.png`: independent headless scene after restoring the actual
  building view. It is visual context, not proof of a player interaction.

The external project is a read-only materialization of the already closed formal
source commit `a446aa197dc7b0bd20929f8fb82e584d90157f6e`, world
`world-f58b259b9562`. Source GLBs and their licenses remain unchanged. Derived
fixture camera/object placement and the observer/cohort overlay are included in
the LPAC request snapshot; full request/source identities and artifact hashes
are checked. The original bare source HEAD remains unchanged.

This is a derivative real-engine observer/cohort regression, not another
ordinary core build/check or packaged-player acceptance. It proves the
observation can expose a reference for subsequent source editing; it does not
claim an Agent model actually edited it, nor that arbitrary module parameters
or project save contracts are supported. A first new-wrapper run
`glb-pick-audit-vXwj7Q` exposed physicsTick=0; the wrapper owner fixed explicit
base initialization. Only the rerun `glb-pick-audit-wwkH5X` is final evidence.

All external project execution uses the SHA-256-verified LPAC broker and pinned
4.7.2 Web export, independent headless browser/profile, same-origin networking,
Pointer Lock/focus blocking and zero input/model calls. Reproduce in this
workspace using `node tests/mesh-pick/glb-audit.mjs` for legacy or add `--v2`.
For the complete cohort set `GODOT_PICKER_COHORT_DIR` to the new cohort's
`desktop/godot/shared` directory. The runner needs the explicitly recorded
closed formal source repository/profile; archive-only checks need no engine:
`node --test tests/mesh-pick/glb-evidence.test.mjs`.
