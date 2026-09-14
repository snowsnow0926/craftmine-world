# Candidate-aware periodic saves

1. Open an already loaded world and begin automatic candidate application.
   Allow the ordinary periodic-save tick to occur. Verify the host returns a
   deferred result, the page neither resumes the candidate-owned runtime nor
   displays a new error, and its loaded state and previous real errors remain.
2. Complete candidate application. At the next periodic tick, verify actual
   persistence before the page displays saved state.
3. Fail a save with an unrelated disk/runtime error, or return a candidate-like
   refusal when Main has no candidate owner. Verify the error remains visible.
4. Click explicit Save during candidate work. Verify useful failure feedback
   and no secondary resume request. Manual preview/application guards remain.

CPU coverage: `node --test tests/godot-autosave-candidate.test.mjs
tests/godot-panel-recovery.test.mjs
vendor/pi-desktop/apps/desktop/test/godot-panel-compatibility.test.mjs`.
The 26 scenarios pass. These tests run actual view functions and coordinator
logic with controlled runtime receipts; they do not operate a user's app or
claim native graphical acceptance. Native rechecks must remain independent,
headless, and free of OS input, focus and Pointer Lock.
