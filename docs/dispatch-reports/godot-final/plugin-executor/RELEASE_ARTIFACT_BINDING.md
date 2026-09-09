# Same-run Windows release evidence

## Fixed defect

The previous `verify` scanned every matching installer beside the hardcoded
`release/win-unpacked` directory. An older installer could be listed with the
current source commit without inspecting its payload. That evidence is not a
same-source installer acceptance result.

`build-client.ps1` now reserves a unique `desktop/build/releases/<commit>-<uuid>`
run before electron-builder. The builder receives that run's output directory.
After successful builder completion, `seal-release` records every output byte.
`verify --run <run.json>` requires unchanged clean HEAD, exact build manifest,
sealed output bytes, exactly one expected NSIS installer and its blockmap
(directory-only builds require neither). No old release directory is searched,
reused, or removed. There is no recursive deletion in this new flow.

The verifier lists the NSIS archive using a pinned full 7-Zip, validates paths
and links before extraction, extracts only `$PLUGINSDIR/app-64.7z` (or `.zip`),
validates and extracts that payload into a fresh owned evidence directory.
It repeats source archive, build manifest, native binaries, plugin inventory,
runtime inventory and client `app.asar` file checks against the extracted app,
then requires the whole payload inventory to equal the same-run `win-unpacked`.
It checks the output seal again before writing run-local package evidence.
Archive command logs are preserved even when extraction fails.

## Host invocation

```powershell
powershell -NoProfile -File desktop/build-client.ps1 -Installer `
  -GodotCache '<pinned engine cache>' -GitArchive '<pinned MinGit zip>' `
  -ArchiveTool '<owned tool directory>/7z.exe' `
  -ArchiveToolSha256 '<64 lowercase hex for 7z.exe>' `
  -ArchiveLibrarySha256 '<64 lowercase hex for adjacent 7z.dll>'
```

Both archive tool files are pinned in the run record and checked again before
and after extraction. The format capability query must include NSIS. The
installed electron-builder 26.15.3's cached **7za 24.09 does not support NSIS**:
an actual `7za.exe i` on 2026-09-10 listed 7z/Cab/zip etc., but no NSIS.
Do not substitute that reduced tool. A full official 7-Zip distribution can be
extracted to an owned tool directory without installing it; record its source
archive hash separately when provisioning it. No tool path is taken from a
model payload or shell command. The default directory-only build needs no
archive extractor.

## Tests and limits

- Local `node --test --test-isolation=none tests/godot-final-install-assets/release-run.test.mjs`: **4/4 passed**. Tests cover unique outputs, seal mutation, old installer exclusion, mandatory same-version pair, changed manifest, resealing, traversal/ADS/reserved Windows names/case aliases and links. These use synthetic bytes, not a real installer.
- `node --check desktop/windows-package-tools.mjs`: passed.
- Combined historical K package tests locally: 5 passed, 4 failed, 1 skipped.
  Four subprocess cases could not execute Node; the separately captured cause
  is `EPERM spawnSync C:\Program Files\nodejs\node.exe EPERM`. The symlink test
  explicitly skipped because this user's token cannot create that link. Root
  must rerun and retain its raw output. The obsolete exact-14-files assertion
  was updated to validate uniqueness and the newly mandatory GPL text; the
  shared product required-file list is unchanged.
- Actual full NSIS payload extraction awaits the root's frozen same-source
  build and full 7-Zip provisioning. It is not yet passed by these unit tests.
- The blockmap is tied to this sealed build and hashed. Differential update
  behavior remains untested. The installer is never executed; clean Windows
  first installation, user-profile lifecycle and signing remain unverified.
  Evidence continues to say `unsigned-local-preview` and
  `cleanWindowsVerified:false`. No third-party rights status is changed.
