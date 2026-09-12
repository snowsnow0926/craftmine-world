# Fixed creation controller binding, version 1

This finite extension closes the actual Player binding gap of the initial door
passage implementation. It participates in frozen requirements and authoritative
core finish. General scenario diagnostics remain non-authoritative.

## Requirement and compatible source groups

New host-frozen door sequences add `controllerProfile: "creation-fixed-controller/1"`
alongside `verifyPassage: true`. The exact enum and its dependency on that flag are
checked in desktop and Rust. Both enter the existing canonical hash and persisted
job/claim/check descriptor. The model cannot supply weaker expectations for the
same capture; application still compares the captured and job hashes.

Old stored requirements without this profile retain their exact protocol and
source expectations. The legacy adapter, bridge and picker source bytes stay
unchanged. New creation materialization copies the legacy adapter to
`craftmine_shared/base_adapter_legacy.gd`, selects the new wrapper as canonical
`base_adapter.gd`, and includes `controller_evidence.gd` and `scene_mesh_picker_v2.gd`.
The wrapper explicitly calls its parent initializer to retain physics ticks.
Its script dependencies, including both picker versions, form one core-pinned
source group. Project selectors remain fixed. Exported PCK verification binds all
ten protected resources, including the actual canonical player/camera scripts,
to source bytes rather than trusting only the pre-import manifest.

Missing, mixed, changed or aliased sampler groups are unsupported. A new profile
against a legacy probe cannot produce a passing candidate. Original project
source is preserved; there is no automatic controller replacement or repair.
The materializer's `controllerProfile: "legacy"` is for explicit retained-format
fixtures; normal new creation defaults to the current group.

## Native facts and direct action

The pinned probe resolves `Player` from the actual scene tree, requires a
CharacterBody3D, and compares `get_script()` resource identity to the fixed player
preload. Keeping the canonical file while attaching another script or subclass
does not satisfy this check. It records and verifies the actual `root.player`
reference, rig script resource, Player/rig/pivot/camera parent relationships,
controller/rig object references and the viewport's current camera.

The finite profile additionally checks eight movement/gravity parameters, 60 Hz
physics, body layer/mask, physics processing and transforms, a single enabled
capsule shape and its native shape-owner/resource association, capsule dimensions,
and fixed rig/pivot/camera transforms relative to the current yaw/pitch. Missing
facts or a mismatch return a specific unsupported reason. Authored profile labels
and observations cannot overwrite the fixed probe output.

`controller-walk` accepts only the existing bounded axes and 1–240 frame count.
The door protocol uses forward 1, right 0, frames 240. After validating the actual
Player once, the probe calls that object's canonical walk directly. It resamples
the bindings immediately before starting and on every `physics_frame` signal,
independently of the controller coroutine. Render frames are not physics ticks.
A cancelled/replaced controller coroutine cannot hang the observer: missing
completion or changed binding produces an error within the finite action.

The evidence formats are `craftmine.creation-controller-evidence/1` and
`craftmine.creation-controller-walk/1`. Each walk has complete before/after facts
and a bounded consecutive tick trace containing actual Player/script, rig/script,
camera/current camera and shape/resource identities. The host and Rust check the
same finite shape, fixed relationships and continuity. Runtime resource ObjectIDs
may be negative strings; they are not hashes or cross-instance identities.

## Locked door and authoritative verdict

The isolated existing setup places only the player in front of the frozen door;
setup displacement never counts as movement and no formal progress is written.
Before closed traversal the actual ray must hit the original door. Normal
`interact` is issued, two physics frames elapse, and the fixed observation must
still show the door closed. The subsequent real walk must remain physically
blocked. Thus preserving the correct marker path while allowing direct door
interaction no longer passes this profile.

After the existing wrong-order/correct-order marker checks, a new real walk must
pass through the open doorway. Both motions retain fixed geometric/temporal
requirements and carry the controller evidence. Core finish rejects missing
profile facts, changed tick bindings, different runtime identity, opened direct
interaction, or incompatible requirements even if the executor asserts success.
The candidate becomes rejected. Unsupported profile/layout errors likewise never
upgrade readiness. The earlier generic collector still has passed/failed/
inconclusive diagnostics and does not authorize candidate adoption.

## Picker cohort

The same new wrapper installs the separately reviewed picker V2 while preserving
legacy precedence and EPS. The real adapter observation exposes selection scope
`bounded-static-base-mesh-triangles`, `geometryBasis: base-surface-arrays`,
`renderLodVerified: false`, and `pixelAccurate: false`. This is bounded static
triangle geometry evidence, not verification of active render LOD or rendered
pixels. Formal GLB import and bridge observations are independently tested by the
GU2 picker fixture through LPAC.

## Verification and limits

`tests/controller-binding-native.mjs` tests actual canonical walk plus static
alternate/subclass bindings, a root proxy, movement/mask/shape/camera changes and
script/camera/shape replacement during a walk. `tests/creation-door-passage-web.mjs`
uses real pinned Web exports and an independent headless profile for correct,
ghost-closed, retained-open, direct-open-bypass, legacy-probe and static-subclass
cases. It also checks each actual PCK against the pre-import source digests.
The fixture `tests/fixtures/creation-controller-binding-real-evidence.json`
preserves real Web job/world/build/instance values and raw numeric evidence.
Rust verifies it unchanged. Separate SQLite tests explicitly rebind copies as
authored executor data to exercise finish/ready/rejected; they are not a claimed
single end-to-end production run.

The registered executor remains a trusted collector. This profile verifies the
listed finite facts and actual object walk at sample points; it is not a sandbox
proof that arbitrary other project scripts cannot move the player, transiently
change collision between samples, or mutate/reload a script resource in place.
It does not inventory every engine property or prove all authored code harmless.
Custom controllers need another explicit contract. There is no claim of arbitrary
spawn-to-marker navigation, complete game correctness, visual fidelity, human
player acceptance, or completed GU4. No model call or extra player-turn budget is
introduced, and no real input/focus/Pointer Lock is used.
