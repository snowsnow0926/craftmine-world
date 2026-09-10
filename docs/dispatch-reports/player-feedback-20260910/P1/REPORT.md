# P1: hidden initial-load dispatch

Base: eae279915094f09d987ef0eb747eba20ef92cd0e. Worktree:
`D:/cm-fb-p1-20260910`; branch `codex/fb-p1-20260910`.
Production commit is the commit containing this report; no root merge or push.

## Reproduction and change

Fresh repository-authored first-person blank export, pinned Godot 4.7.2 and
Electron 43.4.0: a native detached child reported ready, then the host's load
timed out. Cleanup emitted destroyed and the old diagnostic reported it as the
last fault, alongside the zero framebuffer warning and HTTP requests=15/15.
This matches the screenshot text but does not establish the exact cause of the
user's 111/1111 saves, which were not accessed.

The same export loaded in an offscreen child. Disabling background throttling,
attaching the native child, and combining the two did not repair the baseline.
`receive` only queued requests, whose execution depended on `_process` and thus
another animation frame. The fix drains the same bounded serialized queue on
receipt, preserving asynchronous gameplay and all state validation.

Host diagnostics are captured before intentional cleanup. Renderer termination
after ready now aborts pending requests, preserving the fatal reason rather than
waiting for their timeout. A completed ready runtime without pending requests
retains the previous abort behavior. No source permissions or publication gates
were weakened. The old host test double now delivers an actual destroyed event
and supplies timers required by the already-existing close barrier.

## Actual validation

- `node --test tests/player-feedback/P1/startup-failure.test.mjs tests/godot-remaining/D/godot-runtime-abort.mjs tests/godot-remaining/D/godot-candidate-host.mjs tests/godot-runtime-boundaries.mjs`: **28/28**.
- `node tests/godot-remaining/D/godot-candidate-typecheck.mjs`: **0 diagnostics**.
- `node tests/player-feedback/P1/renderer-load-native.mjs`: fresh engine export
  and actual production host/preload; four bases x native/offscreen **8/8**.
- Expanded same-export run `p1-renderer-load-tkeR1K`: **8/8**, full initial-load
  response equals authored state, pause/hide retains the full snapshot, fresh
  replacement instance loads the same full state, every process exits 0 with
  no pointer/focus guard attempts. All four offscreen images have a real
  1280x720 physical viewport, positive logical viewport and more than four
  sampled colors; images inspected. Native detached zero surface is not a
  visible-rendering pass.

Environment: TEMP/TMP=`D:/cm-fb-p1-20260910/test-results/temp`;
CRAFTMINE_NATIVE_DEPENDENCY_ROOT and CRAFTMINE_TYPECHECK_DEPENDENCY_ROOT=
`C:/cm-plan-next-20260910` (read-only installed dependencies);
CRAFTMINE_GODOT_CACHE_DIR=`D:/Craftmine World/desktop/build/godot/4.7.2-stable`.
Expanded run: P1_BASES=`first-person,top-down,side-view,mining-sandbox`,
P1_MODES=`native,offscreen`, P1_REUSE=`D:/cm-fb-p1-20260910/test-results/p1-renderer-load-E2uRXr`.
New exports/engine copies/profiles/logs are all on D. The fixed authored engine
probe is not an AppContainer or actual Core transaction claim.

## Retained failures and limits

`mqJsSj`: initial probe export preset omitted include/exclude fields; corrected
in the probe, without changing engine error handling. `55dA9g`: real native and
unthrottled timeouts; offscreen load worked but an incorrect test wrapper field
made its first pass flag false. `qTBk0e`: attach controls fail, offscreen passes.
`c3ffoY`: seven expanded cases pass; mining comparison against a later resumed
state fails because normal gravity advances its player. Final probe compares
the actual pre-resume load receipt, then checkpoints while paused; no field or
threshold was dropped. Raw failed reports remain under evidence.

The first broad test attempt also exposed a stale host double (missing timers /
destroyed event) and an unrelated historical runtime test's default engine-cache
path. The double was repaired and 28 selected logic tests passed. The historical
heavy runtime test was not counted; the new native probe supplies actual exports.

P10 must regenerate authored runtime inventories/pins, prepare fresh managed
worlds, and verify the full creation/application/restart chain in its client.
No current 827 package, user profile, main index/creation module or model was
modified. User visible-window/DPI/multimonitor/manual play remains unverified.
The shared bridge fix does not automatically rewrite old managed worlds: their
source/build identities must remain protected and migration/rebuild needs an
explicit reviewed path.

Core audit: `godotWorld.initStatus` recomputes candidate-present as checked
before job failure and has no explicit first-load-failure RPC. An in-memory
initializer failure can therefore disappear on restart. Durable failure/retry
requires a Core-owned contract; do not introduce a second unbound JSON authority
or overwrite job outcome. This item is reported to P10 for coordination.
