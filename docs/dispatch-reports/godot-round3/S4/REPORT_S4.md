# S4 — durable portable backups and new-directory recovery

Branch: `codex/godot-round3-s4-20260910`
Worktree: `D:/Craftmine World-worktrees/godot-round3-s4-20260910`
Base: `c2e592f` (local master) + historical merge of the committed R2 head
`2fa3c7c` (`e79dd89`), the same starting point S1 used (`24edb0c`). No old tree
was copied, no old worktree was modified, and no contribution history was
rewritten.

## 1. Commits

| commit | what |
| --- | --- |
| `e79dd89` | merge: start round-three S4 from the committed R2 integration head |
| `cce8af5` | fix(backup): make portable restore durable, owned and crash-recoverable |
| `37e8215` | fix(backup): bind export staging to its operation and bound trailing-byte reads |
| `c98bf2c` | test(backup): kill a real restore process at every persistent boundary |
| `3c9a733` | fix(backup): snapshot every registered table and detect schema drift |
| `592bd41` | perf(backup): stream Git objects instead of buffering the object store |
| `ef61ea5` | docs(backup): spec, ADR, E2E and integration requests for durable restore |
| `e8f3d2d` | test(backup): keep authoring in a restored installation |

## 2. Identity

* Source: branch `codex/godot-round3-s4-20260910`, evidence head
  `e8f3d2d` (see `evidence/identity.txt` for the exact commit at evidence time).
* Core: `crates/craftmine-core` (Rust), rustc 1.96.1, cargo 1.96.1.
* Broker: not part of this module (core crate only).
* Engine: no Godot engine in this bundle; no engine assertion is claimed here.
* Plugin: not part of this module; the plugin route is requested from S2 (§7).
* Archive formats: `craftmine.portable-archive/1` (unchanged) and
  `craftmine.domain-backup/1` schemaVersion 3 (unchanged, extended allowlist).

## 3. What changed

### 3.1 Domain snapshot completeness and drift detection (`backups.rs`)

The allowlist `TABLES` was missing every Godot, content-history, asset-catalog
and legacy-import table. It now lists all 63 registered `craftmine_*` tables
except the two operational backup tables. `ADDITIVE_TABLES` pads older archives
with those tables (live columns, no rows). `assert_schema_covered()` runs at the
start of `snapshot()`, so a future module that registers a table the allowlist
does not know fails the export with `BACKUP_SCHEMA_DRIFT` instead of silently
dropping it; a listed table that no longer exists fails with
`BACKUP_SCHEMA_DRIFT_UNKNOWN_TABLE`.

### 3.2 Durable restore operation (`backups/portable.rs`)

`backup.restore-portable` is now an `operationId`-keyed durable operation:
a `craftmine_backup_jobs` row (`kind='restore-portable'`, status `restoring`,
request hash, archive hash, target) is committed before any body moves; every
filesystem action is appended to `journal.jsonl` in the staging area before it
happens; the final receipt is flushed to
`<target>/.craftmine-restore-receipt.json` before the database commit; and the
same transaction inserts a `craftmine_restore_marks` row so the commit proof
lives inside the restored database. Startup `backup_recover()` converges
interrupted restores from that mark: present → promote, absent and readable →
roll back exactly the journaled work, unreadable → delete nothing and report
`BACKUP_RESTORE_STATE_UNVERIFIED`. A retry with the same id converges, a lost
reply returns the stored receipt, and `backup.status` returns the same receipt.
Another operation's committed-but-unrecovered staging area is never rolled back;
the target is simply reported as not empty.

### 3.3 Proven staging ownership

Restore staging is `<target>/.craftmine-restore-<digest(operationId)>` with an
`owner.json` (`craftmine.restore-ownership/1`). A directory is removed only when
that record names the operation *and* its job row exists in this database;
symlinks and Windows reparse points are refused, and a lookalike directory makes
the target non-empty and is never deleted. Export staging got the same owner
record (`craftmine.export-staging/1`), so no deletion path in the module
depends on a name prefix. The old `.portable-staging-*` name-prefix deletion is
gone.

### 3.4 Streaming Git carrier

`GitAdapter::repo_stream` spawns a whitelisted Git subcommand and exposes its
stdout as a stream instead of buffering it. `enumerate_repositories` reads
`rev-list --objects --all` line by line and copies each `cat-file --batch`
object straight into its staging file in 128 KiB chunks while hashing. The
restore hashes the staged object by path (`hash-object --no-filters -w`) instead
of reading it into memory. The adapter's 64 MiB buffered-stdout cap no longer
applies to the archive path.

## 4. Formal entry points

| entry | location |
| --- | --- |
| `TaskJournal::backup_export_portable` | `crates/craftmine-core/src/backups/portable.rs` |
| `TaskJournal::backup_inspect_portable` / `backup_verify_portable` | same |
| `TaskJournal::backup_restore_portable` | same |
| `TaskJournal::backup_cancel_portable` (new) | same |
| `TaskJournal::backup_protected_refs` / `backup_release_portable` | same |
| `TaskJournal::backup_recover` (now also converges restores) | same |
| `TaskJournal::backup_export` / `backup_restore` / `backup_status` / `backup_cancel` | `crates/craftmine-core/src/backups.rs` |

