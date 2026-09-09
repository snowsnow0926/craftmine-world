# Mining-sandbox base — behaviour specification (frozen)

Status: **frozen contract** for `desktop/godot/bases/mining-sandbox/`. The
implementation in `core/scripts/` and the independent acceptance matrix in
`tests/godot-remaining/G/a16-acceptance.mjs` both code against this file. A change
to any schema, reason code or assertion id below is a protocol change and must be
recorded in `docs/ADR-0001-mining-sandbox.md` first.

| Item | Value |
| --- | --- |
| `baseId` | `mining-sandbox` |
| `baseVersion` | `1.0.0` |
| `baseProtocolVersion` | `1` |
| Engine | `4.7.2-stable`, GDScript, `gl_compatibility` |
| World format | `craftmine.godot-mining-sandbox-world/1` |
| State format | `craftmine.godot-mining-sandbox-state/1` |
| Progress format | `craftmine.godot-mining-sandbox-progress/1` |
| Chunk format | `craftmine.godot-mining-sandbox-chunk/1` |
| Params format | `craftmine.godot-mining-sandbox-params/1` |
| Probe format | `craftmine.godot-mining-sandbox-probe/1` |
| Snapshot format | `craftmine.godot-mining-sandbox-snapshot/1` |
| State version | `1` |
| Reused foundation | `side-view` `1.0.0` (movement, body conventions, camera, input abstraction) |

## 1 World model

A world is a **finite** authored map. There is no infinite or unbounded
generation; `generation.mapSize` fixes the tile grid and the runtime never
invents tiles outside it.

- Grid: `tileSize = 16` px, `chunkTiles = [16, 16]` (params file, single source
  of truth).
- Tile coordinates are integers `(tx, ty)`, `0 <= tx < mapSize[0]`,
  `0 <= ty < mapSize[1]`.
- Pixel position of a tile's top-left corner is `(tx * tileSize, ty * tileSize)`.
- Chunk id of a tile is `"<cx>_<cy>"` with `cx = tx / 16`, `cy = ty / 16`
  (integer division). The last chunk on each axis is **partial** whenever
  `mapSize` is not a multiple of `chunkTiles`; a partial chunk holds only the
  tiles that exist.
- The player body is 12x26 px with its origin at the feet (see `docs/REUSE.md`).
- Materials are declared in `world.json`; `air` is always empty and never solid
  and is never declared as a material.
- **Spawn and entity resolution.** `initialProgress.player.tile` and every
  `entities[].tile` are resolved at load to the first non-solid tile in the same
  column at or above the declared tile. The resolved values are reported in
  `snapshot.player.tile` and `snapshot.entities[].tile`. If the whole column is
  solid the load fails with `bad_state`. A resolution that moved a declared tile
  is reported in `snapshot.rescue.resolvedTiles`.

## 2 Deterministic terrain generation

`generation.algorithm` must be `craftmine.deterministic-terrain/1`. Generation is
a pure integer function of `(seed, tx, ty, generation params)`; no floating point,
no engine RNG, no wall-clock, no iteration order dependence. Two fresh worlds with
the same `generation` block must produce byte-identical terrain.

Order of evaluation for every `(tx, ty)`:

1. `surfaceRow(tx) = baseRow + (hash3(tx, 0, seed) % (2 * amplitude + 1)) - amplitude`.
2. `ty < surfaceRow` -> `air`.
3. `ty == surfaceRow` -> `soilTopMaterial` (default `grass`).
4. `surfaceRow < ty <= surfaceRow + soilDepth` -> `soilMaterial` (default `dirt`).
5. `ty > surfaceRow + soilDepth` -> `rockMaterial` (default `stone`), or
   `deepRockMaterial` when `ty >= deepRockRow`.
6. `ty >= mapSize[1] - bedrockRows` -> `bedrock` (always last, overrides 2-5).
7. Ore veins: for each entry of `generation.ores` in declaration order, every host
   cell in `[minRow, maxRow]` whose material is in `hostMaterials` and whose
   `hash3(tx, ty, seed ^ (oreIndex + 1) * 7919) % 1000 < chancePerMille` is
   replaced by the ore material; the vein then grows `veinSize` cells through a
   deterministic 4-neighbour walk driven by
   `hash3(cursorX, cursorY, seed ^ (oreIndex + 1) * 104729)`. Veins never replace
   `air`, `bedrock`, or an already placed ore.
8. Caves: same walk rule with `generation.caves`; caves never touch or rise above
   the surface row and never replace `bedrock`.

