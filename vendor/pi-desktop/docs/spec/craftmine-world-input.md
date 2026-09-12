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
