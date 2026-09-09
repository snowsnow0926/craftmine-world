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
ENTRY             per entry: one JSON line, then exactly `bytes` raw bytes
FOOTER            one JSON line
```

* `HEADER.entries` lists every entry in advance: `path`, `kind`, `owner`,
  `world`, `bytes`, `sha256`, `refs`, `repoId`, `objectFormat`, `oid`,
  `objectType`, `body`. A caller can therefore verify an archive without
  interpreting any body.
* `HEADER.consistency` records the common boundary: the domain snapshot hash,
  the table count, the content roots, per-category reference counts and an
  explicit `credentialsIncluded:false` / `sessionIncluded:false`.
* `HEADER.rebuildable` names every cache that is deliberately **not** shipped
  (`godot-import-cache`, `godot-build-artifacts`, `godot-build-cache`,
  `content-repo-copies`, `git-config`) with a reason.
* `FOOTER` carries `entries`, `contentBytes` and `archiveHash`, where
  `archiveHash` is the SHA-256 of the serialized header. Every body is verified
  against its own `sha256` while streaming.

There is no total-size JSON limit. Streaming caps apply per body
(`ENTRY_LIMIT` 4 GiB), for the domain snapshot (`DOMAIN_LIMIT` 1 GiB) and for
one metadata line (`LINE_LIMIT` 8 MiB).

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
into place; the domain is applied last, in one transaction, and validated
(`validate_integrity`). A failure removes the staging directory and leaves the
target as it was.

* A fresh installation may restore into its own data directory, but only when
  that installation holds no worlds, tasks, imports, revisions, asset versions,
  repositories, library entries or packages.
* Any other target must be a separate empty directory that does not overlap the
  running data directory.
* The source data directory of the archive is never opened. A restore that has
  to read the original directory would defeat the purpose of a portable backup.
* Git history is recreated with `hash-object -w` and `update-ref`. Every
  recomputed object id is compared with the archived one, so the restored
  history is the archived history.
* The receipt reports `rebuildRequired`: the build ids that were restored as
  metadata but whose derived build copies were deliberately not shipped.

## 6. Backup protection references

`craftmine_backup_pins` is durable and R5-owned. One row per protected
reference:

```
archive_id, kind, ref, world_id, status, archive_hash, created_at, updated_at
```

* `status` is `streaming` (in flight), `retained` (archive completed) or
  `abandoned`/`released`.
* Kinds: `build`, `godot-source-blob`, `godot-asset-body`, `asset-blob`,
  `git-ref` (`repoId|refName|oid`), `legacy-import`, `repository`.
* `backup.protected-refs` returns the live set. R1 feeds `builds` into
  `godotStorage.reclaimPlan.protectedBuilds` and consults `sourceBlobs` /
  `gitRefs` in its own reclaimer; R6 consults `assetBlobs` /
  `godotAssetBodies`. There is no third deletion path.
* Startup recovery (`backup_recover`) promotes a `streaming` pin to `retained`
  only when its export job completed, and abandons it otherwise. No age or
  mtime heuristic is used anywhere.

## 7. Failure behaviour

| condition | result |
| --- | --- |
| missing body, changed bytes, changed size | `BACKUP_CONTENT_MISSING` / `BACKUP_CONTENT_CHANGED` at export; `BACKUP_HASH_MISMATCH` at verify/restore |
| truncated or trailing bytes | `BACKUP_ARCHIVE_TRUNCATED` / `BACKUP_ARCHIVE_TRAILING_BYTES` |
| duplicate or escaping entry path | `BACKUP_DUPLICATE_ENTRY` / `INVALID_ARCHIVE_PATH` |
| target not empty, or a live world would be overwritten | `BACKUP_TARGET_NOT_EMPTY` |
| target overlaps the running data directory | `BACKUP_TARGET_OVERLAP` |
| archive inside the data directory | `BACKUP_ARCHIVE_INSIDE_DATA_DIR` |
| disk full / interrupted export | `.partial` file removed, pins abandoned, job marked `failed` |
| Git object disappeared between snapshot and read | export fails loudly (`BACKUP_GIT_OBJECT_MISSING`) |

A failed export or restore never leaves a row that claims success.
