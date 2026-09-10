# Wait for the host-core child and its pipes

The existing host-core shutdown waited for `exit`, then ignored the result of
its final forced-exit wait. It could return success with unclosed owned pipes or
without a terminal event. This is a separately confirmed lifecycle omission;
it does not establish the cause of earlier native IOCP crashes.

Use ChildProcess `close` as the completion boundary while preserving the
existing EOF-first three-second grace and one-second forced termination budget.
Only request forced termination if exit has not already been observed. Reject
explicitly on a missing terminal event and share that result across callers.
Normal application quit may still proceed after recording the failure; tests
must not report successful cleanup from the application's exit code alone.
