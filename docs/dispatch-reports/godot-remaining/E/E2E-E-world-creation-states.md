# E2E scenario fragment (E): creating a world and watching it become playable

Unique task id `E-world-creation-states`. Merge target:
`vendor/pi-desktop/docs/spec/06-delivery/04-e2e-test-plan.md`. English.

## Scenario: create a world from a delivered base and observe real initialization

Given the client is open on the world-first workspace, and the host reports at
least one `delivered` base and one `delivered` start point.

1. Open the new-world form from the left column.
   - Expected: only delivered bases and start points are selectable; planned
     entries are visible, disabled and never submitted.
2. Choose a base and either the blank start or a delivered sample, type a name
   and submit.
   - Expected: the form closes only after the host accepted the request. A
     rejected request keeps the form open with the host's error text and the
     entered name.
3. If the host reports `state: "initializing"` for the new world:
   - Expected: the row appears immediately with the host's current stage and
     progress, is marked not playable, and the running world is **not**
     switched. No `world.switch` is sent for the unfinished world.
   - Expected: polling stops when the host reports `ready` (or `failed`), at the
     bound, or on unmount; the row then becomes playable without an automatic
     switch.
4. If the host reports `state: "failed"` with an error:
   - Expected: the row shows the host error message and code, and recovery
     buttons appear only for the actions the host listed and only when
     `createOptions.createActions` is true.
   - Expected: `retry` / `discard-draft` send exactly `world.creationAction
     {worldId, action}`; `details` expands the reported stage list locally.
   - Expected: a failed world is never shown as playable, and clicking it only
     explains why instead of sending a switch.
5. Switch to the new world only after it is playable.
   - Expected: the managed switch freezes and saves the previous world first; a
     failed save leaves the previous world and its progress intact.
6. Restart the plugin and the Rust core.
   - Expected: both worlds are still listed with their real state; an
     interrupted initialization does not come back as `ready`.

Automation: `tests/godot-remaining/e/world-create-e2e.mjs` (real React panel,
real navigation gateway, real retained plugin view, real Rust core, plugin/core
restart) and `tests/godot-remaining/e/create-flow-ui.mjs` (contract fixture for
the states the current host cannot yet produce). Both run in a headless browser
with an isolated profile and data directory, disable pointer lock, never send
mouse or keyboard input, and assert that no page requested pointer lock or
focus.
