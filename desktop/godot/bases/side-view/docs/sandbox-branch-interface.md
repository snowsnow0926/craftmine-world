# Diggable sandbox: branch interface proposal (NOT implemented)

Status: **proposal only**. No sandbox code exists in this base, no terrain
editing, no chunked storage and no material economy. A16 (dig, place, save,
reopen) is **not** claimed and must not be read out of this document.

The metroidvania path and a Terraria-style sandbox share only part of the
side-view foundation. The plan (`docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md`,
section 6.1) says they are separate goals and that the sandbox is its own
stage. This file exists so the shared surface is written down before anyone
builds it, and so it is not smuggled into the ability-gate work.

## 1 What already is reusable

| Capability | Where | Reusable as-is? |
| --- | --- | --- |
| gravity, jump, platform collision, camera | `scripts/player/side_view_player.gd`, `scripts/world/room.gd` | yes |
| checkpoint, respawn, hazards | `scripts/world/checkpoint.gd`, `scripts/world/hazard.gd` | yes |
| persistent keyed state, atomic save | `scripts/runtime/world_state.gd`, `scripts/runtime/save_store.gd` | yes, but the sandbox needs chunked payloads |
| room transitions | `scripts/world/room_manager.gd` | partially: a sandbox streams regions instead of loading one room scene |
| attack hitbox | `scripts/player/side_view_player.gd` | yes |

## 2 What a sandbox branch must add (interface sketch)

```text
craftmine.godot-sideview-sandbox-world/1
  regionSize            tile edge length in pixels, power of two
  chunkShape            [cx, cy] chunk dimensions in regions
  materials             id -> { hardness, drop, solid }
  regions               sparse map "cx,cy" -> tile array (RLE or palette)
  edits                 ordered edit log for replay and audit
  stateVersion          its own version, separate from the base

craftmine.godot-sideview-sandbox-state/1
  edits                 applied edit log (append-only, idempotent by editId)
  inventory             material id -> count
  chunks                dirty chunk list for incremental persistence
  stateVersion          separate from the base
```

Required runtime interfaces (not present yet):

- `TerrainService.set_tile(region, cell, materialId)` — the only mutation path,
  validated against `materials` and the player's reach.
- `TerrainService.get_tile(region, cell)` — read-only, used by the probe.
- `ChunkStore.save_dirty()` / `load(region)` — incremental, atomic per chunk,
  with a manifest hash per chunk.
- `InventoryService.consume(materialId, count)` / `grant(...)` — no negative
  counts, no implicit conversion.
- `Probe` extension reporting region bounds, dirty chunks, inventory counts and
  a `stateHash` over the edit log.

## 3 Explicit non-goals for the first sandbox stage

- infinite or procedurally unbounded worlds; a finite authored map first
- multiplayer, lighting propagation, liquids or physics materials
- reusing the ability-gate acceptance matrix as sandbox evidence

## 4 Open questions before implementation

1. Tile size and chunk shape: needs a measured frame/CPU budget on the pinned
   engine, not a guess.
2. Storage format: sparse palette vs RLE per chunk; decide by measured size of
   an authored 1024×512 map.
3. Where edits live relative to task B's source revision model: an edit log is
   player state, not source, so it belongs beside the save, not in the build.
4. Whether the sandbox keeps the one-room-at-a-time model or streams regions;
   the current room manager frees a room on transition, which is the wrong
   lifecycle for digging.
5. Acceptance: A16 needs its own frozen assertions (terrain delta, material
   accounting, reopen equality) plus a real headless run, separate from the
   side-view gate matrix.

## 5 Next step if this branch is scheduled

Open a separate task with its own worktree, branch, spec and acceptance matrix.
Do not extend the side-view base in place: the base must stay a verified,
bounded deliverable for the ability-gate story.
