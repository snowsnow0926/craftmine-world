# Private native input segments in the ordinary desktop

The validated offscreen acceptance controller accepts parent-process IPC methods
`inputSegment` and `cancelInputs`. They are not renderer IPC, plugin panel calls,
model tools or production gameplay authoring APIs. Normal processes never install
the controller. Existing profile token, dedicated test directory, parent IPC,
hidden/unfocused/unfocusable/offscreen owner and non-evaluation-profile guards
must all hold before use.

The envelope is exactly `{type:"craftmine-headless",id,method,payload}`.
`inputSegment.payload` is exactly `{identity,segment}`; `cancelInputs.payload` is
exactly `{identity}`. Identity has only worldId/buildId/instanceId and must match
the actual current formal runtime. Segments retain the existing finite schema:
up to 16 distinct named keys, three buttons, optional bounded relative motion,
1–600 wait frames, 0–600 settling frames, optional capture. Arbitrary event
programs, JavaScript, source, actor positions and state assignments are rejected.

The standalone Codex gameplay service and ordinary desktop now share the same
controller implementation. Delivery uses existing
`GodotWorldViewHost.headlessGameInput` and its fixed `headless-game-input` page
program. It dispatches DOM events only within the owned Godot canvas, never OS
input or `webContents.sendInputEvent`. Canvas focus is suppressed and a changed
focus/pointer-lock guard produces policy-blocked evidence.

Key/button downs are recorded before asynchronous delivery. A `finally` sends
releases for every possibly delivered down, including lost delivery replies and
runtime/check errors. Cancel bypasses the outstanding native wait to send
releases. Unconfirmed releases retain a busy controller until explicit drain
succeeds. Private navigation/panel/mode/close/quit requests drain first; normal
quit preparation also drains before saving/freezing or disposing the world.
Parent disconnect attempts cleanup and then normal application shutdown; cleanup
failures are included in the shutdown audit rather than claimed as released.

Segments return sequential before/during/after snapshots, observations, native
frames and diagnostics when available. The during sample is taken before release.
Sampling/rendering may advance real physics between these reads: requested wait
frames are finite scheduled work, not a claim that samples share one tick or an
additional model/whole-turn budget. Returned `semanticSuccess` remains null.
Failure retains partial evidence and whether any release remains unconfirmed.

The test operator mailbox exposes `input-segment` with an explicitly supplied
identity and segment, plus `cancel-inputs`. It records raw images with hashes and
keeps result status separate from task/goal acceptance. While a segment is
outstanding, its independently watched `activeInput.cancelFile` requests input
cancellation without cancelling the model or closing the desktop. The full
operator cancel file also releases inputs before normal shutdown.

## Validation

Contract tests cover private-only routing, owner visibility/focus, unavailable
worlds, foreign identities, finite/unknown fields, before/during/after evidence,
error-path release, concurrent cancellation and retryable release failure. The
existing standalone gameplay lifecycle tests continue against the shared module.
These fixture checks are not native event-consumption or player acceptance.
Final acceptance must use the actual ordinary packaged desktop, real authored
aircraft/weather handlers, measured physics and save/cold-reopen evidence.
