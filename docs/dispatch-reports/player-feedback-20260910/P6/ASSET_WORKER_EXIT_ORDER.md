# Asset worker cancellation and shutdown ordering

The prior runner returned cancel/timeout/error before the requested worker
termination was confirmed. The host's `cancel` also returned after signalling
abort. `dispose` awaited promises that could already have settled prematurely.
This is a local lifecycle race; it does not establish the cause of any Windows
IOCP/client shutdown error seen in another acceptance run.

All started-worker results now wait for the worker's `exit` event. Cancel,
timeout and worker error request termination and allow at most five additional
seconds for confirmation. Missing confirmation rejects with
`ASSET_PREVIEW_WORKER_STOP_TIMEOUT`, without a false `workerTerminated: true`
receipt. Confirmed forced-stop evidence records the actual exit code. Normal
success remains contingent on exit zero and the worker's real result.

Host cancellation waits for its active preview promise. Host disposal waits for
all active previews. An unconfirmed stop is latched even after the failed
request leaves the active map, prevents further worker creation, and is rethrown
by disposal. Ordinary decode failures are not promoted to shutdown failures.
Main must explicitly invoke `assetPreviews.dispose()` in its existing shutdown
sequence and retain failure evidence; that integration is owned by root.

Validation: eight tests passed (seven lifecycle cases plus the compiled-worker
test's five assertions). Actual worker success/cancel/timeout/crash each had an
observed exit before its result and `threadId === -1`. A finite, explicitly
simulated missing-exit case verifies the five-second bound even if `terminate()`
resolves. Host wait/latch cases use controlled dependencies. Four existing
worker/cancellation regressions also passed. Archived raw reports distinguish
these cases. No actual Electron shutdown or model request was run for this fix.
