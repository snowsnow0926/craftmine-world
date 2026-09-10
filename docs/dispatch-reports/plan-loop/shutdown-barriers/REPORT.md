# Shutdown terminal barriers

Base: `5b74d3a743b74b4399f8d40c22edea3842ee6ef0`.
Worktree: `D:/cm-plan-shutdown-20260910`.
Branch: `codex/plan-shutdown-20260910`.

The earlier PP2 native failure remains unexplained: `L0CaYa` passed eighteen
checks and failed its third exit with 0x80000003 / PostQueuedCompletionStatus(6).
The same-source `0Dd08G` rerun passed all nineteen checks. This repair addresses
independently confirmed lifecycle omissions and does not establish IOCP causality.

## Implemented boundaries

- Formal/candidate world close waits for WebContents `destroyed`. Listeners
  precede the close request; concurrent close/dispose callers share completion.
  Runtime and renderer cleanup are both attempted. Missing destruction is a
  named failure, not successful teardown.
- Node sidecar disposal waits for child `close`, including its pipes, after
  stopping only the existing owned child. Repeated disposal does not kill again.
- Default plugin UtilityProcess disposal observes `exit` plus exposed stdout
  and stderr `close`. Pipe-owning test adapters can provide `closed`; adapters
  exposing no pipes retain an onExit terminal boundary. Hook and terminal
  deadlines remain finite and report errors. Child shutdown still runs after
  a hook fails. No system process enumeration or broad termination is used.
- Web runtime disposal shares its whole promise. Missing HTTP close completion
  raises GODOT_RUNTIME_CLOSE_TIMEOUT instead of resolving after a deadline.
- Main records each rejected service as `service shutdown incomplete`, naming
  the owner and error. Its final quit release policy and native nonzero-exit
  acceptance are unchanged.

## Actual validation

Final targeted run: **67 passed, 0 failed, 0 skipped**. This includes the
existing plugin-service and RPC lifecycle suites, real independent Node
child/pipe closure, actual local HTTP server teardown, controlled renderer
destruction and UtilityProcess event ordering, duplicate calls, hook failures
and missing terminal events. No Electron client, real input, model, credentials
or external network service was used.

[Final raw test log](evidence/tests.log).
The final small main-process ordering adjustment installs allSettled rejection
handlers before awaiting host-core, preventing an early close failure from
becoming an unhandled rejection. Its updated RPC lifecycle suite passed
11/11; [raw log](evidence/main-contract.log). These are repeated checks within
the same suite, not eleven additional acceptance cases.
Desktop TypeScript check completed with exit 0 using the existing installed
dependencies read-only through an owned-worktree node_modules junction.
The empty successful compiler log is retained locally at
`D:/cm-plan-shutdown-20260910/test-results/shutdown-barriers-typecheck.log`.

An earlier run found one stale source-contract assertion expecting only three
shutdown services, omitting the pre-existing Godot service. The assertion now
requires all four and rejected-service logging. That failure is retained at
`D:/cm-plan-shutdown-20260910/test-results/shutdown-barriers-tests.log`;
it is not counted as a passing run. Later hook-failure and timeout coverage
increased the final suite from 65 to 67 tests.

The full native client, including actual Electron UtilityProcess stream event
semantics, requires post-integration validation. No claim is made that the
earlier IOCP crash is fixed. Other resource owners outside the assigned modules
were not converted into shutdown barriers in this patch.
