# Craftmine immersive creation renderer

The existing world workspace has `create` and `play` presentation modes. Play
adds `closed`, `compact`, and `full` creation states. Entering either mode closes
the overlay. Existing stored layouts migrate to `closed`; the create/play choice,
chat width, world-panel widths and auxiliary expansion preferences remain intact.
A world becoming active enters play by default, once per world: the automatic
switch is recorded against that world and states no preference, so a reload, an
ordinary re-render or an explicit return to create is never overridden by the
same activation. The visible 游玩/创作 controls are the only writers of the
stored preference.

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
`craftmineSetImmersion({ active, overlay, overlayBounds, blocked })` to Main so Main can
enforce the world input boundary and native view clipping while bounds settle.
Main owns world identity, input blocking and any supported pause reasons.
The renderer clears active immersion during navigation and unmount. Blocking
sheets/search retain active immersion and add `blocked`, preserving the gameplay
input/pause boundary while a modal is open. Changes between compact and full do
not publish an intermediate inactive state. Host errors are shown in the open
creation surface. Visible composer picker bounds extend the exclusion rectangle
when they exceed the compact strip.
Exclusion bounds are clipped to the viewport so partially offscreen pickers in
short windows cannot send negative native coordinates.

F2 toggles compact chat; Shift+F2 toggles the full workbench. Escape dismisses
an open creation surface only after IME, pointer lock, menus, pickers and other
dialogs have yielded, and a further Escape with no overlay left returns to the
workbench (`exit-play`). Leaving play is a presentation change: it keeps the
world, conversation, draft and a running task, and it states no preference.
Consumed keys and repeats do nothing. Main forwards these finite shortcuts from
native child surfaces through `onCraftmineImmersionShortcut`; they are
application scoped, never global. Visible compact, full, close and
return-to-create controls remain available in every state that a key can reach.

The shared composer includes the reusable `VoiceInput` control while a world
creation surface is visible. A final transcript appends plain text to the same
draft, preserving attachments and prior text; it never sends a prompt. Session,
workspace and host world-change events invalidate recording context. Closing
creation, opening a blocking sheet, navigating away, entering IME composition or
requiring plan approval cancels/disables the voice control. Recognition errors
and unavailable recognition are handled by the voice component without blocking
the existing text input.

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
6. With a fake recognition adapter, deliver a final transcript into an existing
   draft with attachments. Verify both compact and full expose the same text and
   no prompt is submitted. Switch world/session or close the overlay before a
   delayed result arrives; the result must not be appended to the next context.

Pure state checks may run without UI input. Browser acceptance must use an
independent headless process/profile with `requestPointerLock` disabled and
page-script state transitions, without mouse/keyboard/click/fill simulation.
Microphone recording is outside renderer-layout validation.
