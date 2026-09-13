# Keep creation geometry validation in the actual source runtime

Real city exploration saved player position
`[36.4433135986328,14.7000799179077,-169.221267700195]` through native progress
persistence. The city's `orgrimmar_world.gd` overrides the starter validation
with its own x/y/z bounds. The subsequent revision-13 check failed with
`MIGRATION_CREATION_STATE_INVALID` before attempting to restore that saved pose.

Both `desktop/godot/shared/progress-migration.mjs` and Rust's independent
`godot_additive_progress.rs` had copied the empty starter room's x/z ±32 and
y 0..32 limits into structural derivation. This made a supported source-owned
city save unusable at its next content change, despite its actual scene being
able to restore it. Fixing only JavaScript would still block native preparation.

Both implementations now require exactly three finite position numbers and
preserve them unchanged. Orientation, identity, ledger/component structure,
counts, JSON/depth/size limits and the independent proof comparison remain.
No configurable bounds or model-supplied migration policy is introduced. Room
dimensions remain in source; actual restore, physics collision, snapshot
comparison and native adoption receipts still decide acceptance. No world source,
engine, pinned runtime helper, player progress or immutable exported artifact changes.

The separate error-projection omission is corrected using the native schema's
existing assertion detail. A bound verifier error is included only when the
check already failed. Native output hashing and the normal untrusted-data
diagnostic projection then preserve the actual reason. Old immutable outputs
that omitted it cannot be retroactively repaired without inventing evidence.

Validation uses `tests/fixtures/creation-city-migration.json`, copied from the
recorded native snapshots in `test-results/codex-promo/city-migration-inputs.json`.
JavaScript and Rust retain the exact city pose/inventory, reject malformed state
and forged relocation proofs, and retain the fixed FPS/component tests.

The read-only native run is
`test-results/desktop-native-creation-progress-NS4U2i/report.json`. It replays
the real failed check `gjob-931dee6fddca6fdb03a552ae8c977b9c2d14be23aa423b28ede04abde306f60f`
on unchanged build `gbd-ef766140c6f2a3eefb489b2a70cc93ed8b5299d2037cf7097313acf37524238e`,
source revision 13, manifest
`9bf39115a9e1df66c24fa6022b32ef47832627082d3e65cc8138f2bf90bc4217`.
Every source and artifact length/hash was verified before and after.

The actual Godot verifier restored and confirmed the complete saved state and
captured `saved.png` at the bridge, retaining the explored 4/6 district ledger.
A separate invalid x coordinate reached the engine and failed with
`Saved player pose is outside the authored city`. A separate pose 0.5 m inside
the existing bridge surface failed with
`CREATION_COLLISION_GUARD_FAILED:PLAYER_PENETRATION`. These negative restore
inputs never touched the player's saved profile and are not navigation evidence.
Negative cases use separate diagnostic-only job/input identities and are never
registered as native jobs or attached to the original job's durable output.

The original failed report and an initial test-harness failure are retained.
The latter assumed a host-prefixed load error, while the engine's real error
event arrived first; the corrected assertion checks the actual runtime error.
No source change was used to make a test pass. The proof is an isolated native
check, not Core registration or candidate adoption. `pcity` was not opened or
mutated. No model call was made.

## Rebuild and resume

Validation passed 71 JavaScript/protocol tests (one existing Windows symlink
skip), 15 Rust additive/proof/application tests, strict native-helper typechecking
and the real three-case Godot replay. A release standalone Core and rebuilt
plugin are staged separately from the coordinator's active components:

```powershell
cargo build --manifest-path vendor/pi-desktop/Cargo.toml --release -p craftmine-core --target-dir test-results/creation-progress-core-build
node desktop/build-world-plugin.mjs --output test-results/creation-progress-plugin
```

After the coordinator's current author turn is cancelled normally and consumers
of its mutable development component set are stopped, update that set's
`resources/bin/craftmine-core.exe` from
`test-results/creation-progress-core-build/release/craftmine-core.exe`.
Run `node desktop/build-world-plugin.mjs` to rebuild the retained session's
existing `desktop/build/craftmine.world` plugin path. The tool schemas/catalog
are unchanged. Do not modify the sealed release or session/world identity.

The project CLI bundles its live/check helper from source each time its services
start. Starting a new CLI turn therefore picks up the JavaScript correction;
no Godot source re-export is needed to update the host. For the desktop package,
also rebuild the Rust `host-core` binary and the Electron main bundle:

```powershell
cargo build --manifest-path vendor/pi-desktop/Cargo.toml --release -p host-core
pnpm -C vendor/pi-desktop/apps/desktop build
```

Resume through the same entry with the coordinator's preserved city continuation
prompt; the retained session enforces exact `gpt-6-astra` / `xhigh`:

```powershell
node scripts/promo-world-author.mjs turn --data "D:/Craftmine Worktrees/codex-promo-20260913/test-results/pcity" --codex "C:/Users/WINDOWS/AppData/Local/OpenAI/Codex/bin/bffc5354119c8421/codex.exe" --live-host true --prompt $preservedCityPrompt
```

The old failed native job remains failed: this replay is not a replacement
native check or application receipt. Continue from current source/task facts and
normal checks. Preserve same-source artifact-conflict refusal; never add a
meaningless source edit, replace immutable exports, reset the player or mark a
check passed to get around it. Historical raw error evidence remains available
in the original private verifier report, while new failures expose the bound
error assertion to the author.
