# FB01-004: bounded fullscreen shortcuts

Windows default F11 toggles the existing application window fullscreen state.
Repeated keydown events must not repeat the transition. Existing configured main
renderer keybindings remain supported; the Godot child-view default uses a finite
native F11 policy, not a global shortcut registration.

Escape means exit fullscreen only. It never closes the client, leaves play,
recreates a world, changes source/progress or claims that hiding a surface saved
anything. `NativeMenuAction.exitFullScreen` is an explicit idempotent window action
implemented by Main as `setFullScreen(false)`. Do not implement exit as toggle.

The shared helper lives at apps/desktop/shared/world-fullscreen-shortcuts.ts:

- `nativeFullscreenKeyDecision(input)` accepts only unmodified non-composing
  F11 keyDown. Auto-repeat is consumed without a transition. Other keys, including
  Escape, are left alone by this native policy.
- `attachFullscreenEscape(window,{onExit,onError})` captures the current layer
  and defers the final decision until bubble handlers have consumed the event.
  Only trusted, unmodified, non-repeated Escape may reach onExit. IME, visible
  dialog/menu/listbox/popover, native picker/search editing, pointer capture and
  defaultPrevented retain their layer. Plain chat text alone does not consume
  Escape; autocomplete and IME still do. Closing a menu or releasing pointer
  capture cannot also exit fullscreen on the same event.
- Disposal removes handlers and invalidates queued requests; blur also invalidates
  a queued request. Requests are single-flight and failures remain reportable.

The helper never requests/releases pointer lock, injects input, focuses a window,
or posts arbitrary runtime commands. Native game menu consumption is respected;
if the actual engine consumes all Escape events, support must not be claimed from
the policy fixture alone or obtained by ignoring defaultPrevented.

Integration owners:

- P3: App renderer hookup, layout controls, finite helper and NativeMenuAction
  enum entry. The full-screen control shows returned/broadcast actual window
  state, busy/error state, and the F11/Escape layer instructions.
- P1: Godot host/preload hookup. Host before-input-event must accept only the
  current actually presented view. Preload Escape goes through the private fixed
  `pi-desktop/godot-world/fullscreen-exit` channel with its immutable scope; the
  host checks sender, scope, current instance and visibility. The only accepted
  action there is exit. Do not add this to authored craftmineRuntime messages.
- P10: Main `exitFullScreen` implementation and host constructor callback
  `onFullscreenShortcut(action:'toggle'|'exit')`, always operating on the owning
  non-destroyed window. Legacy plugin/voxel panel webContents need their own
  trusted hookup; a top-level React listener cannot observe iframe key events.

Evidence is split: direct pure-policy/listener fixtures; real React/headless DOM
with a finite window-service fixture; shared helper strict TypeScript; historical
keyboard-source regression tests; later common client/actual window transitions;
and manual keyboard, IME, DPI/multi-monitor/player experience. No synthetic input
test is permitted to stand in for actual trusted OS keyboard handling.
