# Portable complete archive (`craftmine.portable-archive/1`)

Status: implemented in `crates/craftmine-core/src/backups/portable.rs`.
Owner: R5 (complete archive, restore, backup protection references).
Consumers: R1 (RPC registration, Git and build reclamation), R2 (restore UI),
R6 (asset body reclamation), R7 (query/proposal entry points).

## 1. Problem

The bounded domain archive (`craftmine.domain-backup/1`) and the earlier
"complete" archive (`craftmine.complete-backup/1`) both travel as one JSON
document. They are limited to 32 MiB, and the complete archive only records a
*manifest* of external content (paths, sizes, hashes). Restoring such a backup
requires the original data directory to still exist and still be readable, so
"move to a new computer" was never actually possible.

## 2. Format

One file, written next to its final name and renamed into place only after the
whole stream verified. Nothing is buffered as a single document.

```
MAGIC             "CRAFTMINE-PORTABLE-ARCHIVE/1\n"
HEADER            one JSON line
ENTRY[0..N]       one JSON line per entry
BODY[i]           raw bytes, only for entries whose `body` is true
FOOTER            one JSON line
```

* `HEADER` carries `format`, `schemaVersion`, `createdAt`, `sourceDigest`,
  `entryCount`, `rebuildable` and `consistency`.
* The entry table is one JSON line per entry, never a single line for the whole
  table, so a large history is not bounded by a line limit. Each entry lists
  `path`, `kind`, `owner`, `world`, `bytes`, `sha256`, `refs`, `repoId`,
  `objectFormat`, `oid`, `objectType` and `body`.
* Every entry path must live under the root implied by its kind
  (`domain.json`, `legacy-imports/`, `godot-source/`, `godot-assets/`,
  `asset-catalog/blobs/`, `content-history/repos/`). An archive can therefore
  never overwrite the database or an unrelated file.
* `HEADER.consistency` records the common boundary: the domain snapshot hash,
  the table count, the content roots, per-category reference counts, and an
  explicit `credentialsIncluded:false`. `sessionRowsIncluded:true` is reported
  honestly: local session and world-lease routing rows travel with the domain
  snapshot and contain no credentials or tokens.
* `HEADER.rebuildable` names every cache that is deliberately **not** shipped
  (`godot-builds/<worldKey>/<buildId>/{source,artifacts,cache}`,
  `content-history/repos/<repoKey>/copies`, `git-config`) with a reason.
* `FOOTER` carries `entryCount`, `contentBytes` and `archiveHash`.
  `archiveHash` is the SHA-256 of the header line and the whole entry table, so
  neither can be edited without detection. Every body is verified against its
  own `sha256` while streaming, and `consistency.snapshotHash` is checked
  against the domain entry's hash.

Streaming caps: one entry body 4 GiB, one JSON line 8 MiB, the declared entry
total 256 GiB, at most 2,000,000 entries.

## 3. Entry kinds

| kind | owner | body | source |
| --- | --- | --- | --- |
| `domain` | R5 | yes | full row snapshot of every registered `craftmine_*` table |
| `legacy-import` | R5 | yes | `craftmine_legacy_imports` manifest plus every listed source file |
| `godot-source-blob` | R1 | yes | `craftmine_godot_revisions` manifests -> `godot-source/<worldKey>/blobs/<sha256>` |
| `godot-asset-body` | R1 | yes | `craftmine_godot_assets` -> `godot-assets/<worldKey>/<sha256>` |
| `asset-blob` | R6 | yes | `craftmine_asset_files` -> `asset-catalog/blobs/<xx>/<sha256>` |
| `content-repo` | R1 | no | one managed repository: `repoId`, `objectFormat`, `refs` (`name\|oid`) |
| `content-repo-object` | R1 | yes | every object reachable from those refs, plus its Git type |

Rebuildable caches are never enumerated.

## 4. Consistency boundary

The archive never copies a directory tree "as it happens to look".

1. One immediate transaction snapshots the domain tables and enumerates the
   content set from durable rows.
