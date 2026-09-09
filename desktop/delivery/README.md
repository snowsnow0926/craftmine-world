# Delivery preflight and licence manifests

Read-only tooling that proves a Godot-based build is shippable from a licensing and
provenance standpoint, and that the Windows lifecycle acceptance (A17) is either
executed on an isolated machine or explicitly reported as unverified.

Owner: task H. This directory is new and self-contained. It does not modify the
pinned engine version, the isolation prototype, the base sources or the public
packaging entry points (`desktop/windows-package-tools.mjs`, `desktop/build-client.ps1`,
`desktop/ci/windows-isolated-validation.ps1`). Requests for those files are recorded
in `docs/dispatch-reports/godot-parallel/H/INTERFACE_H.md`.

## 1 What is checked

| Command | Checks | Fails when |
| --- | --- | --- |
| `notices` | Pinned Godot `LICENSE.txt`/`COPYRIGHT.txt` bytes, required notice entries, content assertions, drift against `desktop/godot/toolchain.lock.json` | a notice is missing, its bytes/hash differ, its text is not the expected licence, or the manifest and the lock disagree |
| `assets` | `base-assets/*.json` per-base provenance: origin, author, version, licence, redistribution, distribution scope, pinned bytes, undeclared files, required notices | a file is undeclared, a hash differs, a licence or notice is missing, or an asset is shipped/exported while redistribution is denied |
| `lgpl` | PI-Desktop `LICENSE`, `UPSTREAM.json`, `Cargo.toml`, notice-manifest entry and packaged copies | the LGPL text is missing, replaced by MIT text, or the packaged copy/source offer is absent |
| `cache` | Engine cache archives, unpacked executable, `unpacked-files.json`, template archive, `template-files.json`, `version.txt` | any pinned byte differs from `toolchain.lock.json` |
| `export` | An exported Web build: `index.html/wasm/pck`, `bridge.js`, `licenses/`, and every file listed in `build.json` | a notice is missing or tampered, or the build manifest no longer matches the files |
| `package` | A built `win-unpacked` directory: required files, `build-manifest.json` artifact hashes, `npm-inventory.json` completeness, offline licence entry, links, conditional Godot notices | a required file, licence text or hash is missing, or an engine is bundled without Godot notices |
| `all` | Everything whose inputs exist | any of the above |

Missing optional inputs (cache/export/package) are reported as `skipped`, never as
passed. Exit code is non-zero on any failure, so the tool can gate a release.

## 2 Usage

```powershell
node desktop/delivery/preflight.mjs all --evidence test-results/delivery-preflight/report.json
node desktop/delivery/preflight.mjs notices
node desktop/delivery/preflight.mjs assets
node desktop/delivery/preflight.mjs lgpl
node desktop/delivery/preflight.mjs cache --cache "D:\Craftmine World\desktop\build\godot\4.7.2-stable"
node desktop/delivery/preflight.mjs export  --export  <exported web directory>
node desktop/delivery/preflight.mjs package --package <win-unpacked directory>
```

Prove that the rules actually fire:

```powershell
node desktop/delivery/preflight-selftest.mjs
```

The self-test builds a synthetic fixture from the real pinned inputs and asserts both
the positive path and each negative rule (missing notice, hash drift, MIT text
substituted for LGPL, undeclared file, denied redistribution, missing licence file,
engine-version mismatch, tampered export, engine bundled without notices). It writes
`test-results/delivery-preflight-selftest.json`.

## 3 Provenance manifest format

`craftmine.base-assets/1`, one file per base in `base-assets/`:

```json
{
  "format": "craftmine.base-assets/1",
  "baseId": "first-person",
  "engine": {"version": "4.7.2-stable", "renderer": "gl_compatibility", "language": "GDScript"},
  "sourceDirectory": "desktop/godot/probes/first-person",
  "entries": [{"path": "world.gd", "role": "source", "origin": "authored", "author": "...",
               "version": "0.1.0", "license": "project-authored", "licenseFile": null,
               "redistribution": "permitted", "distribution": ["app-bundle", "user-export"],
               "bytes": 6396, "sha256": "...", "outstanding": "why no licence text is attached yet"}],
  "externalEntries": [],
  "requiredNotices": [{"path": "desktop/godot/licenses/GODOT_LICENSE.txt", "sha256": "..."}]
}
```

Rules:

- `distribution` values: `app-bundle` (ships with the client), `user-export` (may appear
  in a player-exported standalone game), `development-only` (must never ship).
- `redistribution`: `permitted`, `permitted-with-notice`,
  `permitted-with-notice-and-corresponding-source`, `conditional` (needs `conditions`),
  `denied`, `unreviewed`. Shipping or exporting with `denied`/`unreviewed` fails.
- Any shipped entry whose licence is not `project-authored`, `public-domain`, `CC0-1.0`
  or `Unlicense` must point at an existing `licenseFile`.
- `project-authored` entries must state either `licenseDocument` or an explicit
  `outstanding` reason, so an unresolved licence decision can never be silent.