`hash3(x, y, salt)` is defined once in `core/scripts/terrain_generator.gd`:

```gdscript
var h: int = x * 73856093 + y * 19349663 + salt * 83492791
h = (h ^ (h >> 13)) * 1274126177
h = h ^ (h >> 16)
return h & 0x7FFFFFFF
```

All arithmetic is 64-bit signed integer arithmetic; overflow wraps. The generator
exposes `terrain_hash()` = SHA-256 over the sorted list of
`"<tx>,<ty>,<material>"` for every tile, which is the determinism fingerprint.

## 3 Terrain mutation rules

`TerrainService.set_tile(...)` is the **only** mutation path in the whole project.
The probe, the player, the sample scripts and the tests all go through it.

Dig (`action = "dig"`) is rejected unless **all** hold:

| Condition | Reject reason |
| --- | --- |
| `(tx, ty)` inside `mapSize` | `out_of_bounds` |
| target material is solid | `not_solid` |
| material `breakable` is true | `unbreakable` |
| `toolTier >= material.requiredTier` | `tool_tier_too_low` |
| tile-centre distance from the player centre `<= reachTiles` | `out_of_range` |

On success: the tile becomes `air`, the material's `drop` item is granted once
(if `dropOnDig` and `drop.count > 0`), the chunk's revision is incremented, and the
chunk is marked dirty.

Place (`action = "place"`) is rejected unless **all** hold:

| Condition | Reject reason |
| --- | --- |
| `(tx, ty)` inside `mapSize` | `out_of_bounds` |
| target material is `air` | `cell_occupied` |
| the placed material is declared and `placeable` | `material_not_placeable` |
| inventory holds `material.placeCost` of `material.item` | `insufficient_materials` |
| tile-centre distance from the player centre `<= reachTiles` | `out_of_range` |
| the tile's AABB, grown by `buryMarginPixels`, does not overlap the player body | `would_bury_player` |
| at least one 4-neighbour is non-air, or the tile sits on the map floor | `not_adjacent` (only when `adjacencyRequired`) |

On success: the tile becomes the material, the item is consumed exactly once, the
chunk revision is incremented and the chunk is marked dirty.

## 4 Inventory, drops and crafting

- `InventoryService.grant(itemId, count, requestId)` and
  `consume(itemId, count, requestId)` are the only inventory mutations.
- Counts are integers; `count <= 0` is rejected as `invalid_count`; a consume that
  would go negative is rejected as `insufficient_materials` and changes nothing.
- `world.json` `items[]` declares `id`, `name`, `stack` (default `maxStack`),
  `toolTier` (default 0). `tools` in progress is the owned tool list; the equipped
  tool tier is `max(toolTier of owned tools)`.
- Crafting: `CraftingService.craft(recipeId, requestId, stationId)` reads
  `recipes[]` from `world.json`. A recipe is `{id, station, inputs: [{id, count}],
  output: {id, count}}`. `station` empty means hand-crafting; otherwise the player
  must be within `reachTiles` of the declared station entity. Failures:
  `unknown_recipe`, `missing_station`, `out_of_range`, `insufficient_materials`.
  Success consumes every input atomically and grants the output once.
- **Idempotency.** Every mutating request may carry a `requestId`. The ledger in
  progress maps `requestId -> {op, result, applied}`. Replaying a request id
  returns the recorded result with `"duplicate": true` and applies nothing. A
  request id cancelled by `cancel` is recorded as `cancelled` and every later use
  returns `{"ok": false, "reason": "cancelled_request"}`. The ledger is FIFO-bounded
  at `economy.ledgerLimit` (1024) entries; eviction of the oldest entry is
  recorded in the save (`"ledgerEvicted": n`).
- Gameplay without an explicit request id (human input) uses a monotonic
  `"auto:<n>"` id and is not deduplicated across restarts.

## 5 Persistence

Layout, all under the world's own `user://` root:

```text
user://worlds/<sha256(worldId)>/progress.json
user://worlds/<sha256(worldId)>/progress.json.bak
user://worlds/<sha256(worldId)>/chunks/<cx>_<cy>.json
```

`progress.json`:

```json
{
  "format": "craftmine.godot-mining-sandbox-progress/1",
  "worldId": "my-mine", "stateVersion": 1, "savedAt": "2026-09-10T12:00:00",
  "seed": 20260910, "mapSize": [96, 48], "worldRevision": 12,
  "chunks": { "0_0": { "revision": 3, "file": "0_0.r3.json", "sha256": "...", "bytes": 214, "cells": 5 } },
  "ledgerEvicted": 0,
  "state": { "format": "craftmine.godot-mining-sandbox-state/1", "stateVersion": 1, ... }
}
```

