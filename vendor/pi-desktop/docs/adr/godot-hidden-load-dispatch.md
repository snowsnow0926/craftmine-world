# Dispatch initial state without an animation-frame dependency

Date: 2026-09-10. Status: implemented, isolated renderer verification.

A new first-person authored export on Electron 43.4.0 reached ready in a native
detached WebContentsView, received a host load request, and timed out without a
response. The same export in an offscreen child completed load. Disabling
background throttling and attaching the native child to the hidden owner did
not remove the timeout. No window was shown or activated in these comparisons.

The Godot bridge previously only appended incoming requests; `_process` owned
their execution. Starting the same guarded queue drain from the receive callback
removes this frame dependency without showing a candidate or changing gameplay
timing. Four bases then completed native and offscreen load/restore checks.
The expected pre-resume snapshot is compared with the actual load response:
comparing a later running snapshot would incorrectly fail a falling mining player.

The WebGL zero-sized framebuffer warning alone is not the diagnosis. A detached
surface may remain zero while a valid load completes; visible composition is a
separate check. The user's world files were not inspected, so this reproduces a
mechanism and the reported error string, not the exact user's saved scene.
