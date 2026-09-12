# Pause-menu save and exit recovery

`nativeMenuAction("quit")` acknowledges an exit request before the asynchronous
confirmation and checkpoint sequence completes. Its successful reply must never
clear the pause menu's pending state or claim that progress was saved.

The host publishes `pi-desktop/craftmine/quitState` with a monotonically increasing
`attemptId`, phase `confirming`, `saving`, `failed` or `cancelled`, and an optional
safe player-facing error. The existing ordered quit sequence owns these facts.
Successful application exit needs no final event. The existing confirmation
dialog remains the user's cancellation control; no extra cancellation protocol
or forced exit is introduced.

The pause menu locks Save and exit, Resume, Settings and Workbench while a request
is pending. Its synchronous guard also rejects a repeated callback before React
paints. Escape is consumed without resuming during this interval. `failed` and
`cancelled` restore the normal controls while keeping the pause visible. A failed
checkpoint shows an actionable explanation; it never closes the world or asserts
successful persistence. A transport rejection before any lifecycle event permits
retry with a generic explanation, without exposing private diagnostic paths.

Older attempt events cannot release a newer pending action. After a host saving
event, a delayed rejection from the original request cannot override that state.
The component subscribes through the existing whitelisted preload event API.

The isolated React regression uses the real component and API subscription with
finite acknowledgements and lifecycle events: early ACK, immediate duplicate,
blocked Escape/navigation, confirmation cancellation, stale attempt, checkpoint
failure/retry and delayed transport failure. The immersion/pause regression also
checks that Escape resumes normally after confirmation cancellation. Main-process
event wiring and real native persistence need separate integration evidence.