RPC: S1 registered the six promised portable routes plus
`journal.backup_recover()?` at startup on its branch (`b307d54`, `a2e56a3`).
`backup.cancelPortable` is requested in §7.

## 5. Commands and raw evidence

Evidence bundle: `docs/dispatch-reports/godot-round3/S4/evidence/`.

```powershell
pwsh -File tests/godot-round3/S4/run-s4-evidence.ps1
```

| evidence file | result |
| --- | --- |
| `rust-s4-domain-tests.txt` | `ok. 2 passed; 0 failed` |
| `rust-s4-portable-tests.txt` | `ok. 10 passed; 0 failed; 2 ignored` |
| `rust-s4-durability-tests.txt` | `ok. 6 passed; 0 failed; 1 ignored` |
| `rust-s4-full-crate-tests.txt` | `ok. 235 passed; 0 failed; 5 ignored` |
| `rust-s4-memory-stdout.txt` | large-store export+verify `ok. 1 passed`; `export marginal peak commit: 0 MiB (peak before 7442432 bytes, peak after 7442432 bytes, content 83910649 bytes)` |
| `rust-s4-memory-peak.txt` | child-process peak private bytes `7.1 MiB` |
| `identity.txt` | branch, commit, toolchain |

Regression baseline: R2 recorded `226 passed / 1 failed / 3 ignored` with
`backups::portable::tests::portable_archive_restores_into_a_new_directory_without_the_source`
failing with `GODOT_PROJECT_REVISION_NOT_INDEXED`. That test now passes and the
crate is `235 passed / 0 failed / 5 ignored`.

### 5.1 The documented joint failure: corrected root cause

The round-two request attributed the failure to the backup table list. The
measurement says otherwise, and the fix covers both:

* The failing fixture (`portable_tests.rs::seed_repository`) inserted a
  `craftmine_content_repositories` row, which makes the world Git-backed, but
  never wrote the revision index the product's own migration writes. The
  **source** data directory therefore failed `godotProject.read` with
  `GODOT_PROJECT_REVISION_NOT_INDEXED` before any backup was taken; the archive
  and restore were faithful. Measured on the unmodified baseline:
  `SOURCE craftmine_godot_project_commits rows=0`, `SOURCE read =
  Err("GODOT_PROJECT_REVISION_NOT_INDEXED")`.
* The portable path already discovered tables dynamically, so the static
  `backups.rs::TABLES` allowlist was never on this code path. It was still a
  real defect for the domain archive (`backup.export`/`backup.restore`, the R2
  UI path) and is fixed in §3.1.

The fixture now records the revision index exactly as the migration does and
its repository history carries the bytes the manifest describes, so the test
proves a real Git-backed restore instead of an impossible state.

### 5.2 Memory measurementFixture: one managed repository with 40 commits of one 2 MiB pseudo-random blob
each, committed one at a time so the fixture itself stays small; the export
streams 83,910,649 bytes of archive content. Peak commit charge before and after
the export: 7,626,752 bytes both times (delta 0 bytes); the child process peak
private bytes are 7.3 MiB. The same repository is above the adapter's old 64 MiB
buffered-stdout cap, so the pre-fix code could not even complete it
(`BACKUP_GIT_TRUNCATED`).

Measured tier: this is a **single-repository ~80 MB object stream** measurement
on this machine. It is not a claim about multi-gigabyte worlds; the declared
caps remain 4 GiB per body, 256 GiB total, 2,000,000 entries, and the object id
list is still resident and bounded by that entry cap.

### 5.3 Adversarial review and the fixes it produced

An independent read-only review of the change found that the first version
proved a commit by comparing the *live* database fingerprint with the
pre-commit receipt. That is unsound: any later write to the restored database
invalidates the fingerprint, and an unreadable database was treated as "not
committed", which is the destructive branch. Three high-severity scenarios
(a committed restore rolled back by its own retry, by a new operation id, or by
an unreadable target) were fixed by moving the proof into the restore
transaction itself (`craftmine_restore_marks`) and by adding an explicit
unverified branch that deletes nothing. The export path guard now canonicalizes
the archive path before the containment check, an interrupted export no longer
wedges its operation id, and a cancel request reports the durable status instead
of claiming one. Two new tests cover the boundaries the review named as missing:
a kill between the receipt and the commit, and a second operation that must not
undo a committed restore. The review's remaining findings are listed in §7.

## 6. Completion conditions

