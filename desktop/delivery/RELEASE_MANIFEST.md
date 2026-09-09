# Reproducible release manifest + package verification

Tooling: `desktop/delivery/release-manifest.mjs` (CLI) over
`desktop/delivery/lib/release-manifest-core.mjs` (logic). No third-party
dependencies, no network, no GUI, no window activation, no input, no write inside
an inspected tree. The preflight core
(`desktop/delivery/lib/preflight-core.mjs`) is reused for the packaged-file list
(`PACKAGE_REQUIRED_FILES`), the engine cache check (`checkGodotCache`) and the
toolchain lock (`loadLock`).

## The one rule

**A passing development build is not a verified package.** `verify` requires
`--package <dir>`; if the directory is a source tree (`package.json` plus
`desktop/`/`vendor/` and no `Craftmine World.exe`) it fails with
`PACKAGE_IS_DEV_DIRECTORY`, and it lists every required file that is absent.
`create` without `--package` produces a manifest whose build outputs are
*unpinned*; `verify` then fails closed with `PACKAGE_FILE_UNPINNED` rather than
pretending those bytes were checked.

## Commands

```powershell
# Pin a manifest from a repository root (read-only).
node desktop/delivery/release-manifest.mjs create --root . --out build/release-manifest.json

# Optionally hash the shared engine cache and record package-snapshot pins.
node desktop/delivery/release-manifest.mjs create --root . --out out.json `
  --cache "D:\Craftmine World\desktop\build\godot\4.7.2-stable" `
  --package "D:\Craftmine World\desktop\build\windows-preview-batch-07"

# Assert a built package matches the manifest (read-only).
node desktop/delivery/release-manifest.mjs verify `
  --manifest out.json --package "D:\Craftmine World\desktop\build\windows-preview-batch-07"

