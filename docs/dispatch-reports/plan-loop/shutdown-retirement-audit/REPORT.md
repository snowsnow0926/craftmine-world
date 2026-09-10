# Retired cleanup and truthful shutdown acceptance

Base: `c38d8e46257411c4e74ede68ce29dbfe1ae8f8a7`.
Worktree: `D:/cm-plan-shutdown-audit-20260910`.
Branch: `codex/plan-shutdown-audit-20260910`.

## Corrected omissions

World replacement, failed startup, candidate discard/promotion and formal close
now register combined instance retirement. Removing current/pending no longer
loses the renderer/runtime cleanup promise. Disposal drains pending retirements
and rejects remembered failures even if replacement succeeded earlier. Failure
text is bounded to 64 records of 1,000 characters; truncating old details never
clears the failure condition.

Headless `status` and final `craftmine-headless-exit` IPC now carry
`shutdownFailures`. Main records service failures, host-core failures, and a
failed top-level shutdown sequence. Native parameter acceptance requires the
final array to exist and be empty, in addition to exit zero and empty input/page
errors. An exit-zero process with a cleanup timeout is explicitly rejected.
Ordinary user quit is still permitted after recording the failure.

## UtilityProcess event correction

The original `desktop-native-parameters-oUpnWZ` run exited zero but logged
timeouts for craftmine.world, pi.browser and pi.files. It is an incomplete
shutdown baseline, not successful teardown.

Independent no-window Electron 43.4.0 diagnosis by the parallel review agent
recorded synchronous removal of the retained stdout/stderr listeners after
the utility process exit callback, then clearing of child stream properties.
Actual pipe close occurred later. The old listener-based barrier therefore
missed real closure. Instrumented evidence is at
`D:/cm-plan-checks-20260910/test-results/utility-lifecycle-x2aWpG/report.json`.

The helper now retains both original stream references and, in the exit promise
continuation after Electron cleanup, checks actual `closed` or attaches a fresh
`close` listener. It does not substitute an event-loop turn or elapsed time for
closure, does not force-destroy streams, and retains named deadline failures.

The independent agent then ran this exact helper source (SHA256
`c0b0c438cfd5f64d0a095a148b9b8efeb66c9a11704e737873424de4a45b2566`)
through real no-window Electron, without listener instrumentation. Natural and
owned-kill scenarios both passed: the helper resolved only when both retained
streams reported closed=true. Both utility processes and the outer probe
exited zero, with no input violations. [Actual report](evidence/utility-helper.json)
and [source identity](evidence/utility-helper-source.json) are copied from
`D:/cm-plan-checks-20260910/test-results/utility-helper-eChBth`.

## Targeted validation

74 tests passed, zero failed/skipped. Coverage includes both lost-retirement
cases, headless status and exit propagation from the actual module, rejection
of missing/nonempty shutdown evidence, preservation of nonzero exit rejection,
Electron listener-removal/cleared-property ordering, the existing real Node
child and local HTTP teardown, plugin services and RPC lifecycle contracts.
The real client was not launched by this task.

Desktop TypeScript noEmit validation completed with exit zero. Dependencies
were reused through an owned-worktree node_modules junction; no dependency
installation was part of validation.

Raw test evidence is [tests.log](evidence/tests.log). The empty successful
compiler log remains at `test-results/shutdown-audit-typecheck.log` in this
worktree. Full-client acceptance and the original IOCP root cause remain
separate; neither is claimed resolved by controlled tests.

No source from another worktree was edited. The guide probe and runtime
requirement logic are unchanged. Specifications/ADR/E2E additions append ASCII
bytes, preserving existing text encoding and content.
