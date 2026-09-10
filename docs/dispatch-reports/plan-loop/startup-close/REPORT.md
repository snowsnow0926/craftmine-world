# Pending runtime factory shutdown barrier

Base: `fbeccb09e8985f289a0c5bbc13ea3c64185ce787`.
Branch: `codex/plan-startup-close-20260910`.
Worktree: `D:/cm-plan-startup-close-20260910`.

The prior full-client twenty-step run and its three empty shutdown-failure
audits remain evidence for that prior source. They did not exercise disposal
before the runtime factory returned. This change addresses that specific gap;
it does not establish the original IOCP cause.

## Change

GodotWorldViewHost registers each startup activity before its runtime factory
can return. The activity includes readiness, error/cancellation handling and
owned cleanup. Disposal first cancels current/pending instances, then waits for
the startup activities and retirement cleanup. It cannot report success just
because current/pending are empty while the factory is unresolved.

The order is intentional: close must start before awaiting a readiness-blocked
startup, so runtime disposal can reject that readiness wait. A late factory
result is cleaned without attaching a view. Factory rejection remains visible
to the caller; a late cleanup error becomes a shutdown failure.

The startup drain has a fixed ten-second failure deadline. An unresolved
factory/startup produces GODOT_STARTUP_CLOSE_TIMEOUT. The shared disposal
promise remains rejected even if a late runtime is later cleaned. This is a
bounded incomplete-shutdown outcome, not proof of resource release. No sleep,
exit-code relaxation, model call or real input is introduced.

## Validation

53 targeted tests passed, zero failed or skipped. These include six new
startup cases: pending factory and delayed cleanup, factory rejection, failed
late cleanup, cancellation while waiting for ready without a dependency cycle,
sticky deadline failure followed by late cleanup, and a real isolated HTTP
runtime whose origin is closed before disposal succeeds. The existing
retirement, HTTP, child-close and headless audit tests also passed.

[Raw test log](evidence/tests.log).
Desktop TypeScript noEmit validation exited zero; its empty log is retained at
`D:/cm-plan-startup-close-20260910/test-results/startup-close-typecheck.log`.
Installed dependencies were reused through an owned-worktree junction, without
installing packages. No full Electron/Godot client was run by this task.

Only the Godot world host changed in production. Spec, ADR and E2E additions
were appended as ASCII bytes, preserving all prior bytes. No other worktree
was edited. Final client validation on the integrated source remains pending.
