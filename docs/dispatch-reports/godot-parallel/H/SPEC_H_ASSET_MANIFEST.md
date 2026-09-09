# Spec: base asset provenance manifest (`craftmine.base-assets/1`)

Status: implemented in `desktop/delivery/base-assets/*.json`, enforced by
`desktop/delivery/preflight.mjs assets`. Owner: task H.

## 1 Purpose

Every file that ships inside the client or inside a player-exported game must have a
traceable origin, author, version, licence and redistribution condition. The manifest
is the machine-readable record; the preflight refuses to pass when the record and the
bytes disagree.

## 2 File layout

One JSON file per base in `desktop/delivery/base-assets/`. The file name is
informational; `baseId` is authoritative.

```json
{
  "format": "craftmine.base-assets/1",
  "baseId": "first-person",
  "displayName": "3D first-person base (fixed GD0 probe)",
  "baseVersion": "0.1.0",
  "engine": {"version": "4.7.2-stable", "renderer": "gl_compatibility", "language": "GDScript"},
  "sourceDirectory": "desktop/godot/probes/first-person",
  "reviewedCommit": "46739d222ceefc654b596725c96288a4087993b3",
  "reviewedAt": "2026-09-09",
  "entries": [],
  "externalEntries": [],
  "requiredNotices": []
}
```

## 3 Entry fields

| Field | Required | Meaning |
| --- | --- | --- |
| `path` | yes | Relative to `sourceDirectory` for `entries`; repository-relative for `externalEntries` |
| `role` | yes | `source`, `scene`, `config`, `asset`, `bridge`, `shell`, `notice`, `font` |
| `origin` | yes | `authored`, `godot-engine`, `third-party`, `user-imported` |
| `author` | yes | Copyright holder or author string |
| `version` | yes | Version of the file/asset, not of the base |
| `license` | yes | SPDX-style identifier, or `project-authored` for project-owned files |
| `licenseFile` | when the licence requires a notice | Repository-relative notice text |
| `redistribution` | yes | See section 4 |
| `distribution` | yes | Non-empty subset of section 5 |
| `bytes`, `sha256` | yes | Pinned size and digest of the exact shipped bytes |
| `outstanding` | for `project-authored` without `licenseDocument` | Explicit reason why no licence text is attached yet |
| `conditions` | for `redistribution: conditional` | The conditions that must be met |
| `notes` | optional | Free-form context |

## 4 Redistribution values

`permitted`, `permitted-with-notice`, `permitted-with-notice-and-corresponding-source`,
`conditional` (requires `conditions`), `denied`, `unreviewed`.

Rules:

- An entry with `distribution` containing `app-bundle` or `user-export` must not be
  `denied` or `unreviewed`.
- `user-export` plus `denied` is always a failure (`ASSET_EXPORT_DENIED`).
- Any shipped entry whose licence is not `project-authored`, `public-domain`,
  `CC0-1.0` or `Unlicense` must point at an existing `licenseFile`.

## 5 Distribution values

| Value | Meaning |
| --- | --- |
| `app-bundle` | Distributed inside the client installation |
| `user-export` | May be included in a player-exported standalone game |
| `development-only` | Test or development infrastructure; must never ship or export |

An entry may carry several values. `development-only` must not be combined with a
shipping value in practice; if it is, the preflight still treats the shipping values
as authoritative.

## 6 `requiredNotices`

Each item is `{path, sha256, appliesTo, notes}` and points at a notice that must be
present with the pinned bytes. Every base currently requires the two Godot notices
for `user-export`, because `desktop/godot/export-probes.mjs` copies
`desktop/godot/licenses/` into the export.

## 7 Engine pin

`engine.version` must equal `desktop/godot/toolchain.lock.json.version`. A base that
targets another engine fails `ASSET_ENGINE_MISMATCH` until the lock is deliberately
changed by the owning task.

## 8 Maintenance

Hashes are pinned at `reviewedCommit`. When base sources change:

1. Re-review provenance (origin, author, licence, redistribution).
2. Update `bytes`, `sha256`, `reviewedCommit` and `reviewedAt` in the same commit.
3. Run `node desktop/delivery/preflight.mjs assets`.

The preflight is read-only and intentionally offers no auto-refresh command: blessing
new bytes must be a reviewed change, not a side effect of running a tool.

## 9 Failure codes

`ASSET_FORMAT`, `ASSET_BASE_ID`, `ASSET_SOURCE_DIRECTORY`, `ASSET_SOURCE_MISSING`,
`ASSET_ENGINE_MISMATCH`, `ASSET_FIELD_MISSING`, `ASSET_DISTRIBUTION`,
`ASSET_REDISTRIBUTION`, `ASSET_REDISTRIBUTION_DENIED`, `ASSET_CONDITIONS_MISSING`,
`ASSET_LICENSE_UNKNOWN`, `ASSET_LICENSE_FILE_MISSING`, `ASSET_AUTHORED_LICENSE_UNDECLARED`,
`ASSET_EXPORT_DENIED`, `ASSET_FILE_MISSING`, `ASSET_BYTES_MISMATCH`,
`ASSET_HASH_MISMATCH`, `ASSET_DUPLICATE`, `ASSET_UNDECLARED_FILE`,
`ASSET_NOTICE_MISSING`, `ASSET_NOTICE_BYTES_MISMATCH`, `ASSET_NOTICE_HASH_MISMATCH`.
