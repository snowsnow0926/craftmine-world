# Windows personal-host compatibility lifecycle

This runner is a separate, explicitly authorized **host-compatibility** exercise.
It does not satisfy clean-OS/VM/ephemeral A17 acceptance. The existing A17 runner
is unchanged. Implementation and no-installer unit checks do not prove installation.

## Review and execution

`windows-host-compatibility.ps1 -PlanPath <absolute-plan.json>` defaults to
`NOT_RUN`, outputs the plan, and does not create the test root or invoke an installer.
Execution additionally requires **both** `-Execute -HostCompatibilityAuthorized`.
Do not execute until the candidate installer and corresponding unpacked payload
have been independently sealed and reviewed. Run non-elevated Windows PowerShell
5.1 as the current user. Do not run any other Craftmine client or installer during
the finite test. The runner never launches the installed application. An unrelated
PI distribution's shared core name does not itself collide: the owner resolver
requires the `resources/bin` layout and separate `PI-Desktop.exe` product metadata.
Missing/unknown ownership remains blocked. No PID/path exception is used.

Before it creates the owned root the runner verifies that every Windows PowerShell
5.1 cmdlet it depends on resolves from a module under `%WINDIR%`. An inherited
`PSModulePath` that shadows `Microsoft.PowerShell.Utility` with a trimmed copy
(for example an agent runtime's bundled `Modules` directory) lacks `Get-FileHash`;
hashing would otherwise fail only after the owned root and owner marker exist.
That case is refused as `HOST_POWERSHELL_TOOLING_INVALID` before any directory,
marker or installer invocation. Launch the runner with a `PSModulePath` that
resolves the system modules, and do not rely on `-NoProfile` alone: `PSModulePath`
is inherited through the environment, including by any wrapper child process.

The plan has exactly these fields (replace every placeholder with reviewed pins):

```json
{
  "format": "craftmine.windows-host-compatibility-plan/1",
  "root": "D:\\cm-host-unique-reviewed-run",
  "previous": {
    "installer": "C:\\approved-release\\Craftmine-World-Setup-0.14.3.exe",
    "installerSha256": "<64 lowercase hex>",
    "packageRoot": "C:\\approved-release\\win-unpacked",
    "packageTreeSha256": "<64 lowercase hex>",
    "commit": "8276b4540289c0d397c382dff2123edfe1861d42",
    "buildManifestSha256": "<64 lowercase hex>",
    "version": "0.14.3"
  },
  "next": {
    "installer": "D:\\new-reviewed-release\\Setup.exe",
    "installerSha256": "<different 64 lowercase hex>",
    "packageRoot": "D:\\new-reviewed-release\\win-unpacked",
    "packageTreeSha256": "<different 64 lowercase hex>",
    "commit": "<different 40 lowercase hex>",
    "buildManifestSha256": "<64 lowercase hex>",
    "version": "<actual NSIS DisplayVersion>"
  }
}
```

All JSON the runner reads is read as UTF-8 explicitly. The release build
manifest is UTF-8 **without a BOM** and carries a non-ASCII product name; the
Windows PowerShell default (ANSI) encoding corrupted it on a non-UTF-8 code page
and made `Get-CmPackage` fail before any installer ran.
The D root must be a new, short, single-level directory, with no reparse ancestors.
Payload digest is SHA-256 of ordinal-sorted UTF-8/LF rows
`relative/path|decimalBytes|lowercaseSha256\n`, including **every regular payload
file**. Use `Get-CmTreeDigest (Get-CmTree <packageRoot>)` from the companion library
after `Initialize-CmHostNative` (compiles the helper only). Record the full list with
the reviewed plan. Hash verification rejects reparse paths and multiply linked
files. The setup/payload pairing must already be verified by delivery seal and
installer extraction; this runner does not pretend a manifest proves an arbitrary
installer executable contains the corresponding payload.

## Finite lifecycle and ownership

1. Verify installer, source manifest/commit/appId and complete payload tree pins.
   Reject preexisting exact Craftmine GUID install/uninstall keys in HKCU/HKLM,
   both registry views, the exact AppUserModelId key, relevant desktop/start-menu
   shortcuts (including renamed links targeting Craftmine), related running
   processes, or the exact NSIS installer mutex. No registry entries are deleted
   by the runner. Steam's unrelated title/URL is not classified as Craftmine.
2. Install the actual **previous 827 installer first**, current user, silent,
   `--no-desktop-shortcut`, explicit `/D=<own-install>` last. Check complete installed
   payload, source identity, registration and owned shortcut targets. The synthetic
   profile is absent at this point, avoiding an empty backup from the first install.
3. Create the included valid SQLite fixture plus a domain fixture in the separate
   D profile. Set `CRAFTMINE_DATA_DIR` to that profile, and TEMP/TMP to the D test
   directory for compilation and every child. No product profile or credentials
   are copied or read. Invoke the **different next installer**, then verify every
   new payload byte and the installer's own offline backup manifest **and bodies**.
4. Capture the new version's complete installed/profile files, directories,
   registry, shortcuts and cache. Hold the existing synthetic `pi.sqlite`
   exclusively; invoke the same **next** installer once. Require the custom
   upgrade guard's exit **2**, then exact unchanged new installed bytes, complete
   profile/backup, directory lists, registration, shortcuts and cache. This is a
   Windows file-share lock test, not a claim of a real running database workload.
5. Recheck owner marker, exact InstallLocation/UninstallString, installed files,
   uninstaller hash, shortcuts, cache and no clients. Invoke only that owned
   uninstaller `/S /currentuser`, without `--delete-app-data`. Wait for its owned
   descendants. Require removal of application files/owned registrations and
   shortcuts, and exact preservation of the complete synthetic profile/backup.

Every installer/uninstaller is launched suspended onto a newly created, private
non-input desktop and assigned to a kill-on-close job before resume. The runner
does not switch desktops, change desktop ACLs, send input, request Pointer Lock,
or activate a window. It waits at most 900 seconds for **Job active-zero and a
signaled root process** and retains partial state on failure. On timeout/query
failure it explicitly terminates only its owned Job, keeps the handles open, and
polls for up to five additional seconds. The receipt includes root PID/observed root
exit, last Job activity, termination request/error and confirmed/unconfirmed cleanup.
Kill-on-close is only a fallback, never proof that termination completed. Descendant
exit codes remain `NOT_OBSERVED`; active-zero is not descendant strict exit 0. No retries,
automatic uninstalls, directory cleanup or registry cleanup run after failure.

## Actual NSIS 26.15.3 constraints

Reviewed `app-builder-lib@26.15.3/templates/nsis` and `out/targets/nsis/NsisTarget.js`:

- `computeCommonInstallerScriptHeader` exposes `no-desktop-shortcut`, but **no
  no-start-menu runtime flag**. `include/installer.nsh:addStartMenuLink` only has
  the compile-time `DO_NOT_CREATE_START_MENU_SHORTCUT` guard. Existing 827 may
  create the current-user `craftmine world.lnk`; prior existence is a collision,
  and its exact target/hash are recorded before upgrade/uninstall.
- `ALLOW_ONLY_ONE_INSTALLER_INSTANCE` unconditionally calls `BringToFront` and
  can focus another installer. The private desktop isolates these calls from the
  input desktop. Owned windowless helper smoke covers desktop inheritance and
  normal/timeout lifecycles; installer-specific behavior is still not verified.
- Silent `CHECK_APP_RUNNING` can call `Stop-Process`/`taskkill`. Its process-path
  prefix has no trailing separator, so the collision gate also blocks `install-other`
  when `$INSTDIR` is `install`. The fallback matches the Craftmine executable name.
  Prechecks do not
  eliminate a concurrent user launch after a check. This is an explicit host-test
  limitation, not proof of process isolation equivalent to a VM. The runner never
  asks NSIS to kill a known existing client and refuses observed collisions.
- `include/installer.nsh:installApplicationFiles` copies the setup to NSIS's
  **real current-user KnownFolder LocalApplicationData**, independently of
  `CRAFTMINE_DATA_DIR` and environment `LOCALAPPDATA` overrides. Actual builder
  sanitization of `@pi-desktop/desktop` gives the exact path
  `@pi-desktopdesktop-updater/installer.exe`. Any preexisting cache directory,
  even empty, is a collision. Only this run-created exact setup copy can be
  overwritten by the next installer. Unknown files or wrong hashes stop the run.
  If uninstall leaves this cache, its exact path/bytes/hash are reported and
  retained. The runner does not delete it. Registry, shortcuts and this cache are
  explicit real-host side effects; **not all writes are on D**.

Reports are retained at `<root>/evidence/report.json`, including every invocation
and terminal/failure stage. `PASSED_HOST_COMPATIBILITY` never changes `a17` from
`NOT_VERIFIED`. This exercise excludes UI gameplay, clean-OS dependencies,
cross-user behavior, reboot/power loss, signing/SmartScreen, real models and
performance. A synthetic backup does not prove arbitrary existing-user migration.

## No-installer verification

```powershell
# System modules only: an inherited PSModulePath can shadow Get-FileHash.
$env:PSModulePath = 'C:\Users\<user>\Documents\WindowsPowerShell\Modules;' +
    $env:ProgramFiles + '\WindowsPowerShell\Modules;' + $env:WINDIR + '\system32\WindowsPowerShell\v1.0\Modules'
$env:TEMP = 'D:\cm-host-install-unit-20260910'
$env:TMP = $env:TEMP
powershell.exe -NoProfile -NonInteractive -File tests/delivery/windows-host-compatibility.test.ps1 -OutputRoot $env:TEMP
# Adds the end-to-end refusal of a shadowing non-system Utility module.
powershell.exe -NoProfile -NonInteractive -File tests/delivery/windows-host-compatibility.test.ps1 -OutputRoot $env:TEMP -ShadowModuleRoot <shadow-module-root>
```

`-ShadowModuleRoot <dir>` points at a non-system directory holding a shadowing
`Microsoft.PowerShell.Utility`; the suite then proves end to end that the entry
script exits 1 with `HOST_POWERSHELL_TOOLING_INVALID` and creates no owned root.
Without that argument the case is reported in `skipped`, never as a pass.
Tests compile the C# helper and exercise parsing, pure ownership policies, finite
mocked sequencing, file/hash/backup/cache fixtures, and default `NOT_RUN` behavior.
They never call its native `Run` method or an installer. Small test fixtures and
failed logs are retained; no historical test directories are cleaned.
