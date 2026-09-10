# Explicit target feedback overrides and inherited balance

The complete training-range scene applies `BalanceProfile` from `BaseWorld._ready`.
Previously that call unconditionally overwrote a target's serialized
`hit_flash_seconds`, so a valid per-instance source patch disappeared at runtime.

`TargetDummy` now records explicit assignments through its exported property's
setter. The Godot 4.7.2 initializer supplies the default without invoking that
setter; serialized scene assignments invoke it even when their value is the same
120ms default. A dedicated `apply_balance_hit_flash_seconds` method changes only
inherited values and prevents the profile's assignment from marking them explicit.
`BalanceProfile` calls this method when available, retaining its former fallback
for other target implementations and its existing crosshair behavior.

This changes two runtime scripts only. It adds no saved-state fields, changes no
target IDs, does not inspect scene paths at runtime, and does not use eval or
adapter-written values. An explicit ordinary script assignment also becomes an
instance override. There is no new reset-to-inheritance API in this slice.

## Actual engine verification

```text
node tests/player-product/target-feedback-balance-native.mjs <pinned Godot editor executable>
```

The test verifies the engine against `toolchain.lock.json`, copies the fixed
engine and authored base into an isolated directory, uses independent data
directories, and runs only bounded `--headless` import/script operations with
`windowsHide`. It changes the test scene's serialized B/C values and balance
resource before import, then instantiates the complete training-range scene.
No model, network, real input, visible window or pointer capture is used.

Actual 2026-09-10 result: **9/9 checks passed**:

- Implicit target inherits profile 250ms during the real ready lifecycle.
- Explicit 500ms survives that lifecycle.
- Explicit 120ms (equal to the script default) also survives.
- Updating the profile to 700ms updates the inherited target.
- The same update preserves both explicit targets.
- Real damage starts a 500ms flash on the explicitly configured target.
- Advancing that target's normal process method restores its original material.
- Saved target ID, five-field snapshot shape, health, hit count and damage remain correct.
- Reset/restore returns the exact saved snapshot without altering configuration.

Raw evidence in the test worktree: `test-results/target-balance-DUrEnw/` contains
`import.log`, `verify.log`, and `report.json`, including tested script hashes and
engine hash. Generated files are not committed. This is native authored-base
acceptance; it does not replace a complete client PP2 source/check/application run.
The configuration adapter's pinned script hash must be updated separately by the
integration owner after merging these scripts.
