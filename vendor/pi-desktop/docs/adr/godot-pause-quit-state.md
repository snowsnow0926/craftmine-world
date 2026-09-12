# Observe checkpoint completion instead of the quit request acknowledgement

Status: accepted for the September 13 Godot reliability repair.

The pause menu previously submitted `app.quit` through a synchronous native menu
action and only handled an invocation rejection. The actual confirmation and
world checkpoint ran later in `before-quit`; a checkpoint failure could only show
a toast while the menu had no indication that saving was pending. Repeated clicks
and Resume remained available during that operation.

Keep the existing request and shutdown ordering. Add a host-owned lifecycle event
with attempt identity so the renderer can represent confirmation, saving and
recoverable failure accurately. The event grants no new write authority. An ACK
is not completion, and the menu only unlocks when the authoritative attempt is
cancelled or failed. This keeps failure recovery usable without adding a force
exit path or discarding unsaved world state.
