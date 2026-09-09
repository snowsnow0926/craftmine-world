# Isolated Windows delivery validation

The current developer machine has no user-provided isolated VM. Do not run installers or uninstallers there, download a VM, enable OS features, register a test account, or create certificates to fill the acceptance gap.

`windows-isolated-validation.ps1` is an explicit CI entrypoint. By default it only prints `not-run`. Execution requires `-Execute`, an absolute installer path, its expected SHA256, and the environment of an ephemeral GitHub-hosted Windows runner (`GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`, absolute `RUNNER_TEMP`). It rejects personal and self-hosted machines before creating any files or launching an executable. These markers are operational safeguards, not permission to impersonate CI by setting environment variables locally.

In a manually dispatched isolated Windows job, check out the matching source, obtain its installer artifact, and run:

```powershell
powershell.exe -NoProfile -NonInteractive -File desktop/ci/windows-isolated-validation.ps1 -Execute -Installer '<absolute artifact path>' -ExpectedSha256 '<verified SHA256>'
```

Retain `$RUNNER_TEMP/craftmine-ci-*/report.json` as a job artifact even on failure. No public workflow, schedule, download or remote job is activated by this repository change. The script tests silent first install, upgrade with a private synthetic profile and verified pre-upgrade snapshot, refusal while the profile is locked, and uninstall preserving that profile. The installer does not auto-start the app. Silent failure dialogs have an explicit NSIS default and return nonzero; interactive installs retain the existing Chinese explanation.

This is **installer lifecycle acceptance in disposable CI**, not proof of a clean Windows machine without developer tools. Such a machine and the cross-user DPAPI check remain separately unverified. Run the existing offscreen packaged native acceptance against the same artifact to test runtime behavior; it uses its own marked profile and no input simulation. Never turn a diagnostic metric sample into a benchmark pass or a CI lifecycle pass into clean-OS acceptance.
