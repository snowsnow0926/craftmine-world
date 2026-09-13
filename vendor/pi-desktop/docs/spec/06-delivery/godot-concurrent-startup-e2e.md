# Retained-world startup acceptance

Use independent hidden/offscreen processes and data. Never focus windows,
request Pointer Lock, send OS input, use browser input simulation or call
`webContents.sendInputEvent`. Run only on an operator-authorized idle profile;
every retained-profile test acquires the ordinary author lock.

1. Apply a previously verified candidate through normal preview/preparation,
   runner receipt, Core commit and promotion while preserving the old instance
   until commit. Retain all failed attempts. Do not re-export the source or
   substitute authored test registration for native application.
2. Capture the formal world, save and close. Cold reopen must produce a new
   instance with the same build, source manifest and full progress. Verify all
   declared immutable artifacts before/after, then save and close again.
3. Confirm the helper remains offscreen/hidden/non-focusable with no input guard
   violations, and reports the actual platform graphics configuration. A PNG
   from a check or preview alone does not establish formal application.
4. On an independent native world, exercise first load, candidate cancellation,
   application from fresh formal progress, a failed save that retains the live
   instance, recovery and cold reopen. A separate deterministic host test covers
   a stalled startup cancelled by the bound world and rejected foreign cancel.
5. Fault-injected diagnostic tests distinguish ready/load phases, dispose paint
   listeners on every exit, exclude page-controlled strings/tokens, and prove
   a never-settling page probe cannot delay retirement beyond 500 ms. Late
   diagnostic responses cannot revive a failed runtime or change source.

From the request worktree:

```powershell
node --test tests/godot-startup-diagnostics.test.mjs tests/godot-remaining/D/godot-candidate-host.mjs tests/codex-live-service.test.mjs tests/codex-live-exit.test.mjs
node tests/codex-live-typecheck.mjs
node tests/godot-remaining/D/godot-candidate-typecheck.mjs
node tests/codex-live-native.mjs ABS_RUNTIME ABS_BUILT_PLUGIN ABS_NEW_PROFILE
node tests/codex-live-retained-reopen.mjs ABS_IDLE_PROFILE ABS_PRIOR_APPLICATION_OPERATION_JSON
```

The retained reopen test reads the prior successful ordinary operator
application report. It neither authors nor adopts a candidate. The new-profile
test uses real Core, source broker, build verifier, initialization, application,
runtime and save classes with no live model call. The unit tests inject protocol
faults and must not be described as native gameplay acceptance. None of these
tests assesses human control feel or city traversal.
