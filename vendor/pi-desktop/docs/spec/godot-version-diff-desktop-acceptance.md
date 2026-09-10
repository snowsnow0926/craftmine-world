# Actual VM2 desktop acceptance

The dedicated `historyView` headless method supports open, close, read,
refresh, compareHead, compareVersion, diff, next and previous. It accepts no
script, arbitrary selector or core RPC. Main validates fields; page execution
requires the installed headless input guard and matching active world. Only an
existing enabled control belonging to the observed history form may be submitted.
Action discriminators must be strings in the finite enumeration; arrays and
objects are rejected rather than coerced into read operations.
The ordinary UI uses the same React form handlers. No mouse/keyboard dispatch,
click/fill simulation, focus or Pointer Lock is used.

`tests/plan-loop/version-diff-client-native.mjs` requires a committed clean source
root with newly built Main/React, core and host binaries, plus a trusted runtime
manifest naming that commit. It is not a package/ASAR acceptance. Only a separately
authorized completed acceptance `craftmine.world` directory is copied; the source
inventory is checked before and after. No personal profile/settings/credentials
are read. A fresh short `test-results/desktop-native-vm2-*` profile is mandatory.

The fixed archived first-person world has genuinely adopted 500 ms source and
older history. The runner seeds a clearly separate empty legacy world in the
copy before launching the client. Through actual React and Main, it checks
historical comparison and text rendering, unchanged full native progress,
`backup.status.currentHash` and task facts. Switching worlds must reject the old
view. Deliberate mutation is a separate phase: the existing targetFeedback flow
creates/checks a 501 ms draft, then a fresh comparison view captures that draft
head with the old applied OID. Actual candidate preview/application must change
only the formal pointer binding, making that view stale even though its source
head remains identical. A fresh self-comparison and closing the real React panel
must again be read-only. Exit requires a complete empty shutdown audit.

Example after building and staging this exact committed source:

```powershell
node tests/plan-loop/version-diff-client-native.mjs --source-root C:/path/to/current-source --deps-app D:/cm-plan-loop-20260910/vendor/pi-desktop/apps/desktop --source-core C:/Users/WINDOWS/AppData/Local/Temp/CraftmineWorld-acceptance-archive-20260910/cm-plan-loop/desktop-native-parameters-6Uvnzp/profile/plugins/data/craftmine.world --world world-a5eac9797410 --output-parent C:/cm-vm2/test-results
```

The finite probe unit tests are controlled DOM fixtures. Earlier VM2 Rust/Git,
React race and service tests remain their own evidence; neither they nor mere
compilation count as this runner passing. Raw actual-client report and termination
status are required. Rejected, interrupted or blocked builds fail visibly.

## Explicit packaged mode

Adding `--packaged-root`, `--expected-commit` and
`--expected-build-manifest-sha256` selects package-only execution. The expected
source commit must also match the explicitly selected clean source root.
`inspectParameterPackage` verifies Main/preload, all manifest-listed client and
plugin files, bundled core/host, source archive and runtime resource inventory.
The package is rechecked before fixture-core startup and every client launch.
An absent or changed package dependency fails; it never selects a development
binary. The dependency-app argument supplies only the ASAR reader in this mode,
not Electron. Fixture creation uses the bundled core and bundled CoreClient;
the client starts the packaged EXE with no development app argument.

The original nine Main/React, full-progress read-only, stale-view, real 501 ms
check/application and strict shutdown assertions are unchanged. Only the same
explicitly authorized completed core archive is copied. The report distinguishes
`mode: packaged` from `mode: development` and records the actual package identity.
Unit test success does not constitute a package acceptance run.

```powershell
node tests/plan-loop/version-diff-client-native.mjs --source-root C:/path/to/frozen-source --deps-app C:/path/to/dependencies/vendor/pi-desktop/apps/desktop --source-core C:/path/to/authorized-6Uvnzp/profile/plugins/data/craftmine.world --world world-a5eac9797410 --output-parent C:/cm-vm2-package/test-results --packaged-root C:/release/win-unpacked --expected-commit <40-hex-commit> --expected-build-manifest-sha256 <64-hex-hash>
```
