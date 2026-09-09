# ADR 0311: Keep the world central and the conversation on the right

Status: Accepted for downstream Craftmine implementation, 2026-09-09.

The player requested a central world, a complete conversation on the right and
retained play progress. The existing right resource dock made the world secondary
to the transcript. This changes the presentation of the Craftmine World tab only.

CSS reorders the mounted sidebar, native-view placeholder and conversation.
Their identities and the native plugin-view instance remain unchanged. The
conversation has its own saved width (400 px by default, bounded to 360–640 px),
independent of retained PI resource-panel widths. The separator stays inside the
conversation so the native game cannot cover its hit area. Pointer cancellation
restores the initial width; keyboard arrows and Home/End provide the equivalent
user-operated control. Double-click restores the default.

Play expands the existing world and hides the mounted conversation. Returning
restores its width. Settings, file/review tabs and subagent detail retain ordinary
PI presentation. No Agent, world, task or save identity is inferred from layout.

Below 1100 px, entering the world workspace or crossing the breakpoint collapses
the sidebar; its existing control can reopen it. Below 760 px, the world and chat
use two rows, preserving both surfaces. Native bounds are measured after resize
and layout events. This adds no native protocol or database schema.

Validation uses real React components with fixture session and native-view
transport, plus the independent native offscreen lifecycle runner. Such captures
do not prove visible desktop composition or physical input behavior. Godot
integration is an independent milestone; this layout initially uses the legacy
world runtime.
