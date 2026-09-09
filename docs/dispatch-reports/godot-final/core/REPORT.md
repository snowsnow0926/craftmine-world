# Final core and retry UI handoff

## Delivered

- Cross-process OS locks serialize portable export/restore/recovery and managed Git mutation/reclamation. A live restore target is not recovered by a second core; cancellation remains callable while the export lock is held. Retained repository/ref pins prevent pruning.
- Private `godotProject.applyFiles` publishes a binary/text file set, asset lock and instance map in one managed revision. Existing `godotProject.read` reads binary files as bounded base64 pages. The caller cannot supply arbitrary filesystem roots.
- Git branches carry their real branch/head identity through source index/read/write, build, check, candidate and application. Main stays unchanged by another branch's edits. Exact durable application replay remains readable after later progress saves.
- Known legacy archive columns migrate explicitly; missing user-content columns are rejected. `backup.restoreProof` verifies the restore transaction's exact operation/archive mark after startup reconciliation rather than assuming a mutable full database fingerprint stays equal forever.
- The world-list retry button now calls `world.creationRetry` with only `{worldId}`. This is the channel implemented by the integration coordinator; other creation actions retain their existing handling.

## Evidence and limits

- `core-branches-full-02.log`: 265 core tests passed, 7 ignored; one additional documentation test ignored. This full run precedes the subsequent archive-compatibility and restore-proof commits.
- `backup-schema-final.log`: subsequent backup tests 22 passed, 3 ignored.
- `restore-proof-final.log`: actual offline/new-directory portable restore proof test passed; wrong operation is rejected and later database mutation does not erase the committed restore identity. `restore-proof-build.log` records the subsequent binary build.
- `creation-retry-ui.log` and `creation-retry-ui-report.json`: 24 checks passed against real React components with a fixture host, including exact retry payload. Independent headless browser, zero focus/pointer-lock requests and no OS input. This proves the renderer call, not actual creation completion or a real model call. Its sourceCommit records pre-change HEAD; the UI/test edits are included in the same commit as this report.
- The branch core tests use real Git and core transactions, but synthetic check/launch evidence. They are not additional actual Godot or real-model acceptance runs.
- Earlier failed compile/test attempts are retained alongside final results. `evidence-index.json` records SHA-256 and size for every archived evidence file.

## Remaining integration boundary

The inspected integration tree has no Godot content-history/branch-selection renderer. `plugins/craftmine-world/view.mjs` lines 326, 383 and 438 show legacy check/review history; `world-tools.cjs` lines 202–209 expose model history operations, not user branch controls. The core now supports branch authoring, and the candidate coordinator consumes candidate branch identity, but a user-facing selector still needs to bind branch context to source browsing/editing/building. No unsupported renderer route was invented in this change.

The integration owner must register the private `backup.restoreProof` route and consume it after restarting a restored core. Mill's native restore test also exposed Windows Git path-length failure under deeply nested staging paths; the caller shortened its owned layout, but this is not proof that arbitrary Windows profile/path lengths work. Keep the raw failure and do not claim that platform limitation is closed.

The private file install contract remains bounded: 4 MiB/file, 64 MiB/project, request envelope 8 MiB plus framing; a single request therefore cannot carry every possible maximum-sized project as base64. Unsupported resource extensions are rejected. Source installation is not itself successful runtime application.
