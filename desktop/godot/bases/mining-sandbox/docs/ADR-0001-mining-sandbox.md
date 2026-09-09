# ADR-0001: mining-sandbox base — finite map, chunk identity and progress split

- Status: accepted
- Date: 2026-09-10
- Task: G (`docs/dispatch-prompts/godot-remaining-20260910/G-mining-sandbox.md`)
- Stage: GD5 / A16
- Supersedes: nothing. Related: `desktop/godot/bases/side-view/docs/sandbox-branch-interface.md`
  (F's proposal, explicitly "not implemented"); this ADR answers its open
  questions 1-4 and keeps its non-goals.

## Context

GD5 needs a dig/place sandbox that can be used as a real, modifiable base on the
creation platform. F's side-view base owns movement, camera, combat and the
ability-gate story and must stay a bounded deliverable; the proposal document
already listed the shared surface and left four open questions. The sandbox has to
persist variable terrain without turning player progress into Git content history,
and it has to survive corrupt, missing and version-changed saves without silently
losing a player's dig.

## Decisions

### D1 — Finite authored map first, no infinite world

`generation.mapSize` fixes the grid; the runtime never invents tiles outside it.
Infinite terrain is a separate, later stage (plan section 6.1).

### D2 — Integer-deterministic generation instead of storing the map in Git

Terrain is a pure integer function of `(seed, tx, ty, params)`: a 64-bit hash
drives the surface row, ore veins and caves. The full map is therefore
reconstructible from `world.json` and is **not** committed. Two fresh worlds with
the same `generation` block produce an identical `terrainHash`, and the acceptance
matrix re-derives the terrain in JavaScript to cross-check the engine.

Rejected alternatives: a hand-authored tile map in Git (grows with the world, and
duplicates source with progress); float noise (not bit-reproducible across
platforms); engine RNG (`RandomNumberGenerator` state is not part of the world).

### D3 — Chunk id is `<tx/16>_<ty/16>`, partial chunks allowed

16x16 tiles per chunk keeps a chunk file small enough to rewrite atomically while
giving a natural unit for "which part of the world changed". The last chunk on
each axis is partial when the map size is not a multiple of the chunk size; the
acceptance matrix covers a partial boundary chunk explicitly.

### D4 — Progress stores only the delta from generated terrain

A chunk file holds only tiles that differ from the generator output, sorted by
`(ty, tx)`, plus a revision. Unmodified chunks have no file at all and regenerate
deterministically. This keeps a save proportional to what the player changed
rather than to the map size, and makes "did this chunk change?" answerable from
the file system.

### D5 — Index last, chunks first, hash every write

Chunk files are written atomically, then `progress.json` (the commit point) stores
each chunk's `revision`, `bytes` and SHA-256. A failed write reports a `stage` and
leaves the previous commit byte-identical. Loading re-verifies every hash and
rejects the whole save on any mismatch.

### D6 — Whole-reject loading with explicit reason codes

Partial application would silently mix a new inventory with old terrain. Every
failure (`bad_json`, `bad_state_version`, `missing_chunk`, `chunk_corrupt`,
`chunk_hash_mismatch`, ...) leaves the previous in-memory state untouched. A
missing chunk that the index claims exists is an error, never a silent
regeneration: that is the only way to guarantee "no silent data loss".

### D7 — One mutation path and one idempotency ledger

`TerrainService.set_tile` is the only terrain mutation path; `InventoryService`
the only inventory path. Every mutating request can carry a `requestId`; the
ledger records the outcome so a duplicate request returns the recorded result with
`duplicate: true` and a cancelled request can never apply. This is what makes
"repeated, cancelled or failed requests must not double-grant or double-consume"
checkable rather than aspirational.

### D8 — The player can never be buried

Placement rejects a tile whose AABB would overlap the player body
(`would_bury_player`), and load resolves a saved overlap to the nearest free tile
above, reporting `snapshot.rescue`. If no free tile exists the load fails with
`bad_state` rather than leaving the player inside rock.

### D9 — Managed progress body carries the terrain

The shared `craftmine.godot-progress/1` receipt is a single body, so an adapter
that only pointed at chunk files would lose terrain on a managed restore.
`capture_managed()` therefore returns the state plus every edited cell, and refuses
(`managed_body_too_large`) rather than truncating when it would exceed the shared
1 MiB limit. The base's own chunk files remain the native restart path.

### D10 — Reuse the side-view movement model as a declared dependency

Movement numbers, body conventions, camera smoothing and the input abstraction are
taken from side-view 1.0.0 and recorded with source hashes in `docs/REUSE.md`,
which the acceptance matrix re-verifies. The body size is 12x26 instead of 10x40 so
a one-tile-wide shaft is walkable — a declared deviation, not a silent retune.
The side-view `room_manager` lifecycle is deliberately not reused: it frees a room
on transition, which is wrong for digging.

### D11 — No third-party art

Terrain, items and the station are drawn procedurally from the material colours in
`world.json`. This removes asset licensing questions from the base itself and
keeps the import step independent of external files; the release manifest still
lists every shipped file for K.

## Consequences

- A save is not a snapshot of the whole map; it is an index plus per-chunk deltas.
  Tools that need the whole terrain must regenerate it and apply the deltas
  (the runtime already does this on load).
- Terrain edits are progress and must stay out of Git content history; a branch
  merge must not merge them (plan M, VM §5).
- The base is not registered as a delivered product base until F lands the shared
  adapter and the product enumerations include it; that is a deliberate,
  reportable gap, not a claim of completion.

## Protocol change log

Any change to `base_contract.gd` constants, the reason codes in SPEC sections 3-6,
the probe op table or the frozen assertion ids is a protocol change: bump
`baseVersion`, record it here, and update `manifest.json` and
`docs/INTERFACE_BC.md` in the same commit.
