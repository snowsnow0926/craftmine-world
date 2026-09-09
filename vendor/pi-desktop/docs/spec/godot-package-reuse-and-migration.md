# Godot package reuse, migration and complete backup

Status: implemented in `codex/godot-remaining-h-20260910`.
Owner: task `godot-remaining-20260910-H`.

This spec covers the installable package contract, cross-world instances,
declarative upgrades, the complete backup boundary and the legacy conversion
copy. It does not grant execution isolation and does not make a package
runnable; only the managed build/apply path does that.

## 1 Storage split

- `craftmine_library` remains the single immutable content store.
- `craftmine_packages` records the install contract for an exact library ref:
  kind, name, state version, compatibility, dependencies, parts, initial state
  and migration. It never duplicates content.
- `craftmine_package_instances` records one installed instance per world:
  package ref, manifest, state, state version, status, revision, origin.
- `craftmine_package_operations`, `craftmine_package_instance_operations` and
  `craftmine_legacy_conversions` hold replay receipts.

## 2 Manifest `craftmine.package/1`

Required fields: `format`, `ref` (exact `{id,version,hash}`), `kind`
(`creation|object|gameplay|component|scene`), `name`, `stateVersion`,
`compatibility`, `dependencies`, `parts`, `initialState`, `migration`.

- `compatibility` = `{base, baseVersion, engine, stateFormat, sceneFormat}`.
  `base`/`engine`/`stateFormat`/`sceneFormat` must equal the target world's
  persisted values; `baseVersion` is a dotted numeric requirement that the
  world must meet.
- `dependencies` are exact refs with an optional flag. A missing optional
  dependency is skipped; a missing required dependency fails the resolution.
- `parts` lists `scene`/`source` files by relative path and hash, and
  `assets`/`components` by id/version/hash. Rebuildable caches are not parts.
- `initialState` is `craftmine.package-state/1`:
  `{format, version, entities:{objects,behaviors,systems}, fields, once}`.

Registration is a declaration only. The closure and compatibility are resolved
when a package is checked, installed or upgraded, so a set of packages can be
registered in any order and a cycle is reported at use:
`PACKAGE_DEPENDENCY_CYCLE: a@1 -> b@2 -> a@1`.

## 3 Fixed version

Resolution uses only the exact `{id,version,hash}` in `ref`. There is no
"latest" lookup: a missing version fails with `PACKAGE_VERSION_NOT_FOUND: id@v`
and never falls back to another version of the same id. A dependency whose
declared hash differs from the registered hash fails with
`PACKAGE_DEPENDENCY_HASH_MISMATCH`.

## 4 Instances

- Every install allocates a new identity `ins-<24 hex>` derived from the
  `operationId`, so a replay is stable and two installs never share identity.
- `mode:"initial"` copies `initialState`; `mode:"copy"` requires a source
  instance and records `origin:{instanceId,worldId}`. The copy migrates the
  source state when the package id matches and the state versions differ.
- Instance state is per row, so two worlds reusing the same fixed version keep
  independent progress and one-time reward ledgers.
- Install and export never carry host sessions, credentials or world progress.
  Export results state `credentialsIncluded:false`, `sessionIncluded:false`
  and `progressIncluded:false`, and an export that would contain a private
  key is refused with `PACKAGE_EXPORT_CONTAINS_PRIVATE_DATA`.

## 5 Upgrade, uninstall, recovery

Migration is declarative and runs on instance state only:

| op | effect |
| --- | --- |
| `rename` | rename an entity in `objects`/`behaviors`/`systems` |
| `add` | add an entity with an exact value (existing equal value is a no-op) |
| `remove` | remove an entity only when it equals `expected` |
| `renameField` / `addField` / `removeField` | same for scalar fields |
| `preserve` | assert the one-time ledger `once` survives |

- A missing path fails with `PACKAGE_MIGRATION_MISSING: from -> to`.
- A removal whose live value differs from `expected` fails with
  `PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS: <path>`. The instance is never reset
  to its initial state automatically.
- A failed upgrade rolls back: the instance keeps its previous package version,
  state and revision.
