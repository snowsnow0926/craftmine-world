# Await the owned Godot runtime during application shutdown

An actual recovery verification (WCI7EM) saved and compared all three original
worlds, then the client exited with 0x80000003 and a Windows IOCP error. The
native cause is unproven. Review found a separate concrete lifecycle omission:
GodotWorldViewHost.dispose discarded its asynchronous runtime-close promise,
allowing the application event loop to exit before owned HTTP cleanup finished.

Disposal now returns one shared promise, and application shutdown awaits it
with the other owned services. The previous save-before-quit barrier stays in
place. A gated runtime fixture proves that disposal cannot resolve early.
Native recovery and full-client runs must still check actual exit codes; this
change does not relabel the recorded native crash as resolved by inspection.

The initialization-retry harness waits for navigation on every startup. A
continuation may consume a hash-bound earlier recovery report, compare its
recorded snapshots and restart, but must record recoveryAppliedHere=false and
never replay recovery or manufacture another failed profile.

## Terminal barriers after the PP2 shutdown audit

The PP2 run `desktop-native-parameters-L0CaYa` passed its first eighteen
checks, then exited with 0x80000003 and `PostQueuedCompletionStatus(6)`.
The same-source `0Dd08G` rerun passed all nineteen checks and exited normally
three times. Both records remain valid; no native root cause is established.

The host now also waits for formal/candidate WebContents destruction, not just
the HTTP runtime. Close listeners are installed before requesting close; a
shared promise prevents duplicate requests. A missing `destroyed` event rejects
with `GODOT_RENDERER_CLOSE_TIMEOUT` after the existing three-second budget.
The owner records a fault, and the application logs rejected service teardown.

The Node agent sidecar waits for ChildProcess `close`, which includes its pipes,
after requesting termination of that already-owned child. Plugin UtilityProcess
teardown awaits its `exit` and each exposed stdout/stderr `close`; the API has no
ChildProcess `close` event. Pipe-owning injected adapters must supply `closed`.
Legacy adapters exposing no pipes use their `onExit` terminal event. These are
shared disposal promises with bounded, named failures; no PID enumeration or
unrelated process termination is added.

The Web runtime shares the entire disposal promise, including graceful exit and
HTTP closure. A missing server-close callback rejects with
`GODOT_RUNTIME_CLOSE_TIMEOUT`; elapsed time is no longer returned as successful
cleanup. Successful closure clears its deadline. Concurrent callers cannot
return ahead of the first caller or request HTTP close twice.

Application quit still releases after the existing service barrier, including
on failure. Each rejected service is recorded as `service shutdown incomplete`
with its owner and error. This change does not turn a nonzero native exit into a
passing acceptance result. Full-client shutdown validation remains separate.

Targeted checks: `node --test tests/godot-host-lifecycle.mjs
tests/godot-runtime-boundaries.mjs tests/player-product/shutdown-barriers.test.mjs`
from the outer Craftmine repository. They cover delayed/missing renderer
destruction, concurrent disposal, a real isolated Node child's pipe closure,
controlled UtilityProcess exit/pipe ordering, and real/controlled HTTP closure.

## Retired instances and auditable shutdown failure

All instance retirement paths now register combined renderer/runtime cleanup before discarding ownership. Disposal drains pending retirements and rejects remembered retirement failures even after a replacement became current. Failure history is bounded but never silently reset to success during the host lifetime.

Electron 43.4.0 synchronously removes UtilityProcess pipe listeners and clears child.stdout/stderr after exit callbacks. Retain the original stream references and observe closed or reattach close listeners in the exit promise continuation. This is ordering after Electron cleanup, not elapsed-time evidence. A still-open pipe keeps the existing named deadline failure.

Headless status and will-quit IPC include shutdownFailures. Main records rejected service barriers, host-core shutdown errors and top-level shutdown sequence failures. The parameter native runner requires this field to exist and be empty in the final exit audit, in addition to exit zero and empty input/page errors. Ordinary user quit remains permitted after recording incomplete cleanup. The earlier exit-zero oUpnWZ run with plugin timeout logs is an incomplete-shutdown baseline, not an accepted successful shutdown.

Targeted coverage includes retirement after current/pending removal, a completed retirement timeout remembered at quit, Electron listener removal ordering, status/exit audit propagation and a zero-code child with a nonempty shutdown failure list. No IOCP root-cause resolution is claimed.
## In-flight startup during disposal

Starting activities are registered before the runtime factory can return and remain registered through readiness, cancellation and cleanup. Disposal marks the host disposed and closes existing instances first, then waits for the registered startup activities. This ordering lets runtime disposal reject a pending waitReady instead of deadlocking by waiting for readiness before closing.

A runtime returned after disposal starts is never attached as a new world; its owned cleanup must finish before disposal succeeds. A rejected factory remains rejected for its original caller; no returned resource is invented. If late cleanup fails, retirement failure is preserved. A factory/startup that has not completed after the finite ten-second shutdown budget rejects with GODOT_STARTUP_CLOSE_TIMEOUT. Repeated dispose calls retain that same failure, even if a late runtime is subsequently cleaned. Elapsed time never proves cleanup.

Controlled tests cover pending factory plus gated cleanup, factory rejection, late cleanup rejection, cancellation while waiting for ready, and a sticky startup timeout with late cleanup. A real local HTTP runtime confirms the late-created origin is closed before successful disposal. Full-client validation remains separate and the prior IOCP cause is not determined.