# Batch 07 desktop delivery manifest

- Branch: `codex/batch07-desktop-20260909`
- Baseline: `a4944be`
- Code commits: `89d6702` (persistent operations, recheck, layout and budget UI), `aa1842e8beee8c95ba008a09329eba3c40c9d628` (receipt acknowledgment gap, final regression and page-size correction).
- Report: `DESKTOP_REPORT.md`
- Integration contract: `DESKTOP_INTERFACE.md`
- Evidence: `evidence/desktop-*`
- Parent-owned hotfiles are not included. Do not cherry-pick generated test profiles, binaries, SQLite files or the copied test router overlay.
- No dependency/config/manifest changes, live data changes, primary-branch merge, cleanup or push.

Changed production surfaces: plugin view/workbench UI/service; Main gateway and new operation journal; App/controls/layout hook/Craftmine CSS; narrow Rust verification implementation. New tests are under `tests/batch07-desktop`. Rust verification tests include exact retry/replay/state guards. Existing frozen test files remain unchanged.

Acceptance is scoped to the report. Root must integrate the private wiring, B's budget implementation and the final native/package gates before claiming the overall batch complete.
