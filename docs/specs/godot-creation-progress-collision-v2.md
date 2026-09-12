# Creation v2 progress collision guard

This slice adds finite native penetration validation to the existing creation
restore path. It does not add module fields to progress, relocate the player to
find an acceptable result, or infer collision from declared AABBs.

## Reproduced gap

`creation_world.validate_progress` validates the original structured creation
entities and projected door/harvest state. Imported scene bodies are outside
that enumeration. A fixed authored `ImportedModule/BuildingBody` therefore
passed the legacy validator with the player penetrating its wall by 0.15 m or
inside its convex volume by 1.3 m. The actual player remained at
`[0, 0.899999976158142, 6]`. Native physics queries detected both collisions.
Ordinary floor contact, exact wall contact and a disabled body were distinguishable.

The initial reproduction is retained in
`test-results/creation-module-collision-NHfWDk/report.json`; the follow-up full-size
capsule/contact-depth reproduction is
`test-results/creation-module-collision-PIR0fw/report.json`. The first probe used
an eroded diagnostic capsule only to isolate the gap. **The delivered guard uses
the actual full-size shape**, not that diagnostic approximation.

## Compatible source cohort

New creation materialization defaults to source cohort
`creation-player-collision/1`, selecting `creation-sandbox-controller-v2.gd`.
That wrapper inherits the unchanged v1 wrapper at
`craftmine_shared/base_adapter_controller_v1.gd`; all of v1's original dependencies
and bytes remain available. `progress_collision.gd` is the fixed new query helper.
The original controller evidence/requirement protocol remains
`creation-fixed-controller/1`.

Core source-group verification, exported PCK verification and host observer pins
bind all twelve resources, including the canonical player/camera scripts. Missing,
changed and mixed cohorts fail the corresponding source checks. The existing
v1 and legacy cohorts remain compatible. `hasCurrentCollisionGuard(files,pins)`
returns true only for the complete pinned v2 group; neither a filename nor an
authored `guardProfile` label grants authority.

`observe.progressCollisionGuard` is overwritten by v2 and reports the last restore
attempt. Its initial status is inconclusive/NOT_RESTORED. It is not a continuous
clearance certificate for every subsequent frame. Old v1 worlds are **unverified
for this guard** and are not silently rewritten. Normal source migration and the
broader legacy-world coverage remain unfinished work in the overall plan.

## Restore transaction and real shape query

The wrapper retains the current progress and actual fixed Player binding, pauses
the scene, and invokes the original restore/schema/projection implementation.
It then crosses at least two actual `Engine.get_physics_frames()` boundaries
while simulation stays paused. It does not substitute render-frame waiting for
physics synchronization. Saved open-door state can therefore disable its real
collider before the guard queries it. Synchronization records the native start/
finish counters, awaited boundary count and paused state in the observation.

After the asynchronous boundary it rechecks the same world object, actual Player
and script resources, camera relationships and shape resource through the pinned
controller probe. Actual native global position and camera yaw/pitch must match
the requested legitimate saved pose. A world restore that merely reports success
while leaving the Player elsewhere fails. Body/shape replacement fails.

The query uses the actual CapsuleShape3D and the body's native shape-owner
transform, which must agree with the collision node's global transform, margin zero,
the actual Player collision mask, and all physical bodies. Only the actual Player
RID is excluded. No native entity, imported node, name prefix, metadata or
declaration is exempted. Sensor Areas are excluded because they do not physically
block the player. `intersect_shape` identifies actual bodies and `collide_shape`
provides native contact-point pairs. Penetration greater than 0.001 m fails; the
one-millimeter contact tolerance is explicit. The shape is never shrunk. Actual
2 mm wall penetration is rejected, as are sloped and corner penetrations.

An empty physical intersection is clear. Intersections without usable contacts,
nonfinite contacts, missing bodies, unsupported fixed-controller facts, or query
budget saturation are inconclusive and reject restore. Up to 64 intersected
bodies and bounded contact pairs are inspected; capacity exhaustion never passes.

