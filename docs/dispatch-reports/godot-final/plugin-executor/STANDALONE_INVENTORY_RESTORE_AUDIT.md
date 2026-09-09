# Standalone inventory and restore fault evidence

## Two reviewed project sources

Read-only review used Mill's tree
`D:/Craftmine World/test-results/final-install-assets` on 2026-09-10.
`standalone_bootstrap.gd` is newly authored project glue using the existing
managed runtime and `state_guard.gd`, with local save/load and atomic save
replacement. It is loaded in exported games, so its inventory scopes are
`app-bundle` and `user-export`. `windows-export.cfg` is the fixed host-controlled
Windows Desktop export preset, with custom templates empty, resource editing
and signing disabled. The production service reads both from its pinned
`resourcesRoot/shared` at `godot-windows-export-service.mjs:72`. The preset is
needed by the client export service, so its scope is `app-bundle`.

Only these two exact new paths are added to `NEW_AUTHORED`. No recursive shared
directory approval, third-party approval or rights grant is introduced. New
entries remain `project-authored` with the existing pending-application note;
the manifest's `rightsStatus` and reviewed commit remain untouched. Pins are
NOT generated in this task: root will freeze the combined source before the
single canonical refresh.

`node --test --test-isolation=none tests/godot-final/authored-pins.test.mjs`:
**6 passed, 0 failed, 0 skipped**. The new case permits just the two additions,
checks their distinct distribution and pending rights, and rejects a third
unreviewed shared source. This is an inventory test, not a standalone gameplay
acceptance result.

## Whole-client restore evidence as inspected

| Case | Evidence | Assessment |
| --- | --- | --- |
| Actual top-down and side-view save, process shutdown and reopen | root `test-results/desktop-native-complete-IrpWv3/report.json` | Reached portable export after these successful steps; this proves ordinary progress restart, not recovery after an interrupted restore. |
| Portable archive export and body verification | Same report, calls near lines 30122–30163 | Export completed; inspect verified 205 files / 207 entries, 662869 bytes. |
| Restore activation response failure | Same report, call near line 30167 | Actual `INVALID_OPERATION_RECEIPT`; restored data tree exists. The harness then quit and recorded failure. Do not label rollback, resume or post-failure restart verified. |
| Durable receipt restart regression | root `test-results/final-backup-journal-tests.log` | 5/5 pass, including activated restore receipt surviving restart without repeating restoration. Real filesystem journal plus controlled service inputs; not whole Electron/Godot recovery. |
| Later full client run | root `test-results/desktop-native-complete-p8lNEx/report.json` | Stopped earlier on package import `PLUGIN_CALL_FAILED`; provides no new restore completion evidence. |

The source harness `tests/godot-final/client-complete.mjs:120`–127 contains the
successful restore → exact progress comparison → actual process restart checks.
Those are necessary and presently not reached in the inspected failing report.

The two highest-value missing fault cases are:

1. **Activation already committed, response or rebuild fails.** Interrupt after
   the active-root pointer/proof is persisted but before the UI completion
   receipt, restart the isolated client, then verify the selected root and
   world/build, complete saved progress, recoverable task state, and no second
   restore on same-operation retry. Existing receipt-unit success cannot prove
   the actual plugin/core/view lifetime boundary. This targets the real
   `INVALID_OPERATION_RECEIPT` class of failure.
2. **Restore rejected before activation, then continue normal play.** Use a stale
   expected current hash after inspection, assert the old root/world remains
   selected, verify the restore lock and `backupFrozen` state clear, then mutate,
   save and restart successfully. `craftmine-backup-service.ts:117`–134 invokes
   `afterRestore` on failure; `index.ts:2520`–2539 retains the lock while active
   identity is unknown, and `view.mjs:163` resumes/unlocks only after a known
   record/empty state. That interaction needs a real client negative case;
   simply observing the expected CAS error is insufficient.

These are evidence gaps, not claims of newly reproduced source defects. No root
product files, model configuration or external model requests were changed.