`state` fields: `worldId`, `player: {tile: [tx, ty], position: [x, y], facing,
health}`, `inventory: {itemId: count}`, `tools: [itemId]`, `equipped: itemId`,
`flags: {id: value}`, `chunkIndex` (mirror of the top-level `chunks` map),
`editCount`, `terrainHash`.

`chunks/<cx>_<cy>.<sha16>.json` (content-addressed):

```json
{
  "format": "craftmine.godot-mining-sandbox-chunk/1",
  "worldId": "my-mine", "stateVersion": 1, "seed": 20260910,
  "chunk": [0, 0], "chunkSize": [16, 16], "revision": 3,
  "cells": [[3, 7, "air"], [4, 7, "stone_brick"]]
}
```

Rules:

1. **Only dirty chunks are written.** An unmodified chunk has no file and is
   regenerated deterministically on load; `snapshot.chunks` reports
   `"edited": false` for it.
2. `cells` holds only the tiles that differ from generated terrain, as absolute
   tile coordinates sorted ascending by `(ty, tx)`.
3. Chunk file names are **content-addressed** (`<cx>_<cy>.<sha16>.json`, where
   `sha16` is the first 16 hex characters of the payload SHA-256) and the index
   stores the exact file name. A save is a two-phase commit: every new chunk file
   is written first under a name that cannot collide with a file the previous
   index references, `progress.json` is written atomically last and is the only
   commit point, and superseded chunk files are pruned only after the index
   commit and verification succeeded. A failure before the index commit therefore
   leaves the previous index **and** its chunk files byte-identical and loadable.
   The payload carries no timestamp, so identical cells always produce identical
   bytes and the same file name.
4. Every write is verified by re-reading the file and comparing its SHA-256 with
   the value stored in the index.
5. `save()` returns `{"ok": true, "path", "bytes", "sha256", "chunks": n}` or
   `{"ok": false, "error", "stage"}` where `stage` is `directory`, `chunk`,
   `index` or `verify`. A failed save must leave the previous committed
   `progress.json` and its chunks byte-identical and loadable.
6. Loading is **whole-reject**: any failure returns
   `{"ok": false, "error", "reason", "detail"}` and applies nothing. Reason codes:
   `missing_progress` (absent file is not an error: fresh start), `bad_json`,
   `bad_format`, `bad_state_version`, `bad_world_id`, `bad_seed`, `bad_map_size`,
   `bad_state`, `missing_chunk`, `chunk_corrupt`, `chunk_hash_mismatch`,
   `chunk_out_of_range`, `chunk_world_mismatch`.
   The previous in-memory state is preserved on rejection.
7. A version change (`stateVersion` != 1, or an unknown `format`) is rejected with
   `bad_state_version` / `bad_format` and never partially applied.
8. **No burying.** On load, if the saved player tile is inside a solid tile the
   runtime resolves it to the nearest free tile above within the same chunk and
   reports `snapshot.rescue = {resolved: true, from, to, reason}`. If no free tile
   exists the load fails with `bad_state`. Placement can never create the overlap
   in the first place (`would_bury_player`). A saved tile or position outside the
   map (beyond a small legal band above the top row, `PLAYER_TILE_MARGIN = 8`) is
   rejected with `bad_state` instead of restoring the player off-map.
9. The progress root can be redirected for failure tests only through the
   documented env var `CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT`; when unset the
   path above is used. No test may fake a write failure in another way.
10. **Managed capture / restore (integration with `craftmine.godot-progress/1`).**
    The shared managed progress receipt is a single self-contained body, so the
    adapter cannot simply point at the chunk files: the body must carry the
    terrain edits or a managed restore would lose them. The game exposes:

    - `capture_managed() -> Dictionary` returning
      `{"format": "craftmine.godot-mining-sandbox-managed/1", "state": <state dict>,
      "chunks": {"<cx>_<cy>": {"revision": n, "cells": [[tx, ty, material], ...]}},
      "terrainHash": "..."}` with cells sorted by `(ty, tx)`.
    - `restore_managed(body: Dictionary) -> Dictionary` validating the body as a
      whole (format, worldId, stateVersion, seed, mapSize, chunk ids in range,
      cells inside their chunk and inside the map, every material declared) and
      applying nothing on failure.

    The body must stay under the shared `state_guard` limit (1 MiB). If
    `capture_managed()` would exceed it, it returns
    `{"error": "managed_body_too_large", "bytes": n}` and the host must refuse the
    save instead of truncating terrain. The base's own chunk files remain the
    native restart path; the managed body is the host-visible receipt.

