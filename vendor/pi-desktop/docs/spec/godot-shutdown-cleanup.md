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
