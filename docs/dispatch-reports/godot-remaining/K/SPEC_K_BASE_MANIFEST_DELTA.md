# Spec delta: shipped-base provenance manifests (task K, 2026-09-10)

This document extends `docs/dispatch-reports/godot-parallel/H/SPEC_H_ASSET_MANIFEST.md`
without editing that file (it belongs to task H). Format, entry fields, redistribution
values and failure codes from H stay in force; the following are additions made while
repairing the eight delivery-preflight failures recorded in `docs/GODOT_CYCLE_05.md`.

## 1 New manifest scope: shipped base directories

`base-assets/` now holds two scopes of `craftmine.base-assets/1` manifests:

| Files | `sourceDirectory` | Purpose |
| --- | --- | --- |
| `first-person.json`, `top-down.json`, `shared-web.json` | `desktop/godot/probes/*`, `desktop/godot/web` | fixed GD0 probe projects, shared Web bridge, host runtime |
| `bases-first-person.json`, `bases-side-view.json`, `bases-top-down.json` | `desktop/godot/bases/*` | every file of a shipped base directory |

The shipped-base manifests add `provenanceScope: "shipped-base-directory"` so a reader
cannot confuse them with the probe manifests that share the same `baseId`.

## 2 New entry field

`targetLicense` (string, optional) records the intended licence from
`docs/LICENSING_STRATEGY.md` while the formal application is still open. It is
documentation only: the preflight does not treat it as an applied licence, and an entry
whose rights are not applied must still carry `outstanding` or `licenseDocument`.

## 3 New manifest fields

| Field | Meaning |
| --- | --- |
| `rightsStatus` | `pending-formal-application` or `applied`. Any other value is reported as pending. |
| `rightsNote` | One-sentence explanation of what is still open. |
| `rightsDocument` | Repository-relative rights statement, e.g. `base-assets/rights/first-person.md`. |

## 4 New preflight behaviour

- `ASSET_RIGHTS_PENDING` (warning): emitted once per manifest whose `rightsStatus` is
  not `applied`. The warning quotes `rightsDocument` and `rightsNote`, so the pending
  state stays visible in every preflight record and never turns into a silent pass.
- `ASSET_LICENSE_DOCUMENT_MISSING` (failure): an entry that names `licenseDocument`
  must resolve to an existing file relative to the repository root. A rights claim may
  not point at a missing document.

Both codes are additive; no existing code changed meaning and no assertion was
relaxed. `desktop/delivery/preflight-selftest.mjs` still passes all 35 cases.

## 5 Drafting tool (never blesses bytes)

`desktop/delivery/tools/draft-base-manifest.mjs`

```powershell
node desktop/delivery/tools/draft-base-manifest.mjs --all --out-dir <dir>   # draft only
node desktop/delivery/tools/draft-base-manifest.mjs --check                 # drift report
```

- `--out` / `--out-dir` write a draft to an explicit path. The tool never writes into
  `desktop/delivery/base-assets/` unless the caller names that directory, and the draft
  still requires a human to review `origin`, `author`, `license`, `redistribution`,
  `distribution` and `targetLicense` before committing.
- `--check` compares the committed manifests with the current tree and exits non-zero
  on drift. It writes nothing, so accepting new bytes stays a reviewed change.

## 6 Rights classification used by the current manifests

All 247 files under the three shipped bases are project-authored or project-generated
(no third-party asset is present; see each base's provenance document).

| Content | `license` | `targetLicense` | `distribution` |
| --- | --- | --- | --- |
| first-person `assets/meshes/*`, `assets/materials/*`, `icon.svg` | `MIT` + `licenses/ORIGINAL_ASSETS_LICENSE.txt` | MIT (applied) | `app-bundle`, `user-export` |
| base runtime (scripts, scenes, resources, world data, project config) | `project-authored` | MIT (export runtime, pending) | `app-bundle`, `user-export` |
| base `tests/`, `tools/`, `*.md`, `.gitignore`, `.gitattributes` | `project-authored` | AGPL-3.0-only or commercial (pending) | `development-only` |
| Godot-generated `.uid` sidecars | `project-authored`, `origin: generated` | same as the adjacent file | `app-bundle`, `user-export` |

`desktop/delivery/base-assets/rights/{first-person,side-view,top-down}.md` are the
rights statements referenced by `licenseDocument`. They state authorship and the open
questions; they are not licence texts and grant nothing.

## 7 Out of scope for this delta

- No licence header was added to any source file and no package metadata licence field
  was changed.
- The per-module inventory, official licence texts, notices, offline entry, commercial
  and CLA drafts live under `desktop/delivery/licensing/` (separate deliverable).
- A17 installer lifecycle remains unverified: no isolated Windows machine was used.