## 6 Observation surface

`snapshot()` is read-only and returns `craftmine.godot-mining-sandbox-snapshot/1`:

```json
{
  "format": "...snapshot/1", "worldId": "...", "baseId": "mining-sandbox",
  "baseVersion": "1.0.0", "stateVersion": 1,
  "mapSize": [96, 48], "chunkTiles": [16, 16], "tileSize": 16, "seed": 20260910,
  "player": {"tile": [6, 6], "position": [x, y], "facing": "right", "health": 3,
             "toolTier": 1, "equipped": "stone_pickaxe", "onFloor": true},
  "inventory": {"stone": 4},
  "tools": ["stone_pickaxe"],
  "chunks": {"0_0": {"revision": 3, "edited": true, "cells": 5, "sha256": "..."}},
  "editCount": 12, "terrainHash": "...", "worldRevision": 12,
  "rescue": {"resolved": false},
  "physical": {"overlaps": ["<entity id or tile>"], "solidTilesInPlayerRect": 0},
  "save": {"lastSave": {"ok": true, "bytes": 1234, "sha256": "..."}},
  "bootError": ""
}
```

Calling `snapshot()` must not mutate any state; the acceptance matrix asserts an
unchanged `terrainHash` and inventory across a snapshot call.

## 7 Probe interface (restricted acceptance)

Enabled only with `-- --probe --probe-request=<file> --probe-response=<file>`
(user args). It never injects OS input, never creates a window, never requests
pointer lock. Every op calls the same method gameplay uses; the probe cannot write
a result directly.

| Op | Args | Notes |
| --- | --- | --- |
| `snapshot` | — | returns `snapshot()` |
| `wait` | `frames` | advances physics frames |
| `move` | `dx, dy, steps` | scripted input, same code path as a player |
| `set-position` | `x, y, facing?` | test setup teleport; rules are re-checked afterwards |
| `tile` | `tx, ty` | read-only single tile |
| `dig` | `tx, ty, requestId?` | `TerrainService.dig` |
| `place` | `tx, ty, materialId, requestId?` | `TerrainService.place` |
| `craft` | `recipeId, requestId?, stationId?` | `CraftingService.craft` |
| `cancel` | `requestId` | records the id as cancelled |
| `inventory` | `itemId?` | read-only |
| `chunk` | `cx, cy` | chunk report: `edited`, `revision`, `cells`, `hash` |
| `hash` | — | `terrain_hash()` |
| `save` | — | `save()` + snapshot |
| `capture-managed` | — | `capture_managed()` for the shared progress receipt |
| `restore-managed` | `body` | `restore_managed(body)`, whole-reject |
| `restore` | — | re-reads progress from disk, whole-reject |
| `reset-to-initial` | — | clears edits and returns to initial progress |
| `quit` | — | exits |

Response: `{"format": "...probe/1", "ok": bool, "baseId", "baseVersion", "worldId",
"results": [{"op", "args", "result"}], "finalSnapshot": {...}, "save": {...}}`.
Process exit code: `0` when the probe ran and the response was written, `64`
missing args, `65` unreadable request, `66` response not written. Gameplay
acceptance is decided by the caller from the response file, so expected rejections
never make the process fail.

## 8 Frozen acceptance assertions (A16)

Implemented by `tests/godot-remaining/G/a16-acceptance.mjs`. Ids are stable; a new
assertion gets a new id, an existing id is never redefined.

