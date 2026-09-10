# Bounded owned-process cleanup review follow-up

The launcher now retains the process/Job handles after timeout or a failed native
query, explicitly terminates only that owned Job (or suspended unassigned root),
and waits at most five extra seconds for observed completion. Root PID, optional
root exit, root signaled state, last Job activity, failure and cleanup diagnostics
are returned in `craftmine.windows-host-process/1` and written to the runner's
invocation receipt before lifecycle rejection. Unconfirmed cleanup stays failed;
kill-on-close is only a final fallback. A failed invocation is not double-counted.

`RootExitCode` and `JobActiveZero` are separate facts. No descendant exit codes are
invented (`DescendantExitCodes: NOT_OBSERVED`). The process collision predicate now
matches NSIS's dangerous path prefix without a separator, includes the real
`godot-host-broker.exe` name, and distinguishes an unrelated PI distribution via
its `resources/bin` layout and `PI-Desktop.exe` product metadata. Unknown ownership
is rejected; there is no PID-specific exception and no user process was stopped.

Validation: **32/32 small policy/protocol tests passed**. Actual, owned, windowless
helper smoke **3/3 passed**: parent exits before child, deliberate nonzero-child
fixture (child exit codes remain unobserved), and timeout termination. Parent and
child reported the same private `CraftmineInstallAcceptance-*` desktop; the input
desktop remained `Default`. Final timeout receipt: root PID 125216, root exit 125,
root signaled, Job active-zero, `terminated-confirmed`, 2059 ms overall / 30 ms
cleanup. No installer, client, Godot, model, mouse/keyboard, focus or desktop switch
was invoked. A17 and actual install/upgrade/uninstall remain **NOT_VERIFIED**.

Raw reports:

- `native-smoke-final.json`: source
  `D:/cm-host-process-smoke-20260910/0b89dbd8af884eafbcf9861b7552759e/report.json`.
- `native-smoke-failure-early-zero.json`: the first native test exposed Job
  accounting reaching zero before the root handle was signaled. Its timeout
  assertion failed with root exit unavailable. The implementation now waits for
  both; that original failure remains unchanged.
- `native-smoke-failure-load.json`: preparation failed before any helper launch
  because PowerShell Add-Type does not load EXE extensions; corrected to a normal
  managed assembly load. Original failure remains unchanged.
- `unit-process-report.json` and `unit-process-final.log`: final 32-case run.

All compiled helpers, their logs/JSON files and earlier raw failures remain in the
owned D smoke directories, without deletion. No actual native query failure was
injected; it shares the bounded catch/cleanup path exercised by timeout and has
pure protocol rejection coverage, not independent OS-fault evidence.
