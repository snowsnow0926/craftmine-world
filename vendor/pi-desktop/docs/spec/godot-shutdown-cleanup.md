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
