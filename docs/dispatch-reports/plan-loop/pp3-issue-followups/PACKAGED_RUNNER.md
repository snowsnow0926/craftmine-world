# PP3 strictly packaged acceptance runner

`tests/plan-loop/issue-client-native.mjs` retains its 22-step scenario, full
native snapshot comparisons and three `assertCleanHeadlessShutdown` exits.
This addition changes test startup and identity checks only. No product behavior
or next-round parameter default feature is included.

Run from the clean checkout of the exact commit embedded in the newly frozen
package. Supply independently recorded identities; do not derive expected
values silently from the package being tested:

```powershell
node tests/plan-loop/issue-client-native.mjs `
  --source-root C:/frozen-source `
  --deps-app C:/readonly-asar-tooling/vendor/pi-desktop/apps/desktop `
  --output-root C:/cm-pp3-package/test-results `
  --packaged-root C:/new-delivery/win-unpacked `
  --expected-commit <full-40-character-commit> `
  --expected-build-manifest-sha256 <64-character-build-manifest-sha256>
```

The output root may be outside the source checkout to keep test profile paths
short. Each launch rechecks the clean source commit and the entire package
identity with the existing `inspectParameterPackage` implementation: ASAR Main
and preload bytes, feature/input guards, all plugin files, source archive,
core/host/agent runtime artifacts, Godot/Git/license resource inventory and its
manifest. The package executable/ASAR hashes and all verified identities must
remain equal across all launches and are recorded per launch. The invoking
script must belong to the explicitly selected source checkout.

Packaged mode starts only `Craftmine World.exe` from the selected package, with
that package's core, host and Godot resource paths. `--deps-app` supplies only
the ASAR inspection library. It does not resolve external Electron or provide
development runtime bytes. `--runtime-source`, `--core-bin` and `--host-bin`
are rejected in packaged mode. Missing, modified or incomplete resources fail
before starting a client; no fallback is attempted. Inherited development and
runtime environment switches are removed by the shared isolated environment
builder. The profile and empty legacy source are fresh owned directories. A
failed normal shutdown retains the existing 20-second grace period, requests
termination and then waits at most another five seconds. `CLIENT_STOP_TIMEOUT`
is recorded as failure, including from final cleanup; it cannot produce a
passing report.

Development mode remains explicitly reported as `development`, accepts
`--source-root --runtime-source --deps-app` and optional absolute
`--core-bin --host-bin --output-root`, and retains its existing fixed ae32974
native binary hash pins. It cannot be called packaged acceptance.

Contract tests:

```powershell
$env:CRAFTMINE_TEST_DESKTOP_DIRECTORY = 'C:/readonly-asar-tooling/vendor/pi-desktop/apps/desktop'
node --test tests/plan-loop/issue-client-package.test.mjs tests/plan-loop/parameter-client-package.test.mjs
```

These exercise actual Git/filesystem and small ASAR fixtures without launching
Electron or Godot. The combined contract run passed **13/13** using read-only
ASAR tooling from `D:/cm-plan-loop-20260910/vendor/pi-desktop/apps/desktop`.
The stop timeout case uses an explicit no-process clock fixture, not a claim
that an actual hung client was killed. Syntax and `git diff --check` passed;
the original 22-step acceptance body was compared against 08f4ff3 and remains
identical except for awaiting the now-asynchronous startup guards.
Actual new-package execution is intentionally pending its
frozen source and build-manifest identity. No old package has been run or
reported as passing the new functionality. This runner does not replace NSIS
installation, full delivery-seal validation, signature verification, clean-OS
testing or real-model acceptance.