- `package.grant` is idempotent per key, so a reward cannot be paid twice
  across an upgrade.
- Uninstall only changes `status`; state is retained and `package.restore`
  reverses it. A vanished version fails with `PACKAGE_VERSION_UNAVAILABLE`
  instead of downgrading.

## 6 Complete backup `craftmine.complete-backup/1`

`backup.export-full` produces:

- `domain`: the existing `craftmine.domain-backup/1` snapshot.
- `content`: manifest and per-file hashes of the non-rebuildable bytes that do
  not live in the domain tables (sealed legacy archives), plus the registered
  packages that must still resolve to immutable library content.
- `rebuildable`: named caches (`godot-import-cache`, `godot-build-artifacts`,
  `godot-export-artifacts`) with `excluded:true` and a reason. They are not
  copied into the archive.
- `provenance`: domain hash and a `credentialsIncluded:false` marker.

`backup.verify` reports `missing`, `mismatched`, `pathEscapes`, `verified` and
`rebuildable`; any missing, mismatched or escaping entry makes `valid:false`.
`backup.restore-full` verifies content first and only then runs the atomic
domain restore, so an incomplete backup cannot half-restore a profile.
Archives written before the package tables existed are padded with the live
column list, so the domain schema version stays 3.

## 7 Legacy conversion

`legacy.convert` always creates a copy world `legacy-<12 hex>` and re-hashes the
sealed archive before and after the copy; `sourceUnchanged:true` is reported.
Without a trusted `compiled` document the copy keeps the legacy base. The
report classifies every content type:

- supported: geometry/layout/collision, gameplay system configuration,
  PNG/JPEG/static GLB, progress values when the state version is known.
- needsReview: unknown asset formats, progress without an explicit state
  version, session/requirement/memory ownership that must be rebound.
- unsupported: animated or skinned GLB, glTF/FBX/MP3, legacy JavaScript
  gameplay which stays on the legacy base.

A corrupt archive, hash mismatch or path escape fails before any world is
created (`CORRUPT_LEGACY_ARCHIVE`, `INVALID_ARCHIVE_PATH`).

## 8 Error codes

`PACKAGE_VERSION_NOT_FOUND`, `PACKAGE_DEPENDENCY_MISSING`,
`PACKAGE_DEPENDENCY_CYCLE`, `PACKAGE_DEPENDENCY_HASH_MISMATCH`,
`PACKAGE_VERSION_CONFLICT`, `PACKAGE_INCOMPATIBLE_BASE`,
`PACKAGE_INCOMPATIBLE_BASE_VERSION`, `PACKAGE_INCOMPATIBLE_ENGINE`,
`PACKAGE_INCOMPATIBLE_STATE_FORMAT`, `PACKAGE_INCOMPATIBLE_SCENE_FORMAT`,
`PACKAGE_MIGRATION_MISSING`, `PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS`,
`PACKAGE_MIGRATION_TARGET_EXISTS`, `PACKAGE_DOWNGRADE_UNSUPPORTED`,
`PACKAGE_UPGRADE_KIND_MISMATCH`, `PACKAGE_VERSION_UNAVAILABLE`,
`PACKAGE_INSTANCE_REVISION_CONFLICT`, `PACKAGE_INSTANCE_UNINSTALLED`,
`PACKAGE_SOURCE_INCOMPATIBLE`, `PACKAGE_EXPORT_CONTAINS_PRIVATE_DATA`,
`WORK_PACKAGE_CONTENT_HASH_MISMATCH`, `BACKUP_HASH_MISMATCH`,
`BACKUP_VERSION_UNSUPPORTED`, `BACKUP_CONTENT_INCOMPLETE`, `BACKUP_TOO_LARGE`,
`LEGACY_COPY_EXISTS`, `LEGACY_SNAPSHOT_REQUIRED`, `CORRUPT_LEGACY_ARCHIVE`,
`REPLAY_MISMATCH`, `IMMUTABLE_VERSION_CONFLICT`.

The player-facing Chinese text for these codes lives in
`plugins/craftmine-world/reuse-service.mjs` (`explain`), not in the host.