- Every file under `sourceDirectory` must be declared; an undeclared file fails.
- `engine.version` must equal `desktop/godot/toolchain.lock.json.version`.
- Hashes are pinned at the `reviewedCommit` recorded in the manifest. When a base
  source legitimately changes, re-review provenance and update `bytes`, `sha256`,
  `reviewedCommit` and `reviewedAt` in one commit. The preflight is read-only and
  deliberately offers no auto-refresh: blessing new bytes must be a reviewed change.

## 4 Offline licence entry

`desktop/godot/licenses/README.md` is the user-facing offline entry; it lists every
file, its SHA-256, its official source and which distribution it covers. The machine
record is `desktop/godot/licenses/notices.manifest.json` (`craftmine.notices/1`).

The Godot MIT notice and the PI-Desktop LGPL notice are verified separately and by
different rules. The `pi-desktop-lgpl` entry carries `expectNone` for the MIT grant
sentence, so replacing the LGPL text with the Godot text fails the preflight even if
the hash is updated to match.

## 5 Windows lifecycle acceptance (A17)

```powershell
# Default: reports requirements and "not-verified"; executes nothing.
powershell -NoProfile -File desktop/delivery/windows-lifecycle-acceptance.ps1 `
  -ReportPath test-results/a17/windows-lifecycle.json
```

Execution requires all of: `-Execute`, an ephemeral runner marker
(`GITHUB_ACTIONS`/`RUNNER_ENVIRONMENT`/`RUNNER_TEMP`, or
`CRAFTMINE_LIFECYCLE_ISOLATED=1` with an absolute `CRAFTMINE_LIFECYCLE_ROOT`), an
absolute `-InstallDirectory` inside that root, and a profile directory that is not
`%LOCALAPPDATA%\CraftmineWorld`. It refuses otherwise.

Covered steps: silent first install, in-place upgrade with profile preservation and a
verifiable `upgrade-backups` snapshot, blocked-upgrade recovery (exclusive profile lock
must block the installer and leave every installed file and profile byte unchanged,
plus proof that the snapshot is usable rollback material), silent uninstall with
profile retention, and cross-user separation (a second account profile must exist and
must not be writable by the current user; machine-wide profile directories must be
absent). Without a second account the script records `cross-user data separation` as
failed/`not-verified` and never claims a pass.

A17 remains **unverified** in this session: no isolated Windows machine is available
and no installer was executed.

## 6 Limits

- Hash equality proves which bytes were inspected. It is not a legal opinion and does
  not decide whether a licence fits a particular commercial use.
- The `package` check reads an already-built directory. It does not build or publish.
- The `cache` check needs the downloaded engine archives; without them the check is
  skipped and reported as such.
- Godot notices are required only when an engine binary is actually present in the
  package, because the pinned toolchain is still `gd0-candidate-not-production-bundled`.

## Integration audit hardening (2026-09-09)

`assets` discovers every immediate directory under `desktop/godot/bases/` and
requires a manifest with that exact `sourceDirectory`. A same-name historical
probe manifest cannot cover a new base. New code/assets without a rights entry
remain explicit failures; preflight does not assign their licenses.

The canonical pending redistribution value is `unreviewed`. The earlier typo
`unrevealed` is recognized only as a legacy pending value and is also rejected.
Both asset shipping declarations and notice declarations fail for denied or
pending redistribution. Existing approved rights metadata is not rewritten.

`package` scans unpacked files at every level, with limits of 64 directory levels,
100,000 entries and 8 GiB of streamed hash input. Exceeding a limit is
`PACKAGE_SCAN_INCOMPLETE`, never evidence of no engine. Links (including a linked
package root) are rejected before file reads and are not traversed. Runtime
classification includes Godot executable names, the toolchain lock's exact
executable SHA256 even after renaming, and WASM with a PCK in the same directory.
Those cases require the pinned Godot notices.

Other WASM requires `resources/runtime-manifest.json`:

```json
{"format":"craftmine.package-runtimes/1","entries":[{
  "path":"resources/example/runtime.wasm","sha256":"<64 lowercase hex>",
  "runtime":"other","license":"<reviewed license identifier>",
  "redistribution":"permitted-with-notice"
}]}
```

Only an exact path/hash and explicit reviewed redistribution value classify the
WASM. `runtime:"godot"` activates the Godot notice checks. `runtime:"other"` is a
human-reviewed declaration, not a claim that this scanner identified an unknown
binary or verified all third-party obligations. Pending/unknown values and
changed bytes fail. Archive/ASAR extraction, renamed unknown engine formats,
concurrent native filesystem races and legal sufficiency remain outside this
bounded inspection; package authors must supply an accurate inventory.

Self-tests now create a unique `test-results/delivery-preflight-selftest-*`
directory and place their `report.json` there. They never delete or overwrite an
older run. The suite currently has 34 cases, including the integration negative
cases. A simulated link tests rejection control flow, not OS junction behavior.
