# Authored native user-game export acceptance

On Windows, build the integrated sandbox broker with Cargo offline, then set
`CRAFTMINE_CORE_BIN` to the integrated Rust core executable,
`CRAFTMINE_BROKER_BIN` to the newly built broker and
`CRAFTMINE_GODOT_CACHE_DIR` to the verified 4.7.2-stable cache. Run:

```powershell
node tests/godot-final-install-assets/windows-game-native.mjs
```

The script always creates a unique temporary root and retains failure logs.
Require `report.json.passed === true`, all four checks, process/network
verification, broker cleanup and a retired journal. Require an unchanged pinned
EXE and nonempty PCK, then complete-state equality across two independent
headless exported-game processes, including timestamp, equipment, targets,
interactables, quests, inventory and player state. No real input/focus is used.

Run Rust `windows_export` unit tests for custom-template/resource-tool and
modified-EXE/extra-DLL refusal, plus `task_kinds_have_fixed_argument_sets`.
Do not interpret authored headless acceptance as user/model-generated gameplay,
UI availability, all-base standalone compatibility or full visible CP4 success.
