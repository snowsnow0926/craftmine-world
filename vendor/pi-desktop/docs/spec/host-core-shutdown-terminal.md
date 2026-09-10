# Host-core shutdown terminal event

HostProcess disposal sends stdin EOF before rejecting pending RPCs. It waits up
to the existing three-second graceful budget for Node ChildProcess `close`,
which includes stdio closure. Process `exit` alone cannot complete disposal.

If that budget expires and no exit has been observed, only the owned child is
sent the existing SIGKILL fallback. A further one-second wait must observe
`close`; otherwise all disposal callers receive `HOST_CORE_CLOSE_TIMEOUT`.
An already exited process is not killed again while its pipes are closing.
Concurrent and later disposal calls share the same completion or failure.

The close listener is installed immediately after spawn and is not removed by
transport cleanup or exit notification. Spawn failure followed by close is also
a terminal boundary. This does not change host RPC availability or error tags.

Validation uses the actual class with controlled lifecycle events plus a real
independent Node child that exits on EOF. Missing close after either a normal
exit or a kill request must fail; a kill return value never substitutes for
process/pipe closure. Full-client acceptance additionally records host shutdown
failures and requires them to be absent.
