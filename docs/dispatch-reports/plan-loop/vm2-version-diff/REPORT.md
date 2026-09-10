# VM2 finite read-only version comparison

Base: `85b1015de6d40d380ae93c255aa73122ca0fdf06`.
Branch: `codex/version-diff-20260910`.
Worktree: `C:/Users/WINDOWS/AppData/Local/Temp/cm-version-diff-20260910`.

## Delivered

The existing Versions and creation branches panel now compares the current
branch or a visible historical version with the world's applied content. It
shows real file statuses, binary sizes, exact text patches, 32-file pagination,
and explicit UTF-8-safe 64 KiB truncation. No restore/merge/application or model
operation is added. World/source view changes reject stale requests; React text
rendering prevents source HTML execution.

History and source reads now use the core's actual existing source context,
without creating/ending an authoring task. New private routing is exact; raw
content/file/context methods remain unavailable to renderer navigation. Main
retains at most 16 opaque views and validates both mutable content pointers
before and after reads. Raw Git diagnostics never reach the diff UI.

## Validation and evidence

- Service/navigation boundaries: **8/8** via
  `node --test tests/plan-loop/version-diff-service.test.mjs`.
- Actual Rust/Git + headless React: **18/18** via
  `node tests/godot-history-panel.mjs`; report and calls in
  `raw/real-git-react-report.json` / `raw/real-git-react-calls.json`.
  Includes old branch creation/edit/check/restart behavior and full DB/world
  invariance during comparison. No executor is registered; check remains
  honestly blocked. The applied Git ref is a declared fixture, not an engine
  application acceptance.
- Actual previously adopted profile, copied before launch: **5/5** via
  `tests/plan-loop/version-diff-applied-core.mjs`; complete report in
  `raw/actual-adopted-core-report.json`. This uses the completed real
  broker/check/application world `world-a5eac9797410` from the authorized
  `desktop-native-parameters-6Uvnzp` archive. Its changed scene contains the
  real 500 ms parameter history. Full progress and DB fingerprint remain exact;
  formal/head identities and progress survive another Rust restart. The original
  core directory inventory was checked unchanged, with every file recorded in
  `raw/actual-adopted-source-index.json`. No sibling profile or secret directory
  was copied or read.
- Actual headless React delayed replies: **4/4** via
  `tests/plan-loop/version-diff-ui-races.mjs`, report in `raw/ui-races-report.json`.
- Complete desktop TypeScript check: exit **0**, using TypeScript 5.9.3 and
  `-p vendor/pi-desktop/apps/desktop/tsconfig.json --noEmit`.
- `git diff --check`: pass. E2E documentation was appended as raw UTF-8 bytes;
  the original byte prefix/hash is preserved in `raw/e2e-byte-append.json`.

Runtime dependencies were read-only from `D:/cm-plan-loop-20260910`. Actual core
SHA-256: `285578bc384302eaccf2017225d446732ead3daf24c80a52e5150018604060bb`.
Both browser runs used independent headless processes/profiles with focus and
Pointer Lock disabled. Input/focus/Pointer Lock counters remained zero.

The initial test failed because source-only migration correctly has no applied
OID. Its original report is retained as `raw/initial-source-only-failure.json`;
the fixture was made explicit rather than weakening production's formal check.
The separate copied adopted profile then verified the actual application source.

## Boundaries

No new packaged acceptance or actual Godot launch occurred in this slice. The
React test replaces only navigation transport with a local HTTP fixture; the
gateway's finite allowlist is separately tested. The adopted-profile check
launches Rust only and inherits its real application provenance from the earlier
completed client acceptance. Large/unreadable upstream Git output fails visibly;
the displayed patch is bounded but Git computation uses its existing core cap.
This does not complete all VM2 recovery/application or VM3 semantic merge work.

Spec and ADR are `vendor/pi-desktop/docs/spec/godot-readonly-version-comparison.md`
and `vendor/pi-desktop/docs/adr/godot-readonly-version-comparison-20260910.md`.
All raw file copies are hashed in `raw-evidence-index.json`.
