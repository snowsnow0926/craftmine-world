# Frozen door passage requirements

Date: 2026-09-12. Verified scope: observed creation-sandbox fixtures and finite evidence validation. Runtime controller binding is not yet verified.

## Existing authority chain

The creation target service freezes requirements from host-captured target data and the original request. `world-tools.cjs` inserts this frozen object into check start; it does not take an independent model-authored acceptance plan. The core validates, hashes and stores requirements in the existing job row, carries them through claim/descriptor/recovery, and checks executor evidence at finish. Before applying a direct creation candidate, `assertDirectCreationCandidate` compares the job hash with the original host capture again.

The generic scenario diagnostic selector is deliberately outside this chain. Its arbitrary caller assertions cannot affect readiness. This extension uses a fixed finite requirement in the existing authoritative chain instead.

## Compatible requirement extension

Newly frozen sequence-door requests include:

```json
{"doorSequence":{"doorId":"door-a","steps":["marker-a","marker-b"],"verifyPassage":true}}
```

The flag is included in the existing canonical creation requirements hash. The host also freezes the original door/marker positions and scales. `false`, null and unknown fields are invalid; the opted-in door must have a frozen position/scale. Legacy stored requirements without the flag retain the old trace protocol and hash. Removing the flag from a new request changes its hash and cannot pass the host application binding or core evidence comparison. No database migration or new model tool is needed. Desktop and core releases must be updated together for new requirements; an old component must reject unsupported fields rather than silently strip them.

Before materialization, opted-in checks require exact `player_controller.gd` and `camera_rig.gd` digests at the canonical paths (LF/CRLF equivalents allowed), rejecting file aliases. Missing or changed files return `CREATION_PASSAGE_CONTROLLER_UNSUPPORTED` and remain untouched. Legacy checks do not gain this restriction. This checks file presence/content only: it does not prove that the actual Player uses those resources. Keeping the canonical files while statically binding an alternate script/subclass, overriding an inherited scene, or changing `root.player` can pass the file check. Exported parameters, collision shape/masks, camera relationships and the active camera are also unverified. This is an implementation gap, not merely a naming issue or a dynamic-attack caveat.

## Fixed host procedure

The existing disposable check runtime retains its sequence order test, including the wrong-order interaction and state resets. Additional checks run before the sequence and after the correct final interaction:

1. Read the selected door's actual collision AABB from the pinned adapter. Match its center/base to the frozen target position. Choose the shorter horizontal AABB axis, using Z on a tie; approach from the positive side. Unsupported geometry fails explicitly.
2. Use the isolated snapshot/load path solely to initialize the player one meter beyond the front face, at base Y + 0.9. Aim at the door center. This setup changes no formal save, preserves other snapshot state, and is never counted as movement.
3. After physics settling, read the actual Player node position, physics tick and raycast target from the fixed adapter. Request `walk(forward=1,right=0,frames=240)` and sample again. The current adapter delegates to `world().player.walk()` without verifying the execution binding. The observed fixtures used the original physical controller; arbitrary projects retaining the pinned files do not gain that guarantee.
4. While closed, the starting raycast must identify this exact door and the character must stop at its front face plus capsule radius. After the correct sequence, repeat the same setup and real walk; the character must cross beyond the back face. Vertical/sideways bypass, changed setup, insufficient/replayed ticks and incorrect door/instance identities are rejected.

If a closed door has no collision bounds, the runner may exercise the frozen base doorway using declaration-derived bounds to preserve useful failure evidence. `boundsSource=declaration-fallback` is never accepted as a passing result. Setup obstacles, unreachable positions, unsupported layouts or insufficient progress fail; the runner does not move the door, grant state, weaken thresholds or choose a passing result.

The 240-frame action is a fixed short physical probe, not a model budget or player-turn deadline. It does not prove a route to the markers, an entire navigable level or gameplay quality.

## Evidence and core decision

The final entry of the existing `doorTrace` gains a `passage` object only when the requirement is enabled. Its fixed format is `craftmine.creation-door-passage/1`, with:

- doorId and instanceId, matched against the frozen door and enclosing runtime evidence;
- explicit `setup=snapshot-player-only`, `boundsSource=collision`, AABB, selected axis and frames=240;
- closed/opened observations: before/after positions, started/finished actual physics ticks and the initial raycast target ID.

Core validation independently applies the fixed geometric and temporal checks. It never consumes a `passed` or `solid` boolean as proof of traversal. Unknown keys, missing passage, wrong instance, changed requirements, pre-positioning behind the door, side/jump bypass or blocked opened movement fail the authoritative creation requirement. An opted-in final candidate becomes `rejected`, even if the executor supplied a successful runtime assertion. Other phases cannot carry a passage object, and legacy requirements reject unsolicited passage evidence.

The core still trusts its registered isolated executor to collect observations honestly. The engine tests exercise actual controller movement; the core tests exercise exact stored requirements and candidate decisions. These two layers are reported separately.

## Validation and remaining scope

`tests/creation-door-passage-web.mjs` runs real pinned Web exports in independent headless profiles, disables Pointer Lock/focus before load, and validates correct, ghost-closed and retained-open collision variants. `tests/fixtures/creation-door-passage-real-evidence.json` preserves one actual Web observation set with its original identities; a Rust test verifies it without rewriting identity or values.

Core SQLite tests cover new requirement persistence, descriptor propagation, authoritative finish/candidate readiness, missing/weak evidence rejection, canonical controller-file mismatch refusal and legacy compatibility. They do not test actual script binding. No full production LPAC/job/automatic-application story or installed client was rerun for this slice. Keys, one-time rewards, cold reopen, controller binding, generic scenarios and human play experience remain separate work.

## Follow-up implementation

The finite versioned implementation of this design is now specified in
[creation-controller-binding](creation-controller-binding.md). The older protocol
and its file-only limitations above remain unchanged for stored requirements
without `controllerProfile`. The design below records the original implementation
criteria; it no longer describes an entirely unimplemented next step.

1. Add a finite controller-evidence profile to a core-pinned adapter revision. Resolve the actual `Player` node through the scene tree, record its instance identity/class, and compare its actual script resource with the fixed preload resource. Reject alternate scripts and inherited overrides for this profile; do not trust metadata or a script-returned profile name.
2. Resolve the camera rig and camera independently. Check actual parent relationships, approved rig script, controller/rig references and viewport active camera. Capture the finite movement parameters, body collision layer/mask and actual shape type/dimensions/transforms/enabled state needed by the approved profile.
3. Have the trusted action path use the validated Player object directly, rather than a fresh unchecked `root.player` lookup. Verify identity, binding and required physical settings before setup, before/after each walk and across actual physics ticks. Observe native node positions and collision facts; reject changed or missing bindings without replacing project scripts or relaxing assertions.
4. Bind the proof to world/build/instance, controller/camera object identities, physics ticks and a core-defined profile version in frozen requirements. The host cannot choose arbitrary script hashes or expected shapes. Core finish must require matching controller evidence for the new profile in addition to passage measurements.
5. Version the approved adapter manifests and capability declaration explicitly. Preserve exact old profiles for old stored jobs; an old project without the new probe is unsupported/inconclusive for the stronger requirement, never silently upgraded or accepted with old evidence. Any source adaptation requires its own ordinary patch/build lifecycle.
6. Test retained canonical files plus alternate script/subclass, inherited overrides, proxy `root.player`, changed parameters/shape/masks, wrong active camera, replacement during walk and cross-instance evidence. Run positive and failure cases in isolated Web/offscreen engines, then validate the real evidence through core finish. Do not claim complete controller identity until those tests pass.
