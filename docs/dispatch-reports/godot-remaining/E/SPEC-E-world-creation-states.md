# Spec fragment (E): world creation and initialization state

Unique task id `E-world-creation-states`. Merge target:
`vendor/pi-desktop/docs/spec/08-craftmine-domain.md`, section
"Product service and world panel" (after the existing panel channel list).
English, matching the surrounding spec.

## World list and creation contract

The left column renders only host facts. `world.list` returns
`{worlds: WorldEntry[], activeWorldId}` where every `WorldEntry` carries
`id`, `title`, `revision`, `updatedAt`, `base {id, label, description,
delivered} | null`, `origin`, `check {status, at} | null`, `state` and
`creation | null`.

- `state` is `ready`, `initializing` or `failed`. A host that omits it means a
  playable world; the renderer never invents a non-ready state on its own.
- `creation` is present while a world is initializing or after its
  initialization failed:
  `{operationId, stage, stages[{id, label, status}], progress, error, actions}`,
  where `status` is `pending | running | passed | failed | skipped`, `progress`
  is a monotonic 0–100 integer reported by the host, `error` is
  `{code, message, stage, recoverable}` or null, and `actions` is a subset of
  `retry | choose-base | discard-draft | details`.
- A world is playable only when `state === "ready"`. The panel refuses to open
  or switch into any other world and explains why.
- `world.create {title, baseId?, starterId?}` returns
  `{id, title, state, creation?}`. When `state !== "ready"` the renderer does
  not switch into the world; the retained view keeps the previous world and its
  unsaved progress, and the list shows the host's real stage and progress.
- `world.createOptions` returns `{create, switch, createActions, bases[],
  starters[]}`. Each base and start point has `id`, `label`, `description` and
  `delivered`. Only `delivered: true` entries are selectable; planned entries
  stay visible and disabled and are never sent.
- `world.creationAction {worldId, action}` performs a host-reported recovery
  action. The renderer shows a recovery control only for an action present in
  `creation.actions` and only when `createActions` is true. The renderer never
  marks a failed initialization as passed and never fabricates a progress
  value or a stage label.
- While any world is `initializing` the panel polls `world.list` on a bounded
  interval (2.5 s, at most 120 polls) and stops when no world is unfinished,
  when the component unmounts, or at the bound; it then asks the player to
  refresh manually.

## Presentation rules

- Base and start-point labels come from the host. An unreported base renders as
  "base not reported"; a planned base renders as planned. Neither is upgraded
  to a real base.
- Unfinished worlds sort after playable ones and show the current stage and
  progress instead of a save recency.
- The auxiliary row for tasks additionally reports how many interrupted drafts
  the host says can be resumed (`task.recoverable`); when that read is not
  available the row keeps reporting only the bound task.
