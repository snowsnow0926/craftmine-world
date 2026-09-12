# Craftmine world input presentation (FB03)

## Contract

The normal native world can completely cover the application renderer. Native
input ownership must therefore be published independently of animation frames.
F2 opens the compact conversation; Shift+F2 opens the full conversation. The
renderer publishes the overlay state immediately, with no measured bounds yet.
Only geometry measurement waits for a paint. The host preserves the world
rectangle while raising the application layer and pausing world input.

Forwarding a shortcut does not focus the still-covered application renderer.
The existing main-layer owner policy transfers focus after the overlay state is
committed, only within an already focused normal application window. Background
and headless windows do not acquire focus. Inactive or blocked immersion and
destroyed owners do not receive forwarded shortcuts.

The scoped world preload hides the canvas cursor during focused, visible play.
Opening a conversation, blocking play with pause/settings, losing focus, or
making the document hidden restores the cursor. Detaching the world removes the
override and restores authored CSS. This presentation rule requires no click,
Pointer Lock permission, new renderer-to-main capability, or world/PCK update.
It does not claim to change camera motion or mouse capture behavior.

## Regression evidence and boundary

- `apps/desktop/test/main-window-layers.test.mjs` exercises normal focused owner
  ordering with pure native-layer objects, plus background/headless scope rules.
- `tests/fb03-input-presentation-headless.mjs` (repository root) runs the real
  React immersion and layout hooks with animation frames deliberately never
  delivered. It pairs those hooks with the actual main-layer policy and checks
  F2/Shift+F2 ownership transitions and computed canvas cursor styles. Focus
  state is a fixture fact; all focus and Pointer Lock methods are forbidden.
- Existing immersion policy/shortcut tests preserve composition, modifier,
  pause, and covered-chat boundaries.

These regressions cover the normal scheduling branch that offscreen native
tests previously missed. They are not a claim of physical keyboard/mouse player
acceptance. Final integrated package verification and player retest remain
separate evidence layers.

## Normal world staging

A normal world renderer stays attached behind the trusted application renderer
with a nonzero viewport while its retained snapshot is restored. After navigation
the host explicitly applies `setBackgroundThrottling(false)` to the loaded
RenderWidget; constructor preferences alone did not restart that widget in the
normal hidden-window reproduction. Layout, surface visibility, and immersion
updates preserve this background attachment. Preparing worlds are excluded from
native input ownership and remain below the application renderer, including when
closed play normally lowers the application renderer. Explicit preview or
promotion releases that background designation. Disposal removes the native view.

`cancelStaging(worldId)` only cancels an in-flight stage attempt for that world.
It marks cancellation before runtime creation, aborts an owned runtime's pending
startup request when present, and waits for that attempt's cleanup. It does not
close the formal world, adopt a candidate, cancel another world, or perform the
coordinator's durable transaction recovery. A completed stage is outside this
API's scope and returns `false`; its coordinator still checks cancellation before
confirmation.

The root-level `tests/fb03-normal-staging.mjs <read-only-profile>` fixture copies
the player's FB03 world export and snapshot into its own directory. It uses a
hidden, non-focusable `BaseWindow` with normal `WebContentsView` rendering and
forbids focus, activation, physical input, and Pointer Lock. It exercises repeated
layout changes during restore, exact snapshot recovery, preview, promotion, and
native retirement. `--cancel-on-load` additionally proves early cancellation,
cancellation during real load, preserved formal instance/snapshot, and successful
retry. No original player profile writes occur.

## Full application normal-rendering acceptance

The already protected `headless-profile.json` marker may opt into
`rendering: "normal"`. The same isolated-directory, token, and connected parent
IPC requirements still apply. Only renderer construction changes: the application,
plugin view, and formal/candidate world use normal compositing. Build verifiers
retain their independent offscreen rendering. Omitted rendering preserves the
existing offscreen test behavior; unknown rendering values are rejected.

Normal acceptance does not disable any activation, focus, keyboard/mouse,
external dialog, notification, or Pointer Lock guard. Every window remains
hidden and unfocusable. It does not force continuous frames on the application
renderer: overlay tests must still tolerate an occluded application's suspended
animation callbacks. An offscreen-only capture API remains offscreen-only; use
the ordinary scope-checked product capture route for normal-rendering evidence.
