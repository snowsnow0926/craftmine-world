# ADR (E): world creation is a durable, staged host operation

Status: proposed. Unique task id `E-world-creation-states`. The main task
assigns the final ADR number and merges this text into `docs/adr/`.

## Context

The world-first workspace can already list worlds, switch between them and
create a world, but the create call returned a finished record immediately.
That is only true for the existing web-voxel base. A Godot world needs a real
project materialized from a base, registered at revision 0, imported and built
once before it can be opened. Those steps can fail, can take minutes and can be
interrupted by a process restart.

The renderer must not guess any of that. It cannot advance a stage, invent a
percentage, decide that a failed import was fine, or open a world whose project
is half-written. It also must not offer a base the host has not delivered.

## Decision

1. **Creation is a durable operation with host-reported stages.** `world.create`
   returns `{id, title, state, creation?}`. `state` is `ready`, `initializing`
   or `failed`. `creation` carries `operationId`, the current `stage`, an
   ordered `stages[]` list with per-stage `status`, a monotonic `progress`, an
   optional `error {code, message, stage, recoverable}` and the `actions` the
   host can actually perform.
2. **`world.list` is the progress channel.** Each world entry carries `state`
   and, while unfinished, `creation`. The renderer polls the same read channel
   it already uses, with a hard bound, instead of requiring a new progress
   channel. A world that disappears from the list is simply gone.
3. **Playable means `state === "ready"`.** Only then may the renderer switch
   into the world. A non-ready row is listed with its real stage but refuses to
   open, and the controller refuses the switch even if called directly.
4. **Recovery is host-owned and host-reported.** `world.creationAction
   {worldId, action}` runs `retry` or `discard-draft`. The renderer renders a
   button only for an action the host listed in `creation.actions` and only when
   `world.createOptions` reports `createActions: true`. No button is invented for
   an unsupported path, and no failure is displayed as a pass.
5. **The host keeps the previous world.** A create whose result is not `ready`
   must not mount the new world; the retained view keeps the current world and
   its unsaved progress, and the list shows the initialization instead.
6. **Delivery is explicit.** `world.createOptions` marks each base and start
   point with `delivered`. Planned entries stay visible and disabled, so the
   route map is honest without pretending the base works.

## Consequences

- The renderer gains no second database, no local stage machine and no
  optimistic success path; every fact comes from the host.
- The host must persist creation state and make it idempotent, because the
  renderer may reload or restart mid-initialization.
- The player sees the real blocking step and the real error code, and can retry
  or discard a draft without leaving the current world.
- Adding a base requires only a delivered catalog entry plus the same staged
  operation; the UI needs no new branch.

## Alternatives rejected

- **Synchronous create that waits for the build.** Blocks the panel for minutes,
  has no progress, and cannot survive a restart.
- **A separate progress channel per creation.** Duplicates the list contract and
  adds another gateway allowlist entry for no benefit.
- **Optimistic `ready` with a later correction.** Shows an unusable world as
  playable and risks opening a half-materialized project.
- **Renderer-side stage animation.** Invents progress the host never reported.

## Validation

`tests/godot-remaining/e/world-create-e2e.mjs` drives the real React panel
through the real navigation gateway and retained plugin view into the real Rust
core, including a plugin/core restart. `tests/godot-remaining/e/create-flow-ui.mjs`
covers the states the current host cannot yet produce (planned bases, staged
initialization, failure, recovery actions, bounded polling) and asserts that no
switch is sent for an unfinished world.
