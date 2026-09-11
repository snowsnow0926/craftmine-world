# Frozen door passage requirements

Date: 2026-09-12. Scope: creation-sandbox, approved fixed controller profile.

## Existing authority chain

The creation target service freezes requirements from host-captured target data and the original request. `world-tools.cjs` inserts this frozen object into check start; it does not take an independent model-authored acceptance plan. The core validates, hashes and stores requirements in the existing job row, carries them through claim/descriptor/recovery, and checks executor evidence at finish. Before applying a direct creation candidate, `assertDirectCreationCandidate` compares the job hash with the original host capture again.

The generic scenario diagnostic selector is deliberately outside this chain. Its arbitrary caller assertions cannot affect readiness. This extension uses a fixed finite requirement in the existing authoritative chain instead.

## Compatible requirement extension

Newly frozen sequence-door requests include:

```json
{"doorSequence":{"doorId":"door-a","steps":["marker-a","marker-b"],"verifyPassage":true}}
```

The flag is included in the existing canonical creation requirements hash. The host also freezes the original door/marker positions and scales. `false`, null and unknown fields are invalid; the opted-in door must have a frozen position/scale. Legacy stored requirements without the flag retain the old trace protocol and hash. Removing the flag from a new request changes its hash and cannot pass the host application binding or core evidence comparison. No database migration or new model tool is needed. Desktop and core releases must be updated together for new requirements; an old component must reject unsupported fields rather than silently strip them.

Before materialization, opted-in checks require exact approved `player_controller.gd` and `camera_rig.gd` source digests (LF/CRLF equivalents allowed), rejecting resource aliases. Custom/missing controllers return `CREATION_PASSAGE_CONTROLLER_UNSUPPORTED` and remain untouched. Legacy checks do not gain this restriction. These are source pins, not a universal guarantee that arbitrary authored scripts cannot move or dynamically replace a player; that broader adversarial/runtime-binding problem remains outside this slice.

## Fixed host procedure

The existing disposable check runtime retains its sequence order test, including the wrong-order interaction and state resets. Additional checks run before the sequence and after the correct final interaction:

1. Read the selected door's actual collision AABB from the pinned adapter. Match its center/base to the frozen target position. Choose the shorter horizontal AABB axis, using Z on a tie; approach from the positive side. Unsupported geometry fails explicitly.
2. Use the isolated snapshot/load path solely to initialize the player one meter beyond the front face, at base Y + 0.9. Aim at the door center. This setup changes no formal save, preserves other snapshot state, and is never counted as movement.
3. After actual physics settling, read the actual Player node position, actual physics tick and raycast target from the fixed adapter. Drive the approved controller with `walk(forward=1,right=0,frames=240)` and sample again after settling.
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

Core SQLite tests cover new requirement persistence, descriptor propagation, authoritative finish/candidate readiness, missing/weak evidence rejection, custom-controller refusal and legacy compatibility. No full production LPAC/job/automatic-application story or installed client was rerun for this slice. Keys, one-time rewards, cold reopen, custom controllers, generic scenarios and human play experience remain separate work.
