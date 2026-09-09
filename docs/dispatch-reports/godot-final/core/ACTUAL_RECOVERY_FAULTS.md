# Actual client recovery faults — 2026-09-10

**Result: 10/10 actual client checks passed.** No model, OS input, foreground window, Pointer Lock, snapshot assignment or successful restore replay was used.

## Persisted activation with a failed reply

The original owned run desktop-native-complete-IrpWv3 genuinely ended with INVALID_OPERATION_RECEIPT after activation had already persisted. Its .craftmine-active-data.json points to operation b4b29dd5-aa3a-4d1e-b4bb-6942736c3f7c and archive bf95db78eb85f9b3dfc061410e7a40abea770de3ea12113d67b0e9c820882ef8.

We restarted that same owned profile with a frozen source-built client. Before sending any restore request, the actual active world matched the original restore selection. Both original worlds were reopened and their complete native progress compared to the original pre-failure snapshots:

- Top-down world-8e2edd68fa44: inventory, coins, rewarded quest, stock, scene, facing, position and all other state fields matched.
- Side-view world-7c4ce4367a22: room ledger, ability, checkpoint, inventory/coins, entity health, vitals, placement and all other state fields matched.

Both actually rendered nonempty Godot surfaces. The existing activation pointer, original failure report and archive bytes were preserved. The old restore was never replayed.

## Actual stale CAS and continuation

backup.inspect returned a real currentHash grant for the existing archive. Subsequent ordinary product creation of a first-person world, its actual build/check/application, gameplay and durable save changed the real core fingerprint. Submitting the earlier grant/hash then failed with **BACKUP_CURRENT_HASH_CONFLICT**. The activation pointer did not change and the newly created active world remained selected.

After rejection, navigation became enabled again. Actual equipment/look operations and capture succeeded, followed by durable save, orderly Electron/core shutdown and another complete restart. The continued world's entire native snapshot matched the saved snapshot after restart. Separate read-only inspection of the raw action records confirmed observed yaw/pitch changed between 0.3/0.15 and -0.3/-0.1 exactly as requested; successful RPC labels alone were not treated as gameplay proof.

Both successful-run processes exited code 0 without forced termination. Their exit audits recorded empty input/focus violation and page-error arrays. This does not claim the absence of all software-renderer diagnostic messages.

## Evidence and reproduction

New harness: tests/godot-final/client-recovery-faults.mjs. It accepts a pre-frozen run directory and an explicitly owned failed-run directory. It requires the genuine original failed-reply record and persisted pointer, verifies the frozen files before launching, and never rebuilds product binaries.

Executed command:

    node tests/godot-final/client-recovery-faults.mjs test-results/desktop-native-recovery-gql5Pk test-results/desktop-native-complete-IrpWv3

The harness deliberately advances the owned profile during its continuation scenario. The original failure report/archive stay immutable; rerunning the initial-active-world assertion requires an equivalent untouched failed-run fixture, rather than pretending the profile still has its earlier active selection.

Raw successful evidence: test-results/desktop-native-recovery-gql5Pk/fault-evidence-qmdsC6/report.json, stdout/stderr logs, captures and observed-action-check.json. Report SHA256: **60c581fe0755c871a4902321d6b80b4853cd916e87dc4e7356caad7a0a35c28e**.

Frozen client manifest: test-results/desktop-native-recovery-gql5Pk/frozen-info.json, 1,936 files, SHA256 **f80cce1c7546d903696f7b348e6ee1be6a51a34dab5858574e1c876fd825658f**. Compiled main SHA256: **4935c3a55137621cd94c667c2cee05a0f88931de9f09589a2255005273f0b494**. App out/resources, core/host executables, Godot source/toolchain and workspace package dist files were copied; dependency node_modules were shared read-only. Root's subsequent builds did not replace these copied runtime files.

The first frozen launch omitted agent-runtime/dist/sidecar.js, so its backend/plugin did not boot. That harness dependency failure is retained under fault-evidence-vZ5Ctm, including a clean exit audit. Packages were added only after that process exited; frozen-info-incomplete-v1.json preserves the first manifest. It is not counted as a successful product-recovery run.

This proves the two named recovery paths in a real isolated source-built client. It is not an installer, real-model creation, mining, copied-world gameplay, or exhaustive crash-window acceptance.