| Id | Assertion |
| --- | --- |
| G01 | Two fresh worlds with the same `generation` block have equal `terrainHash`. |
| G01b | The engine's sampled tiles equal the independent JavaScript terrain reference. |
| G01c | The engine's full `terrainHash` equals the JavaScript reference on a world with ore veins and caves. |
| G02 | Two fresh worlds with different seeds have different `terrainHash`. |
| G03 | Tile-to-chunk mapping matches `"<tx/16>_<ty/16>"` for interior, edge and partial-boundary tiles. |
| G04 | The grid is finite: a tile outside `mapSize` is rejected with `out_of_bounds` and no mutation. |
| G05 | A legal dig removes the tile, increments the chunk revision and grants exactly one drop. |
| G06 | A dig beyond `reachTiles` is rejected with `out_of_range`; terrain and inventory unchanged. |
| G07 | Digging `air` is rejected with `not_solid`. |
| G08 | Digging `bedrock` is rejected with `unbreakable`. |
| G09 | Digging a material above the equipped tool tier is rejected with `tool_tier_too_low`. |
| G10 | Replaying a dig with the same `requestId` returns `duplicate: true` and grants no second item. |
| G11 | A cancelled `requestId` is rejected with `cancelled_request` and applies nothing. |
| G12 | A legal place consumes exactly one item and sets the tile. |
| G13 | Placing without the material is rejected with `insufficient_materials` and changes nothing. |
| G14 | Placing into a non-air tile is rejected with `cell_occupied`. |
| G15 | Placing beyond `reachTiles` is rejected with `out_of_range`. |
| G16 | Placing into the player body is rejected with `would_bury_player`. |
| G17 | Placing without a non-air neighbour is rejected with `not_adjacent`. |
| G18 | A legal craft consumes every input and grants the output once. |
| G19 | A craft with missing inputs is rejected with `insufficient_materials` and consumes nothing. |
| G20 | Replaying a craft with the same `requestId` consumes nothing a second time. |
| G21 | Dig + craft + place, save, restart: `terrainHash`, inventory, tools and player tile are identical. |
| G22 | An unmodified chunk has no chunk file and regenerates to the generated terrain after restart. |
| G23 | Two or more modified chunks are all restored with their revisions. |
| G24 | A partial boundary chunk round-trips exactly. |
| G25 | A corrupt `progress.json` is rejected whole with an explicit reason; nothing is applied. |
| G26 | A corrupt chunk file is rejected with `chunk_corrupt` or `chunk_hash_mismatch`. |
| G27 | An indexed but missing chunk file is rejected with `missing_chunk`. |
| G28 | A changed `stateVersion` or `format` is rejected with `bad_state_version` / `bad_format`. |
| G29 | A real write failure returns `ok:false` with a `stage`, and the previous save stays loadable. |
| G29b | A failure at the index stage leaves the previous index and its chunk files loadable. |
| G30 | Placement never buries the player, and a saved overlap is rescued and reported. |
| G31 | `snapshot()` is read-only: `terrainHash`, inventory and player do not change. |
| G32 | Every probe op is visible through `snapshot()` and no probe op writes a result directly (source scan). |
| G32b | A probe mutation is visible in the same run's `finalSnapshot`. |
| G33 | `world-build.json` declares base id/version/protocols/engine and a SHA-256 for every shipped file. |
| G34 | `manifest.json` declares the side-view 1.0.0 reuse with source hashes in `docs/REUSE.md`. |
| G35 | The blank template has an empty inventory, no recipes and no rewards. |
| G36 | `capture_managed()` / `restore_managed()` round-trip the full state and terrain edits, and reject a tampered body whole. |

## 9 Host integration surface

The shared adapter (`desktop/godot/shared/adapters/mining-sandbox.gd`, owned by
task F) and any host script may call only these game methods. They are part of the
frozen contract; a reference adapter is provided at
`contracts/shared-adapter.mining-sandbox.gd`.

| Member | Contract |
| --- | --- |
| `boot_error: String` | Empty when the world loaded; otherwise the load rejection reason. |
| `bind_world(world_id: String) -> String` | `""` on success; otherwise an error string. Rejects a mismatch with the world the project was created for. |
| `capture_managed() -> Dictionary` | SPEC 5.10 body. |
| `restore_managed(body: Dictionary) -> Dictionary` | `{"ok": true}` or `{"ok": false, "reason": ..., "detail": ...}`; whole-reject. |
| `snapshot() -> Dictionary` | SPEC 6. |
| `save() -> Dictionary` / `restore() -> Dictionary` | SPEC 5.5 / 5.6. |
| `dig(tx: int, ty: int, request_id: String) -> Dictionary` | SPEC 3. |
| `place(tx: int, ty: int, material_id: String, request_id: String) -> Dictionary` | SPEC 3. |
| `craft(recipe_id: String, request_id: String, station_id: String) -> Dictionary` | SPEC 4. |
| `tile_at(tx: int, ty: int) -> Dictionary` | Read-only tile report. |
| `inventory_report() -> Dictionary` | Read-only inventory. |
| `terrain_hash() -> String` | Deterministic terrain fingerprint. |
| `set_paused(paused: bool) -> void` | Freezes gameplay without discarding state. |

## 10 Not claimed

- No OS-level isolation: the engine sandbox stays GD0/task B's scope.
- No GPU, visible-window or hand-feel evidence: headless logic only.
- No infinite world, liquids, lighting, multiplayer or physics materials.
- No real model creation: the sample is authored here; task I owns the model
  acceptance run.
