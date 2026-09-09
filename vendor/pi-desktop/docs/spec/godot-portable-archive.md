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
4. Git objects are read with `rev-list --objects --all` + `cat-file --batch`
   from the snapshot's references, so the object set is exactly the reachable
   set at that boundary.
5. The archive is renamed into place and the job row and pins are marked
   completed in a second transaction.

## 5. Restore

`backup.restore-portable` writes nothing into the target until the whole stream
has verified. Bodies are staged under `<target>/.portable-staging-*`, then moved
into place; the domain rows are written inside one transaction that is committed
only after every body is in place, every repository is materialized and
`validate_integrity` passed. Any failure rolls the transaction back, deletes the
bodies it had already moved, deletes a database file this restore created, and
removes the staging directory.

* A fresh installation may restore into its own data directory, but only when
  every registered table is empty.
* Any other target must be a separate empty directory that does not overlap the
  running data directory. A stale `.portable-staging-*` left by a crashed
  restore is removed; any other entry makes the target non-empty.
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
  There is no third deletion path.
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