On rejection the wrapper restores the call's original captured progress, crosses
the same physics synchronization boundary and verifies exact captured state plus
actual binding/pose. It never searches another position. If rollback cannot be
confirmed (for example, an injected replacement shape or saturated query), the
error includes `ROLLBACK_UNCONFIRMED`. An old pose may itself be obstructed by the
rejected candidate source: rollback confirmation does not assert that source is
safe. The caller's original paused state is restored.

## Candidate checks and latest progress

The existing `GodotBuildVerifier` calls runtime load with the merged saved
snapshot. Its unchanged load-error path marks a penetration candidate failed.
The actual `GodotWorldViewHost.stageCandidate` also restores the descriptor's
snapshot before exposing a candidate. The coordinator already discards preview
state, checkpoints latest formal progress and restages with that latest snapshot
before committing. Both paths therefore run this same guard for a v2 source.

The real Electron test exercises both production classes. A candidate building
at z=0 passes with the initial saved player at z=6. In the old formal world, the
real fixed controller walks forward for 60 physics frames; the resulting actual
latest position lies inside that candidate's building. Candidate staging with
that exact latest snapshot rejects penetration, retains the old formal instance,
and leaves the formal snapshot unchanged. No formal progress callback or core
application commit is performed by this fixture. These are real class/runtime
paths with authored descriptors, not a claimed complete core-issued adoption.

## Tests and explicit limits

- `tests/creation-module-collision-native.mjs`: 17 real native cases including
  floor, wall, corner and slope contact/penetration; convex and triangle-mesh
  geometry; disabled solid; saved-open-door restore; budget saturation; dishonest
  restore pose; shape replacement during synchronization; and a native shape-owner
  transform changed independently of its node. The imported
  body deliberately carries native-looking metadata, which grants no exemption.
- `tests/creation-module-collision-web.mjs`: real pinned Web exports, twelve-file
  PCK proof, actual production verifier and actual latest-progress candidate
  staging in independent offscreen, unfocusable windows with input guards.
- Source/cohort/PCK regression tests and complete desktop type checking.
- Existing fixed controller native and creation requirement Web tests are rerun
  against new default materialization.

This proves finite physical penetration handling for the tested new cohort.
Concave triangle collision represents surfaces: a player wholly inside a hollow
room without touching its walls is not penetrating a collider. Whether that
room has an exit is navigation/reachability work, not a reason to invent AABB
collision. Dynamic scripts changing state after the guarded restore, arbitrary
hostile in-place resource mutation, and complete game safety are not proven
impossible. Old source groups, custom controllers, ordinary player experience
and the full packaged core/LPAC/commit story need their own explicit evidence.
No external downloaded project ran in the trusted fixture, no model was called,
and no real mouse, keyboard, focus or Pointer Lock action was used.

## Recorded validation

Final new-runtime evidence is retained at:

- Native 17 cases: `test-results/creation-module-collision-mVPv7H/report.json`.
  The first successful restore records physics frames 9 → 11, two boundaries,
  and `paused=true`; saved-open-door succeeds after actual deferred disabling.
- Web/PCK/production classes:
  `test-results/creation-module-collision-web-zAdOHi/report.json`. Both check
  verdicts match expectation. Actual latest Player z=2.11500144004822 is rejected
  by candidate staging, and the formal instance/snapshot remain unchanged.
- Existing controller regression: 13 native cases in
  `test-results/controller-binding-native-heGu9G/report.json`.
- Existing creation requirements:
  `test-results/creation-requirements-web-hvlFrL/report.json`.
- 27 Node cohort/PCK/scene-reference tests, three Rust source cohort tests, and
  the full desktop TypeScript check passed. The delivery inventory refresh is
  restricted to materialize and the two newly authored guard resources.

Earlier Web runs are retained as diagnostic history. One used an incomplete
progress envelope; another candidate spawned already deeply inside its own
collider, so initial physics moved its default pose and migration rejected it
before the guard. The delivered negative uses an independently authored safe
initial spawn at z=12 and restores the original saved pose z=6 into the candidate
body; it must fail there. No player relocation is used to turn rejection into
acceptance. The final real-walk candidate stage case uses the unchanged formal
spawn and actual controller movement.