2. Protection pins for that archive are inserted **in the same transaction**, so
   a reclaimer that starts afterwards already sees them.
3. Bodies are read afterwards. Every source is immutable: a sealed legacy
   import, or a file addressed by its own SHA-256. A body is either present and
   hash-verified or the archive fails; a partially written `pending-*` file is
   never referenced by a row and is therefore never archived.
4. Git objects are read with `rev-list --objects --all` + `cat-file --batch` from
   the snapshot's references, so the object set is exactly the reachable set at
   that boundary. Both commands are consumed as streams: `rev-list` is read line
   by line, and each `cat-file --batch` object is copied straight into its
   staging file in 128 KiB chunks while hashing, so no whole-object and no
   whole-store buffer exists and the adapter's 64 MiB buffered-stdout cap does
   not apply. Only the deduplicated object id list is resident, bounded by the
   entry-count cap.
5. The archive is renamed into place and the job row and pins are marked
   completed in a second transaction.

## 5. Restore

`backup.restore-portable` is a durable operation. It is identified by
`operationId` and its progress is a row in `craftmine_backup_jobs`
(`kind='restore-portable'`), written before any body moves.

1. **Claim.** The operation row is committed with `status='restoring'`, the
   archive hash and the exact request (`archivePath`, `targetDirectory`,
   `inPlace`). Only then is the staging area created.
2. **Ownership.** The staging area is `<target>/.craftmine-restore-<digest>`
   and carries `owner.json` (`craftmine.restore-ownership/1`: operation id,
   archive hash, target, in-place flag, process id, creation time). A directory
   is removed only when its owner record names this operation *and* the job row
   for that operation exists in this database. A symlink or a Windows reparse
   point is never followed. A lookalike directory that cannot be proven to be
   ours refuses the restore with `BACKUP_TARGET_NOT_EMPTY`; it is never deleted.
3. **Journal.** Every filesystem action (created directory, placed file,
   created repository store, created database) is appended to
   `journal.jsonl` inside the staging area *before* it happens, so a killed
   process can undo exactly its own work.
4. **Staging and verification.** Bodies are staged and hash-verified first.
5. **Apply.** Bodies move into place, repositories are materialized, and the
   domain rows are written inside one transaction.
6. **Receipt and commit mark before commit.** The final receipt is written to
   `<target>/.craftmine-restore-receipt.json` and flushed *before* the database
   commit, and the same transaction inserts a `craftmine_restore_marks` row
   (operation id, archive hash, domain hash) so the commit proof lives *inside*
   the restored database and cannot be invalidated by a later write.
7. **Commit and finish.** The database commits, the job row is marked
   `completed` with that receipt, the marker is removed and the staging area is
   removed after ownership is re-verified.

Consequences:

* A process killed before step 7's commit leaves the transaction uncommitted
  (SQLite rolls it back) and recovery replays the journal in reverse, so the
  target is exactly as it was.
* A process killed after the commit is recognized because the restored database
  contains the commit mark for that operation and archive hash; the restore is
  promoted to `completed` instead of being rolled back. A later write to the
  restored database cannot change that answer.
* Recovery never guesses: when the target database cannot be read (locked, or a
  `-wal` that cannot be recovered), it deletes nothing and reports
  `BACKUP_RESTORE_STATE_UNVERIFIED`. Only a target that is readable *and* lacks
  the mark is rolled back.
* Another operation may not roll back a committed restore: its staging area is
  left alone and the target is reported as not empty.
* A lost reply is not a lost result: the same `operationId` returns the stored
  receipt, and `backup.status` with that id returns the same receipt. A retry
  after an interrupted attempt converges instead of failing on leftover state.
* `backup.cancelPortable` records a cancel request durably. The restore checks
  it at every persistent boundary and rolls back if it was requested;
  a request against a finished operation returns the final receipt.
* `backup_recover` converges interrupted restores at startup and removes
  staging areas and markers left by finished ones, re-verifying ownership first.

