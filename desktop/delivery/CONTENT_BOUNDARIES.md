# Content boundaries: client, share package, backup and standalone game

Four artefacts are easy to confuse and must not be mixed. `content-boundaries.json` is
the machine-readable declaration; `content-boundary-check.mjs` checks a real directory
or archive against one boundary.

```powershell
node desktop/delivery/content-boundary-check.mjs --boundary client --path <win-unpacked>
node desktop/delivery/content-boundary-check.mjs --boundary share-package --path <pkg.zip>
node desktop/delivery/content-boundary-check.mjs --boundary portable-backup --path <archive>
node desktop/delivery/content-boundary-check.mjs --boundary standalone-game --path <export>
```

Exit codes: `0` pass, `1` violation, `3` boundary declared but not implemented.

## 1 Client install (`client`)

Contains the Electron client, `resources/app.asar`, the two native executables, the
agent runtime bundle, the world plugin, the pinned Git tree (`resources/git/**`), the
licence directory and the corresponding-source material.

Must never contain repository internals, `node_modules`, test evidence, `.env` or
credential stores, Chromium cache/profile data, user world data, debug symbols, logs,
or R1's managed `git-config`.

Required notices: `resources/licenses/PI-Desktop-LICENSE.txt`,
`resources/licenses/CRAFTMINE-NOTICES.md`, `resources/licenses/UPSTREAM.json`,
`resources/git/LICENSE.txt`, `resources/git/GIT-BUNDLE.json`. The full required-file
list is `PACKAGE_REQUIRED_FILES` in `desktop/delivery/lib/preflight-core.mjs`.

## 2 Creation-share package (`share-package`)

Format `craftmine.package/1`, a ZIP with `package.json`, `resources/<contentHash>/`
(`manifest.json` plus `payload/`), `catalog.json` and optional `previews/`. It is
self-contained: root resource, dependency manifests, payload bytes and licence files
are all inside the archive.

Must never contain credentials, host sessions, world progress, rebuildable build
caches, `.git` or `git-config`. R4's export reports `credentialsIncluded:false` and
`sessionIncluded:false`; the checker enforces the path rules on the real ZIP entry
list (read from the central directory, no decompression).

## 3 Full portable backup (`portable-backup`)

Format `craftmine.portable-archive/1`: one streamed file, magic
`CRAFTMINE-PORTABLE-ARCHIVE/1`, then a header line, entry lines and raw bodies. Roots:
`domain.json`, `legacy-imports/`, `godot-source/`, `godot-assets/`,
`asset-catalog/blobs/`, `content-history/repos/`.

Excluded by the producer: rebuildable `godot-builds/<worldKey>/<buildId>/{source,artifacts,cache}`,
`content-history/repos/<repoKey>/copies`, `git-config`, and the operational tables
`craftmine_backup_jobs` / `craftmine_backup_pins`. `credentialsIncluded` is `false`.

`sessionRowsIncluded` is `true`: the archive can contain text the user pasted into
tasks. It is a full backup, not a shareable redacted diagnostic.

The checker reads the magic and header only; it does not stream every entry. That limit
is reported, not hidden.

## 4 Standalone Windows game (`standalone-game`)

**Declared but not implemented.** No output layout exists in the R4/R5/R6 trees, and
R4 records CP4 as not started. The boundary states what an export must not contain
(credentials, creation history, `app.asar`) and which notices must travel
(`licenses/GODOT_LICENSE.txt`, `licenses/GODOT_COPYRIGHT.txt`,
`licenses/EXPORT-NOTICES.md`), so the first real export can be checked against it.

`content-boundary-check.mjs --boundary standalone-game` therefore exits `3`, never `0`,
until a real export layout exists and is verified.

## Source of the facts

- Client: `desktop/delivery/README.md`, `desktop/delivery/lib/preflight-core.mjs`,
  `desktop/delivery/git-bundle.json`.
- Share package: `vendor/pi-desktop/docs/spec/godot-creation-package.md:13-27,122`,
  `vendor/pi-desktop/docs/spec/godot-package-reuse-and-migration.md:61-62,99`,
  `plugins/craftmine-world/package-zip.mjs:664,794`.
- Portable backup: `vendor/pi-desktop/docs/spec/godot-portable-archive.md:1,§2,§5`,
  `vendor/pi-desktop/crates/craftmine-core/src/backups/portable.rs:41-58,723,783,1087`.
- Standalone game: `docs/dispatch-prompts/godot-round2-20260910/R9-fixed-package-and-rights.md:36`
  (requirement only; no layout exists).
