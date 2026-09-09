# S4 interface and integration requests

Branch: `codex/godot-round3-s4-20260910` (worktree
`D:/Craftmine World-worktrees/godot-round3-s4-20260910`).
Base: `c2e592f` + historical merge of the committed R2 head `2fa3c7c`.

The module-side work is committed and self-tested. The items below are the
remaining cross-boundary wiring; each names the exact owner and the exact change.
Until they land, the corresponding product path is **not** complete.

## 1. S1 — register `backup.cancelPortable` (core RPC)

S1 already registered the six promised portable routes and the startup
`journal.backup_recover()?` call. S4 adds a seventh operation, the durable
cancel request for a restore:

`vendor/pi-desktop/crates/craftmine-core/src/main.rs`, next to the other
portable routes:

```rust
"backup.cancelPortable" => return journal.backup_cancel_portable(params),
```

Nothing else changes. `backup.status` already returns the stored receipt for a
portable restore operation id.

## 2. S2 — route the portable backup methods in the plugin host bridge

`plugins/craftmine-world/host-requests.cjs:114` allowlists only the legacy
domain methods:

```js
if(['backup.export','backup.inspect','backup.restore','backup.status','backup.cancel'].includes(method))return core.call(method,params,60000);
```

The product UI cannot reach the durable portable operations until this includes:

```js
'backup.exportPortable','backup.inspectPortable','backup.verifyPortable',
'backup.restorePortable','backup.cancelPortable','backup.protectedRefs','backup.releasePortable'
```

Long-running methods (`exportPortable`, `verifyPortable`, `restorePortable`)
need a timeout that is not shorter than a real large export; the current 60 s
bound is too short for a multi-gigabyte archive.

## 3. S1 — Git history reclamation must consume backup pins

S1's `a2e56a3` aggregates `kind='build'` pins inside
`godotStorage.reclaimPlan`. The Git side still trusts the caller's keep set:
`content_history/repo.rs::reclaim_plan` / `content.rs` do not read
`craftmine_backup_pins` rows of kind `git-ref` (`repoId|refName|oid`) or
`sourceBlobs`. A retained archive therefore does not protect the Git objects it
carries. Requested change: aggregate `kind IN ('git-ref','repository')` pins
inside the core reclaim plan, exactly as the build reclaimer now does, and keep
caller-provided refs additive.

## 4. R2 — restore UI on the durable operation

`backup.restorePortable` is now an `operationId`-keyed durable operation:

* create the id once and keep it for retries; the same id returns the stored
  receipt instead of starting a second restore;
* poll `backup.status` with that id for the receipt, or after a lost reply;
* `backup.cancelPortable` records a cancel request that the running restore
  honours at its next persistent boundary;
* surface `rebuildRequired` from the receipt: those build copies were restored
  as metadata only and must be rebuilt before the world is played;
* an interrupted restore is converged by startup recovery, so the UI may retry
  the same id rather than asking the user to clean directories.

## 5. S7 — integration

The branch is ready to be consumed as a module contribution. It touches only
`crates/craftmine-core/src/backups.rs`, `backups/**`,
`crates/craftmine-core/src/content_history/git.rs` (streaming spawn),
`crates/craftmine-core/src/backups/portable_tests.rs`,
`docs/spec/godot-portable-archive.md`, `docs/spec/dispatch-a-durable-domain.md`,
`docs/spec/06-delivery/dispatch-m-e2e.md`,
`docs/adr/dispatch-s4-durable-restore-operations.md`,
`tests/godot-round3/S4/**` and
`docs/dispatch-reports/godot-round3/S4/**`. No `main.rs`, no plugin file, no
UI file. S1's `a2e56a3` and this branch touch disjoint lines in
`godot_storage.rs`/`main.rs`, so the integration merge is textual only.
