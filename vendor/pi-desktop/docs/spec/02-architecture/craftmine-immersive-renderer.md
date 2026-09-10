# Craftmine immersive creation renderer

The existing world workspace has `create` and `play` presentation modes. Play
adds `closed`, `compact`, and `full` creation states. Entering either mode closes
the overlay. Existing stored layouts migrate to `closed`; the create/play choice,
chat width, world-panel widths and auxiliary expansion preferences remain intact.

The existing `ChatSurface`, its composer draft, retained transcript panes and
`WorkPanel` stay mounted when changing overlay levels. No overlay transition
creates a session, submits a prompt, opens another world or aborts a task. The
existing composer retains the explicit send and stop actions. Task execution is
independent of the overlay presentation, and the closed state's toolbar reports
an active conversation task.

Compact reserves a bottom strip for the same chat surface. Full reserves a right
column for the full conversation beside existing world tools; narrow windows use
two rows. These are real, non-overlapping native surface rectangles, not a
transparent overlay drawn above Electron child views. Existing `PluginViewTab`
measurement continues reporting plugin bounds. The renderer reports
`craftmineSetImmersion({ active, overlay, overlayBounds })` to Main so Main can
enforce the world input boundary and native view clipping while bounds settle.
Main owns world identity, input blocking and any supported pause reasons.
The renderer clears active immersion during navigation, blocking sheets/search,
and unmount. Host errors are shown in the open creation surface.

F2 toggles compact chat; Shift+F2 toggles the full workbench. Escape dismisses
an open creation surface only after IME, pointer lock, menus, pickers and other
dialogs have yielded. Consumed keys and repeats do nothing. Main forwards these
finite shortcuts from native child surfaces through
`onCraftmineImmersionShortcut`; they are application scoped, never global.
Visible compact, full, close and return-to-create controls remain available.

## Integration E2E scenarios

1. Open an existing world and a conversation, start a task and type an unsent
   draft. Enter play, open compact, switch full, close and reopen. Verify the
   world/save identity, session, transcript scroll, draft and task identity remain
   the same; closing never stops the task or sends the draft.
2. Compare actual native plugin/world bounds against the measured chat region
   after each transition and a resize. They never cover the reserved chat strip
   or column. Closed restores the world workspace. Narrow full uses two rows.
3. Exercise the pure F2/Shift+F2 state decisions. In an authorized interactive
   acceptance pass, repeat from native world focus. Repeats and unsupported
   modifiers do not toggle; application blur leaves other programs untouched.
4. With IME composition, autocomplete, a model menu, a search dialog or pointer
   lock active, Escape dismisses that layer first. A subsequent Escape closes
   creation. Only a later unconsumed Escape can exit OS fullscreen.
5. Deny or fail the native presentation API. Verify an error appears and no
   fabricated successful gameplay or pause state is shown. Navigate to Settings
   or change the active work panel; Main clears the immersion input reason.

Pure state checks may run without UI input. Browser acceptance must use an
independent headless process/profile with `requestPointerLock` disabled and
page-script state transitions, without mouse/keyboard/click/fill simulation.
Microphone recording is outside renderer-layout validation.