# Compare two manifests.
node desktop/delivery/release-manifest.mjs diff --manifest a.json --manifest b.json
```

Flags: `--json` prints the machine-readable record, `--quiet` prints only
problems, `--evidence <file>` writes the full JSON record, `--strict-extra`
makes undeclared package files fatal, `--probe-binaries` lets `create` read
native broker `--version` output (off by default so no host binary is started).
Exit codes: `0` success, `1` verification/diff failure, `2` usage error.

## Manifest schema (`craftmine.release-manifest/1`)

```jsonc
{
  "format": "craftmine.release-manifest/1",
  "generatedAt": "<ISO-8601>",
  "identity": {                    // who produced the bytes
    "commit": "<full git oid|null>",
    "shortCommit": "<short oid|null>",
    "commitDate": "<%cI|null>",
    "dirty": true,                 // git status --porcelain was non-empty
    "clientVersion": "0.8.0",      // package.json version
    "productName": "craftmine-world"
  },
  "components": {                  // every entry: {id, version|null, source, files, status, notes}
    "client": {...},
    "engine": {...},
    "exportTemplates": {...},
    "broker": {...},
    "bases": {"first-person": {...}, "side-view": {...}, "top-down": {...}},
    "bridge": {...},
    "dependencies": {...},
    "licenses": {...},
    "tooling": {"m": {...}, "n": {...}}
  },
  "totals": {"files": 0, "bytes": 0, "presentFiles": 0, "presentBytes": 0,
             "pinnedOnlyFiles": 0, "pinnedOnlyBytes": 0, "note": "..."},
  "reproducibility": {"pinnedInputs": [...], "limits": [...]}
}
```

`source` is `{path|url, commit|tag|null}`. `files[]` entries are
`{path, bytes, sha256, present, role, pinnedFrom?, packagePath?, ...}`; `bytes`
is `null` when the lock pins no byte count. `status` is one of:

| status | meaning |
| --- | --- |
| `verified` | every input this component pins was read and hashed (or is pinned by a lock file that was read). |
| `pending-integration` | planned by a document but not present in the worktree; `files` is empty and **no hash exists**. |
| `absent` | the expected input is missing and is not a planned deliverable. |

`totals.files`/`totals.bytes` count unique paths across all components;
`pinnedOnly*` counts lock-pinned inputs that live in the shared engine cache or
as build outputs rather than in the repository.

## Components and their pinning source

| component | what is pinned | pinning source |
| --- | --- | --- |
| `client` | `package.json`; `desktop/windows-USER_GUIDE.zh-CN.md` → `resources/source/USER_GUIDE.zh-CN.md`; `desktop/windows-upgrade-guard.ps1` → `resources/source/windows-upgrade-guard.ps1` | bytes+sha256 of each file; git identity |
| `engine` | version, release URL, editor archive bytes+sha256, executable sha256 | `desktop/godot/toolchain.lock.json` (never re-derived from a download) |
| `exportTemplates` | tpz bytes+sha256, `templates/web_release.zip` (threaded, preferred) and `templates/web_nothreads_release.zip` bytes+sha256 | `desktop/godot/toolchain.lock.json` |
| `broker` | `vendor/pi-desktop/target/release/pi-desktop-host-core.exe`, `craftmine-core.exe`: bytes+sha256; `--version` first line only with `--probe-binaries` | hashed in place; expected package paths `resources/bin/*.exe` |
| `bases` | per base: `baseId`, `baseVersion`, `engine`, every file (repository-relative path, bytes, sha256), `fileCount`, `aggregateSha256`, and the delivery provenance manifest | `desktop/godot/bases/<id>/base_manifest.json` or `manifest.json`; `desktop/delivery/base-assets/<id>.json` |
| `bridge` | `desktop/godot/web/bridge.js`, `desktop/godot/web/shell.html`, `desktop/godot/probes/shared/web_bridge.gd`: bytes+sha256 | hashed in place |
| `dependencies` | every `pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock` found by a bounded scan (generated directories skipped): bytes+sha256; `node`/`npm`/`pnpm`/`cargo`/`rustc` versions | hashed in place; read-only `--version` |
| `licenses` | `desktop/godot/licenses/**`, `desktop/UPSTREAM.json` → `resources/licenses/UPSTREAM.json`, `desktop/windows-NOTICES.md` → `resources/licenses/CRAFTMINE-NOTICES.md`, `vendor/pi-desktop/LICENSE` → `resources/licenses/PI-Desktop-LICENSE.txt` | bytes+sha256 of each file |
| `tooling.m` | nothing: VM0–VM4 version management (config isolation, managed Git, source history/diff/recovery) is not in this worktree | `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md`, `docs/dispatch-prompts/godot-remaining-20260910/M-git-content-history.md` |
| `tooling.n` | nothing: AL0–AL5 asset library, search, preview and full dependency list are not in this worktree | `docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md`, `docs/dispatch-prompts/godot-remaining-20260910/N-assets-and-previews.md` |

Base file paths are repository-relative (so `totals` never collapses two bases);
`aggregateSha256` is the SHA-256 of the sorted `path\0bytes\0sha256\n` stream, so
it is stable across machines and independent of directory iteration order.

### Pending integration (no hash, by design)

Each `expectedPaths[]` entry is exactly
`{status: "pending-integration", expectedPath, source, owner}`:

* M: `vendor/pi-desktop/crates/craftmine-core/src/content_history/`,
  `craftmine.assets.lock.json` (`craftmine.assets-lock/1`), `tests/godot-remaining/M/`,
  `docs/dispatch-reports/godot-remaining/M/`.
* N: `vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/`,
  `craftmine.assets.lock.json`, `tests/godot-remaining/N/`,
  `docs/dispatch-reports/godot-remaining/N/`.

None of these paths exists in this worktree, so the manifest records them as
planned and carries **no hash**. A pending component never counts as `verified`
and is never treated as a package file.

## Package verification semantics

`verify --manifest <file> --package <dir>` walks the package without following
links and produces `craftmine.package-verification/1`:

| bucket | meaning | fatal |
| --- | --- | --- |
| `missing` | required file absent from the package (`PACKAGE_FILE_MISSING`) | yes |
| `mismatch` | required file present but bytes/sha256 differ from an independent pin (`PACKAGE_FILE_MISMATCH`) | yes |
| `unpinned` | required file present but the manifest carries no sha256 for it (`PACKAGE_FILE_UNPINNED`) | yes |
| `forbidden` | dev/test/credential artifact inside the package (`PACKAGE_FORBIDDEN_ARTIFACT`) | yes |
| `links` | symlink/junction inside the package (`PACKAGE_LINK_DENIED`) | yes |
| `extra` | files not declared by the manifest | no (fatal with `--strict-extra`) |
| `optionalForbidden` | `*.pdb` debug symbols | no (warning) |
| `selfAttestation` | the package's own `resources/source/build-manifest.json` artifacts re-hashed | mismatch is fatal; a match is self-attestation, never an independent pin |
| `pendingComponents` | pending-integration tooling entries, reported and excluded | n/a |

Required files are `preflight-core` `PACKAGE_REQUIRED_FILES` plus every manifest
file that declares a `packagePath`. Build-machine artifact paths map to package
paths exactly as `checkPackage()` does (the five `artifactMap` entries, then a
unique-basename fallback for the self-attestation check). Forbidden rules:
`node_modules`, `.git`, `test-results`, `__pycache__`, `.venv`, `coverage`,
`.pnpm` path segments; `.env*`, `.npmrc`, `.git-credentials`, `id_rsa`,
`credentials.json`, `auth.json` basenames; `.log`, `.pem`, `.p12`, `.pfx`
extensions; optional `.pdb`.

### What the real preview package shows

`create --root .` followed by `verify` against
`D:\Craftmine World\desktop\build\windows-preview-batch-07` fails closed with
`0 missing, 1 mismatch, 8 unpinned`. That is the honest result, not a defect of
the checker: the preview package contains all ten preflight-required files, but
the manifest has no independent pins for the build outputs
(`Craftmine World.exe`, `resources/app.asar`, both `resources/bin/*.exe`,
`sidecar.js`, `main.cjs`, the source zip and the packaged build manifest), and
`resources/source/USER_GUIDE.zh-CN.md` differs from the worktree copy (the
package was built from a different commit). Pass `--package <dir>` to `create`
to record package-snapshot pins for those build outputs; a snapshot proves byte
identity with a recorded artifact, **not** reproducibility from source.

## Limits

* Read-only: no download, no GUI, no window activation, no input, no write
  inside an inspected tree.
* Byte-identical native/NSIS outputs are not claimed; hashes prove these bytes,
  not compiler or installer reproducibility.
* Engine and export-template bytes are pinned from the lock and live in the
  shared cache; `create` only hashes them when `--cache` is supplied.
* `package-snapshot` pins are marked `reproducible: false`.
* Planned M/N capabilities are `pending-integration` and carry no hash.
* A skipped or unpinned input is never reported as verified.
