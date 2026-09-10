# Sealed Windows comprehensive acceptance

Run the current acceptance source against one freshly sealed Windows run. Do not rebuild, modify, or re-seal its `output/win-unpacked` while acceptance is running. Verify the run's original seal and complete package evidence before and after these commands; the commands below exercise the package and do not substitute for source/build identity verification.

From the current source root in PowerShell (replace the example run path):

```powershell
$env:CRAFTMINE_PACKAGED_ROOT = 'D:/release-root/releases/NEW-RUN/output/win-unpacked'
$env:CRAFTMINE_TEST_OUTPUT_ROOT = 'C:/Users/WINDOWS/AppData/Local/Temp/craftmine-release-acceptance/test-results'
$env:CRAFTMINE_TEST_BASES = 'first-person,top-down,side-view,mining-sandbox'
$env:CRAFTMINE_TEST_REUSE = '1'
$env:CRAFTMINE_TEST_COPY = '1'
$env:CRAFTMINE_TEST_BACKUP = '1'
node tests/godot-final/client-complete.mjs
if ($LASTEXITCODE -ne 0) { throw 'Comprehensive package acceptance failed' }
node tests/godot-final-install-assets/windows-client-native.mjs --packaged-root $env:CRAFTMINE_PACKAGED_ROOT --deps-app "$PWD/vendor/pi-desktop/apps/desktop" --output-parent $env:CRAFTMINE_TEST_OUTPUT_ROOT
if ($LASTEXITCODE -ne 0) { throw 'Windows game export acceptance failed' }
```

The output override is an absolute, ordinary directory chain. Missing directories are created one component at a time; links and files are rejected. Each comprehensive invocation creates a fresh `desktop-native-complete-*` directory and independent profile. No prior profile or delivery directory is deleted. The export runner independently creates `desktop-native-wx-*`; its output parent's basename must be `test-results`.

The child receives only explicitly selected headless/profile/token/core/host/base settings. Inherited `CRAFTMINE_*`, `PI_DESKTOP_*`, `ELECTRON_*`, and `NODE_OPTIONS` are removed. Package bases are fixed to package `resources/godot`; development bases to source `desktop/godot`. Parent-only REUSE/COPY/BACKUP switches are not passed to the child. Tests use offscreen windows, IPC and real gameplay code, without real input, focus, Pointer Lock, network or model calls.

Every comprehensive stop, including intermediate restarts and already-exited children, must have exit zero, no forced kill, and an actual headless exit audit with empty `violations`, `pageErrors` and `shutdownFailures`. Missing audit fails. A final stop failure persists `shutdownError`, preserves an earlier `fatal`, sets `passed:false` and a nonzero process status, and still writes `finishedAt` and the final report. The forced-stop fallback has a bounded terminal wait and cannot count as success.

With BACKUP enabled, the fresh run also contains one production failure scenario. After real export, inspect and body verification, it sends a different valid current-state hash with a fresh operation ID. Only `BACKUP_CURRENT_HASH_CONFLICT` is accepted. Selected world, build identity and every persistent progress field must remain unchanged. The runner inspects the same archive again because a failed restore can checkpoint before its CAS check, then restores using a new operation ID and the refreshed grant/current hash. Correct restore, complete progress equality and restart remain mandatory.

This new CAS scenario is not the historical ten-case recovery suite. `client-recovery-faults.mjs <frozen-run> <failed-run>` still requires genuine retained evidence of its original `INVALID_OPERATION_RECEIPT` failure and its matching frozen runtime. It has no current-package mode and must not be relabeled as this sealed run's fault coverage. The Windows export runner's existing eight-case result is likewise separate from comprehensive shutdown coverage. These runners make no new model, signature or distribution-license claim.

Focused harness validation: `node --test tests/player-product/complete-exit-contract.test.mjs tests/player-product/shutdown-exit-audit.test.mjs`. Controlled tests drive the actual complete stop/finalizer source and production-used test helpers. They verify assertion behavior and transport mismatch rejection, not a real client's success. Actual sealed-package reports remain required.
