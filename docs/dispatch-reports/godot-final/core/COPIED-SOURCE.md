# Exact formal source for copied worlds

`godotWorld.copy` now reads the recorded formal build's source revision and branch, rather than the source world's current draft. The target owns those bytes and migrates them into its managed repository. A copy of a copy records the actual formal build owner, so the existing shared-artifact descriptor still resolves correctly.

The target retains a dedicated `refs/craftmine/copied-formal/<world-and-build-hash>` reference. This prefix is included in protected refs for Git reclamation and portable backup. No new SQLite contract or second content store was introduced. Before accepting any retained source, the core verifies its entire file set against the original formal build's source-file SHA-256/length index. It does not rely on equal filenames or a selected branch name. Raw binary assets stay binary.

Private **`godotWorld.prepareRebuildSource({worldId})`** is now required by the restore-rebuild service after source migration and before rebuildPlan. A non-copy returns `copied:false`. For a copy it verifies/reuses an existing protected ref, or adopts an exact local copy after checking every source file, or reconstructs a protected commit from the original owner's exact formal revision. It returns `contentOid` and `replayed`/`adopted` where applicable. Caller-supplied paths, content OIDs and replacement snapshots are not accepted. The operation holds the common content/export/GC OS lock.

For copied worlds, rebuildPlan's `contentOid` is the independent target-repository commit retaining the formal source. `rebuildContentOid` remains the dedicated rebuild branch's same-tree commit. The root's candidate identity check therefore stays unchanged. A target with a verified retained snapshot can rebuild even when the original owner's Git files are unavailable. An old target containing only a newer draft must have the original formal source available; otherwise it fails `GODOT_REBUILD_SOURCE_NOT_AVAILABLE`. Missing or corrupt source is never replaced by an unrelated draft.

Copied worlds have no original creation row; initStatus now uses their actual persisted copy id and formal deployment evidence, checks artifact availability, and reports `playable:false/rebuildRequired:true` when restored caches are absent.

## Evidence

The existing real portable restore regression now covers three worlds: original g1 with formal source plus newer unpublished main, exact copy g2, and copy-of-copy g3. It verifies g2 starts from the formal revision. It then simulates an older g2 with an unpublished target draft and no dedicated ref, exports/restores without the original data path, transfers g2's exact formal source, and proves both unpublished drafts and full copied progress remain intact. A missing original Git repository blocks g2 while g3's protected ref still verifies; even with g3's ref removed, an exact local file set is verified and adopted without reading that missing source. The original world's subsequent source rebuild/application/core restart also remains covered.

- `core-copied-full.log`: 269 passed, 7 ignored, one documentation test ignored.
- `copied-worlds-final.log`: 7 Godot world tests passed after adding verified local adoption.
- `copied-adoption-final.log`: extended source-unavailable/local-adoption archive regression passed.
- `copied-rebuild-service-final.log`: 3 orchestration cases passed after adding the preparation call.
- Initial visibility/compile failures remain in `copied-source-01.log`; no failed attempt was hidden.

These are actual Git/core/archive transactions with synthetic executor/application evidence. They do not claim another real Godot rendering or model run. Main-process private-route registration and native restoreLoad are the integration owner's responsibility. Read-only sourceContext still requires a real target workspace; a copy caller that wants immediate source browsing must complete its actual target-world binding first.
