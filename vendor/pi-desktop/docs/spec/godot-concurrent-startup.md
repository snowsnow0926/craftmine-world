# Concurrent Godot startup and graphics diagnostics

The private live-world helper uses Electron's platform graphics selection, as
the normal desktop does. It must not equate offscreen rendering with disabled
hardware acceleration or force an ANGLE software backend. Its windows remain
offscreen, hidden and non-focusable, with all existing input, sandbox, network,
profile and native receipt checks enabled. Operator diagnostics report the
actual acceleration setting, ANGLE switch (or `platform-default`) and Electron
GPU feature status. These report configuration/capabilities, not player feel.

On the observed Windows/Electron 43.5.0 component set, forcing SwiftShader
allowed an isolated city check but stalled the same immutable export while
another city runtime remained alive. The default graphics backend completed
the normal preview and fresh candidate application. This is a reproduced
configuration failure; the internal driver/engine lock has not been identified.
An unavailable or failing graphics backend remains a real startup failure.

The shared `GodotWorldViewHost` keeps a startup phase and counts native paint
events until completion. A failed startup freezes this evidence before
retirement and appends the renderer PID, offscreen/painting/throttling state,
and a fixed read-only page probe. The probe waits at most 500 ms in the host;
an unresponsive or destroyed page cannot mask the original failure or block
retirement. It returns only known document/visibility enums, finite canvas
dimensions and whether a real animation-frame callback arrived. It reads no
page URL or status text and sends no runtime commands. Paint counts and probe
responses never satisfy engine readiness, loading or application assertions.
Successful startup removes the paint listener without probing page JavaScript.

No renderer reordering, extra staging window, longer startup deadline, engine
or source upgrade, candidate registration shortcut or fabricated ready event
is part of this fix. The previous runtime is still checkpointed and retained;
only Core-confirmed application permits promotion. Cancellation and failure
retire only pending resources and leave the same formal instance recoverable.

See [the decision and local evidence](../adr/godot-concurrent-startup-20260913.md)
and [the acceptance scenarios](06-delivery/godot-concurrent-startup-e2e.md).
