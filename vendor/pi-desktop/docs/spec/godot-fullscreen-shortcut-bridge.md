# Godot view fullscreen shortcut bridge

`GodotWorldViewHost` accepts an optional `onFullscreenShortcut` callback with
only `toggle` or `exit`. Main owns the window action. Neither action closes,
saves, reloads or changes a world. No generic renderer window-control API is
added.

The native F11 handler uses the shared shortcut policy. Plain keydown toggles;
repeat is consumed without toggling. Modifiers, composition and keyup are not
intercepted. The view must be the alive, currently displayed formal/candidate
instance, be attached to this host's window, and have both surface visibility
gates enabled. Old, hidden, detached and still-preparing candidates cannot act.

The isolated preload installs the shared trusted Escape listener. It reserves
menus, editing, IME, pointer capture and consumed events. A permitted Escape
sends only its fixed four-field runtime scope over the private fullscreen-exit
channel. Main validates exact scope, top frame and displayed instance, then
invokes only `exit`. The page's exposed craftmineRuntime object is unchanged.
Detach/pagehide disposes the listener and invalidates pending callbacks.

Tests use controlled event emitters and pure policy decisions, not OS key
injection. They do not prove that a real Godot canvas leaves Escape unconsumed.
If the engine consumes it, the conservative handler leaves it consumed; this
must remain an explicit integration/manual verification boundary.
