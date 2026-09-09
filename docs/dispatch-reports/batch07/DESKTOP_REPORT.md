# Batch 07 desktop delivery report

Code freeze: `aa1842e8beee8c95ba008a09329eba3c40c9d628`, following `89d6702`.
Branch: `codex/batch07-desktop-20260909`. Worktree: `D:/Craftmine World-worktrees/batch07-desktop-20260909`.

## Delivered behavior

- Main owns a persistent pending-operation journal. Library install/capture, player memory, profile backup export/restore, draft rechecks and cumulative-budget changes keep their original operation ID and allowlisted parameters. Renderer reload does not execute anything. Real session/project/world ownership is injected by Main and checked again on execution. Changed parameters with the same ID and foreign owners are rejected.
- Completed receipts remain until the player explicitly acknowledges them. Repeating the same pending action returns its original result. After acknowledgment another install is a new deliberate operation. This closes the crash gap between completion and renderer display.
- A committed library installation survives verification submission/handoff failure as a finished saved draft with `verificationStatus: retry-required`. Recheck does not install again, create a turn, alter a draft or reset a budget. An existing queued/running check for that exact current draft is handed back to the broker; otherwise Rust records a new immutable check.
- Rust `verification.retry` accepts only the exact current finished task draft, checks revision/hash/base build, refuses leases and pending applications, and retains existing machine-evidence and publication gates. Cancelled, active, foreign or stale drafts cannot use this endpoint.
- Play layout fills the client workspace. Conversation and sidebar remain mounted; returning to creation restores their state and panel width. Settings, non-world tabs and subagent panels use the ordinary PI layout. Window controls remain available. This changes layout only, without OS fullscreen or focus requests.
- The task page separates cumulative token allowance from model context capacity, shows actual/reserved/unknown usage, and offers unlimited or custom cumulative tokens. The player-only `task.budget` gateway binds B's `budget.configure` to the real current task. Other request/compaction/deadline/model limits remain separate.

## Verification and evidence boundaries

| Check | Result | What actually ran |
| --- | --- | --- |
| Rust library regression | 44/44 passed | Actual SQLite-backed Rust library; includes 2 new retry tests and existing verification/recovery checks |
| Node host/domain checks | 7/7 passed | 4 real-filesystem journal tests, 2 actual gateway + journal tests with explicit host fixtures, 1 actual Rust process/domain integration |
| Built plugin UI | 30/30 passed | Actual built plugin and game iframe in isolated headless Chromium; host persistence/business responses are explicit fixtures |
| React layout | 10/10 passed | Actual controls, hook and PI work-panel/Craftmine CSS; store, route bodies and world surface are explicit fixtures |
| Desktop TypeScript | Passed | Production desktop `tsc --noEmit` |
| Build/parser/diff | Passed | Plugin bundle, CJS/ESM syntax checks, `git diff --check` |

The real Rust process integration injects one `verification.submit` transport failure after a real library commit. It verifies a finished saved draft, a queued immutable recheck, unchanged binding/generation/hash/revision/budget, Rust process restart plus journal reconstruction, replay without another install/turn, memory replay, owner/parameter rejection, and failed-resume accounting preservation. The initial applied library source and host model/evidence providers are explicit test fixtures; this is not a live LLM or native-render acceptance.

The process test used a copied crate in `test-results/batch07-core-router-overlay` with exactly one parent-owned router line added for `verification.retry`. Product `main.rs` was not modified. Overlay provenance and binary/source hashes are recorded in `evidence/desktop-router-overlay.json` and `desktop-source-hashes.json`. Parent must rerun the process test against its integrated binary. B's new Rust budget endpoint is an integration dependency; the UI/gateway path was tested with an explicit endpoint fixture here.

Reports and logs are under `evidence/desktop-*`. Screenshots remain in the isolated test-result directories referenced by the UI/layout reports. No real mouse/keyboard/click/fill, pointer lock, window focus/show/activation, live browser/profile, live server, VM, model request, installer or fresh-Windows test was used.

## Material limits that remain

1. Main initialization, private router registration and PluginRuntime dispatch are parent-owned integration steps listed in `DESKTOP_INTERFACE.md`. Full native WebContentsView composition and packaged-desktop regression must use that integrated build. Component fixtures cannot prove native focus, window behavior or human play feel.
2. Native backup grants expire on Main restart. A committed restore is resolved by its authoritative status first; an uncommitted restore with an expired grant requires selecting the backup again. No grant or archive path is invented or persisted by the renderer. Re-exporting after a crash can require another native save selection; no automatic backup side effect is replayed.
3. The journal is bounded to 100 records / 1 MiB and fails closed if corrupt or full. Player rule text is retained locally as an allowlisted argument, not logged or keyword-filtered. It contains no provider settings, credential store, raw logs, archive bytes or renderer paths. It is pending-operation state separate from the domain backup. An old receipt describes its historical operation; restoring a profile does not establish that the old effect remains current. Unresolved operations for worlds removed by profile replacement can remain bounded journal entries; this batch does not add a global journal repair UI.
4. No end-to-end fresh-process test of B's cumulative-budget endpoint or root's native error-card integration is claimed by this subagent. Parent must complete that combined gate. No live-model cache-rate measurement is claimed.

## Bugs found during this work

The saved-draft cancellation on check-submit failure was fixed. Actual process testing caught a verification-list page limit mismatch (50 versus the Rust maximum of 32), also fixed. An automatic receipt acknowledgment gap was removed. Initial test fixture/setup failures were corrected; historical frozen assertions were not weakened or edited.

No main branch merge, push, cleanup, user-data migration or external publication was performed by this agent.