* A fresh installation may restore into its own data directory, but only when
  every registered table is empty.
* Any other target must be a separate empty directory that does not overlap the
  running data directory.
* The source data directory of the archive is never opened. A restore that has
  to read the original directory would defeat the purpose of a portable backup.
* Git history is recreated with `hash-object -w` and `update-ref`. Every
  recomputed object id is compared with the archived one, so the restored
  history is the archived history.
* Every registered table must be present in the archive. An archive made by a
  build with fewer tables is refused with `BACKUP_SCHEMA_MISMATCH` instead of
  silently wiping the tables it does not know.
* The receipt reports `rebuildRequired`: the build ids that were restored as
  metadata but whose derived build copies were deliberately not shipped.

## 6. Backup protection references

`craftmine_backup_pins` is durable and R5-owned. One row per protected
reference:

```
archive_id, kind, ref, world_id, status, archive_hash, archive_path,
created_at, updated_at
```

* `status` is `streaming` (in flight), `retained` (archive completed) or
  `abandoned`/`released`.
* Kinds: `build`, `godot-source-blob`, `godot-asset-body`, `asset-blob`,
  `git-ref` (`repoId|refName|oid`, carrying the repository's world),
  `legacy-import`, `repository`.
* `backup.protected-refs` returns the live set. The core aggregates the `build`
  pins itself when it plans a build reclaim, so a caller that omits
  `godotStorage.reclaimPlan.protectedBuilds` cannot unprotect an archived build;
  `sourceBlobs` / `gitRefs` are consumed by the content and asset reclaimer
  through the same call, and R6 consults `assetBlobs` / `godotAssetBodies`.
  Caller pins remain additive. There is no third deletion path.
* Startup recovery (`backup_recover`) retains a `streaming` pin only when its
  export job completed or its `archive_path` still holds a file; it abandons a
  `retained` pin whose archive disappeared. No age or mtime heuristic is used
  anywhere.
* If the export process dies between publishing the archive file and writing
  the completion row, the pins stay `streaming`; recovery promotes them because
  the archive is present, so a complete archive is never left unprotected.

## 7. Failure behaviour

| condition | result |
| --- | --- |
| missing body, changed bytes, changed size | `BACKUP_CONTENT_MISSING` / `BACKUP_CONTENT_CHANGED` at export; `BACKUP_HASH_MISMATCH` at verify/restore |
| truncated or trailing bytes | `BACKUP_ARCHIVE_TRUNCATED` / `BACKUP_ARCHIVE_TRAILING_BYTES` |
| duplicate entry path | `BACKUP_DUPLICATE_ENTRY` |
| entry path outside its kind's root, traversal, absolute or drive-letter path | `INVALID_ARCHIVE_PATH` |
| edited header or entry table | `BACKUP_HASH_MISMATCH` |
| domain hash not bound to the header | `BACKUP_DOMAIN_HASH_MISMATCH` |
| archive lacks a registered table, or a column | `BACKUP_SCHEMA_MISMATCH` / `BACKUP_COLUMNS_MISMATCH` |
| restored rows violate a foreign key or the ledger | `BACKUP_FOREIGN_KEY_FAILURE` etc., transaction rolled back |
| target not empty, or a live world would be overwritten | `BACKUP_TARGET_NOT_EMPTY` |
| target overlaps the running data directory | `BACKUP_TARGET_OVERLAP` |
| archive inside the data directory | `BACKUP_ARCHIVE_INSIDE_DATA_DIR` |
| entry count or declared size over the cap | `BACKUP_ENTRY_COUNT_LIMIT` / `BACKUP_ARCHIVE_TOO_LARGE` |
| disk full / interrupted export | `.partial` file removed, pins abandoned, job marked `failed` |
| Git object disappeared between snapshot and read | export fails loudly (`BACKUP_GIT_OBJECT_MISSING`) |

A failed export or restore never leaves a row that claims success. A failed
restore never leaves content or a database behind that a later retry would have
to work around.
