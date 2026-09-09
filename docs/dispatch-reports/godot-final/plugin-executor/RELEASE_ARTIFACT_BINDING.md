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

Root subsequently provisioned the official 26.03 distribution from
`https://github.com/ip7z/7zip/releases/download/26.03/7z2603-x64.exe`, by
extracting rather than running it. Its archive is 1,661,239 bytes with SHA-256
`0859c524b8a63551848f0c246abddcb1d0b7b656b0fbfe879f8d85e61a9e6edd`.
The owned directory is
`D:/cm-godot-final-20260910/desktop/build/archive-tool-26.03/tools`.
`7z.exe` SHA-256 is
`6ee3c0ed0b27663c1b948ae85a7c0bb073aed1498983182f3f0df1f6a8c30b2f`;
`7z.dll` SHA-256 is
`65e4c1f855f9ef6e8f0f5df8e3f27d9eb5f07311408639da0a1ca0b8f4871b0d`.
Root's actual format query includes NSIS. This resolves the tool capability
prerequisite; it does not by itself verify the pending Craftmine installer.

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
- Root reran the combined suite after that local permission failure: **9 passed,
  0 failed, 1 explicitly skipped** (the unavailable symbolic-link privilege),
  raw output `test-results/final-release-run-tests.log` in this worktree. The
  logged `STAGE_OUTPUT_NOT_EMPTY` is the expected refusal exercised by a passing
  negative test, not a failed build.
- Actual full NSIS payload extraction awaits the root's frozen same-source
  build and full 7-Zip provisioning. It is not yet passed by these unit tests.
- The blockmap is tied to this sealed build and hashed. Differential update
  behavior remains untested. The installer is never executed; clean Windows
  first installation, user-profile lifecycle and signing remain unverified.
  Evidence continues to say `unsigned-local-preview` and
  `cleanWindowsVerified:false`. No third-party rights status is changed.
