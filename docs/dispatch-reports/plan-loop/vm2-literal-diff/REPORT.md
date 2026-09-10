# VM2 independent audit and literal diff repair

Reviewed input: `82d25a250dcb312066dd57a84ec270d4244e3234`, clean in
`C:/Users/WINDOWS/AppData/Local/Temp/cm-version-diff-20260910`.
The original agent tree and frozen release tree were not modified.

## Finding and repair

P2: Exact membership in the changes list does not suppress Git pathspec syntax.
`godot-history-panel-service.ts` accepts a matching path and checks the returned
path, but the core echoes that same requested path while its Git invocation can
match multiple files. The shared path contract permits square brackets.
An independent real Git fixture requested `a[1].gd` and returned patches for both
`a1.gd` and `a[1].gd`; its numstat had two records. Raw reproduction is retained
in `before-git-pathspec.json`. This is not a generic filesystem escape. Ordinary
managed Godot source creation currently uses a narrower character contract; the
shared content/history boundary still needs to interpret legal older paths
literally.

Both core numstat and text queries now use an internal literal pathspec after
unchanged validation. Both explicitly disable external diff and text conversion.
Actual Rust/Git tests prove independent text counts/patches, binary classification
and sizes, unchanged branch head, and rejection of public magic/wildcard/absolute
and traversal inputs.

## Additional review conclusions

No additional definite blocker was found in VM2's new operations. Main checks
world selection, repository, branch head and applied OID before and after reads;
opaque bounded views restrict comparison targets to observed historical OIDs.
The renderer uses request generations and identity checks, and renders source as
React text. Displayed patches are bounded at a valid UTF-8 boundary to 64 KiB;
change pages contain at most 32 entries. Upstream Git still computes within its
existing limits, as the original specification states.

Changing history/source reads to `godotProject.sourceContext` avoids creating or
ending an authoring task. Actual core read scoping accepts finished tasks while
retaining world binding. A world with no retained context fails explicitly; this
is a documented restriction rather than a synthetic fallback. `historyLoad` can
still rebuild SQLite index metadata from Git through the existing core index
operation. The original specification acknowledges this, so its sampled full DB
invariance results must not be generalized to every index-recovery state.

The original report distinguishes its HTTP-to-service React fixture, previously
adopted profile provenance, and absent packaged UI/engine validation. The four
race cases are actual component tests, not a full Electron transport proof. This
audit does not upgrade those evidence claims or count the frozen release as VM2
acceptance.

## Validation

- `cargo test --offline --manifest-path vendor/pi-desktop/Cargo.toml -p craftmine-core --target-dir C:/Users/WINDOWS/AppData/Local/Temp/cm-vm2-literal-target-20260910 content_history::repo_tests -- --nocapture`: **11 passed**, no ignored cases, exit 0; `rust-tests.log`.
- `CRAFTMINE_NATIVE_DEPENDENCY_ROOT=D:/cm-plan-loop-20260910 node --test tests/plan-loop/version-diff-service.test.mjs`: **8 passed**, exit 0; `service-tests.log`. This ran against the new independent worktree, using read-only dependencies.
- The first local compile attempt exposed a test-only struct mismatch (`ContentFile` has no `mode` field). The test constructor was corrected before the successful run; it was not a runtime failure or a production workaround.
- No UI process, real input, focus, Pointer Lock, credential read, model/network call, package build or release execution was performed by this audit/repair.