| requirement | status |
| --- | --- |
| 1. Durable export/restore operations, common snapshot boundary, operationId query/retry/cancel/status, final receipt; recoverable commit order; lost reply returns the same result | **done** for restore (durable row, journal, pre-commit receipt, status/retry/cancel). Export already had a durable row and pins; `backup.status` returns it. |
| 2. End a real independent test process at each persistent boundary (content move, Git rebuild, database commit, publish, receipt) | **done**: `after-claim`, `after-stage`, `after-content`, `after-git`, `before-commit` (receipt written, commit not yet) and `after-commit`, each in its own process; recovery rolls back or promotes; retry converges; no `BACKUP_TARGET_NOT_EMPTY` loss. |
| 3. Remove name-prefix cleanup; bind target/staging/journal to verifiable operation identity; refuse unknown directories, reparse/link/path substitution; re-verify ownership before cleanup | **done** for restore and export staging; lookalike and reparse refusal covered by tests. |
| 4. Common consistency snapshot on the final model, including Godot/Git tables, indexes and references; detect future schema additions | **done** in `backups.rs` (all 63 tables, `BACKUP_SCHEMA_DRIFT`); the portable snapshot already discovers tables dynamically. |
| 5. Restore into a new directory after the origin is gone, then keep creating through real `godotProject.read`/index, asset read, history query and world load; keep the latest selected state and provenance | **partly done**: new-directory restore + `godotProject.read` + Git file read + asset body + world load + new project/revision creation are covered. `godotProject.build` and a full history query need the executor/engine and are not claimed here. |
| 6. Core consumes backup pins internally; in-flight snapshots, retained archives and restore operations participate in protection; real concurrent write/build/export/reclaim | **module side done**: `streaming`/`retained` pins are written before bodies are read and released only by `backup_release_portable`; S1 aggregates `build` pins inside the reclaimer (`a2e56a3`). Git-history reclaim does not yet consume `git-ref` pins (§7.3). No concurrent write/build/export/reclaim run was performed. |
| 7. Remove whole-store `cat-file` capture; bounded Git objects, domain snapshots and archive bodies; measure peak memory with a larger real sample and declare the tier | **done** for Git objects and trailing-byte reads; the domain snapshot is still a bounded in-memory JSON document (32 MiB cap) and the object id list is resident. Measurement in §5.2. |
| 8. Official RPC, migration/startup recovery (S1), service routing (S2), restore UI (R2); each actually integrated; bad package, missing content, lock file, disk full, cancel, incompatible preserve the original world | **module side done**; RPC routes and startup recovery are on S1's branch, routing and UI are requested in §7. Bad package / missing content / incompatible / cancel are covered by tests; **disk full and lock contention were not measured** (they need an environment change or a second live process) and are reported as not done. |

## 7. Located but unresolved

1. **`backup.cancelPortable` route (S1)** — one line in `main.rs`; requested in
   `INTERFACE_REQUEST.md` §1.
2. **Plugin/broker routing (S2)** — `plugins/craftmine-world/host-requests.cjs`
   allowlists only the legacy backup methods, so the UI cannot reach the
   durable portable operations; requested in `INTERFACE_REQUEST.md` §2.
3. **Git-history reclamation must consume `git-ref`/`repository` pins (S1)** —
   the build reclaimer aggregates pins, the Git reclaimer still trusts its
   caller; requested in `INTERFACE_REQUEST.md` §3.
4. **Restore UI (R2)** — operationId lifecycle, status polling and
   `rebuildRequired`; requested in `INTERFACE_REQUEST.md` §4.
5. **Real engine/model and install-package accounting** — out of scope here: no
   Godot engine in this bundle, no real model request, no installer. Those are
   S7/S8 line items.
6. **Disk-full and lock-file behaviour** — not measured; error injection
   (damaged archive, truncated body, schema mismatch, domain failure) is covered
   by tests instead. Unknown, not claimed.
7. **No cross-process exclusion** — two restores with different ids into one
   target are serialized only by SQLite locking; a same-id retry while the first
   process is still alive is not detected by a live-process check. The review
   rated this medium-high. Not fixed here.
8. **Portable restore column subset** — `apply_domain_rows` accepts an archive
   whose columns are a subset of the live table (missing columns take defaults)
   and rejects an archive missing a whole table instead of padding it with
   `ADDITIVE_TABLES`. The domain path requires exact columns. Not changed here
   because it interacts with cross-version compatibility; documented as a risk.
9. **Remaining buffering** — the domain snapshot is still one in-memory JSON
   document (32 MiB cap in the domain path, 1 GiB `DOMAIN_LIMIT` in the portable
   path), the entry table is one `Vec<Value>`/`Vec<String>`, and the object id
   list is resident. Only the content bodies and Git objects are streamed.
10. **`craftmine_backup_jobs` growth** — portable operations do not go through
    the domain `job_capacity` check, so the operational table is not bounded.

## 8. Reproduction notes

* `tests/godot-round3/S4/README.md` lists the exact commands.
* The crash helper is an ignored test driven by `S4_CRASH_ROOT` and
  `CRAFTMINE_S4_CRASH_AT`; without those variables it does nothing, so a plain
  `--ignored` sweep cannot build stray state.
* No input simulation was used: no `tests/browser.mjs`, no
  `tests/modules-browser.mjs`, no Playwright input, no window activation or
  focus, no user browser. The crash tests end only the processes they started.
