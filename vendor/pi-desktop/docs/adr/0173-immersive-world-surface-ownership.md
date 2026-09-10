# ADR 0173: Immersive world surface ownership

Status: accepted for the first existing-world immersion slice, 2026-09-11.

## Decision

The existing chat, composer, task and world remain mounted while play mode
switches between closed, compact and full creation presentations. This is a
presentation transition, not another session or agent turn.

Electron child views render above renderer CSS. The main renderer reports a
bounded exclusion rectangle through `craftmineSetImmersion`; Main clips native
plugin and Godot surfaces outside it. Compact reserves a bottom strip; full
reserves a right column or, in narrow windows, a second row. Temporary pickers
extend the rectangle and blocking main dialogs hide native content. Missing
geometry hides content until a valid measurement arrives. Coordinates never
authorize a world identity: the existing host-selected runtime remains owner.

The runtime pause controller keeps overlay and manual/checkpoint intent
separate. Every exact runtime serializes pause/resume acknowledgements, and
detached instances reject late transitions. A failed pause cannot trigger an
automatic resume. Failed save/replacement recovery restores a formerly running
world only if no later manual pause/resume intent superseded that operation.

Godot input is suppressed in its isolated preload while creation owns input.
Opaque legacy game frames are inert and reject pointer input; their scoped
runner receives an independent immersion hold that preserves save freezing.
Plugin workbench controls remain usable. Neither path requests Pointer Lock.

F2 and Shift+F2 open creation from a displayed native surface. Plugin Escape
uses its existing scoped preload path after menu/IME handling; Main then closes
the creation overlay before exiting fullscreen. F11 remains available. Native
key actions may transfer content focus within an already focused window only;
headless validation prohibits that transfer and all OS input.

Local voice has separate, additive main-renderer IPC (ADR 0172). The microphone
grant is one-use, audio-only and main-frame/document scoped. Trusted main-frame
sanitized clipboard writes remain permitted; world/plugin media permissions
remain denied. No host-core schema or public runtime protocol version changes.

## Boundaries

This slice does not introduce the planned creation-sandbox base, placeable object
editing, arbitrary new gameplay logic, or incremental world rebuilds. It does
not claim live speech accuracy or improved model first-pass success. These need
their own implementation and player validation.
