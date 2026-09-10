# Host compatibility lifecycle runner: implementation only

Baseline: `b6f15172591db71b6016607a811b4679531df63d`.
Independent branch/worktree: `codex/fb-host-install-20260910`,
`D:/cm-fb-host-install-20260910`.

Implemented the separate finite Windows host-compatibility runner and ownership
library, native private-desktop/job launcher, a valid small synthetic SQLite
fixture, English execution contract, and no-installer tests. Existing A17 and
frozen products are untouched. Actual 827 is the first installer, a distinct
reviewed next package is the upgrade, and the busy negative test uses the new
version baseline. Input pins and complete installed/backup bytes are required.

Validation: **25/25 small tests passed** under Windows PowerShell 5.1. C# Add-Type
compiled; its native `Run` method was **not called**. The fixture was independently
opened through Node SQLite read-only and returned row `(1, synthetic-preserve)`.
Default command produced `NOT_RUN` and created no installation root. Git whitespace
check passed for source. The byte-preserved PowerShell `Format-Table` raw log has
trailing padding, which staged `git diff --check` reports; it is not normalized or
represented as a clean raw-log whitespace check. `unit-report.json` and
`unit-final.log` preserve final raw results.
Earlier development test logs and tiny fixtures remain in ignored
`test-results/host-installer`; no cleanup was performed.

**Installers invoked: 0. Installation / real upgrade / real busy guard / uninstall /
private-desktop behavior: NOT_RUN. A17: NOT_VERIFIED.** No model, product client,
Godot, input simulation, focus, Pointer Lock, elevation or network was used.

Necessary host effects were discovered in actual app-builder-lib 26.15.3:
no runtime no-start-menu flag; silent CHECK_APP_RUNNING can terminate clients;
installer single-instance macro calls BringToFront; embedded installer is copied
to real KnownFolder LocalApplicationData `@pi-desktopdesktop-updater/installer.exe`.
The runner rejects any existing exact registry, related shortcut, process/mutex or
cache, and records the permitted run-created cache outside D. Remaining owned
cache is retained, not deleted. A concurrent user launch after precheck remains a
documented host-only risk. There is no claim of VM isolation or all-D writes.

Next: independent source review, then root-selected new sealed installer/payload
pins and an explicit invocation only after fresh collision checks. No candidate
was installed in this implementation task. Failures retain partial owned state;
the runner never attempts broad cleanup or silently retries.
