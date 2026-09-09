# Mining-sandbox base — interface for the build / run / storage / product chain

This file states what the base provides and what each owner must add. It changes
no shared file. All paths are relative to the repository root unless noted.
Owners: **B** build/isolation, **C** executor/verifier, **D** preview/lifecycle,
**F** shared Godot adapters and the existing three bases, **A** Rust core and
storage, **H** reuse/migration/backup, **E** product entry, **K** release
manifests and licensing.

## 1 What the base promises

| Item | Value |
| --- | --- |
| `baseId` | `mining-sandbox` |
| `baseVersion` | `1.0.0` |
| `baseProtocolVersion` | `1` |
| Godot | `4.7.2-stable` (`desktop/godot/toolchain.lock.json`) |
| Language / renderer | GDScript / `gl_compatibility` |
| World / state / progress / chunk / probe / snapshot formats | see `manifest.json` |
| Entry scene | `res://scenes/main.tscn` |
| Save root | `user://worlds/<sha256(worldId)>/` |
| Reused foundation | `side-view` `1.0.0`, hashes in `docs/REUSE.md` |
| Third-party assets | none; terrain is drawn procedurally, so no import step depends on external art |

Changing any value in `manifest.json` or `core/scripts/base_contract.gd` is a
protocol change and must be recorded in `docs/ADR-0001-mining-sandbox.md` first.

## 2 Build side (B)

```powershell
node desktop/godot/bases/mining-sandbox/tools/new-world.mjs `
  --template blank|mine-camp --world-id <id> --name "<名称>" --out <目录> [--force]
```

- `world-id` must match `^[a-z0-9][a-z0-9-]{1,47}$`; an existing target needs `--force`.
- The tool rejects templates that ship a claimed reward, a starting tool, a zero
  or negative count, an out-of-map spawn/entity tile, an unknown ore material or a
  recipe that names an unknown station. It fails before writing anything useful.
- `world-build.json` (`craftmine.godot-world-build/1`) lists `baseId`,
  `baseVersion`, `baseProtocolVersion`, all protocol ids, `godotVersion`, `seed`,
  `mapSize`, `chunkTiles`, `initialProgress`, `userDirName` and a
  `{path, bytes, sha256}` entry for **every** shipped file except itself. Use
  `worldId + baseVersion + files hashes` as the project version input.
- Import once per materialized world: `<godot> --headless --path <world> --import`.
  The base ships no `.godot/` cache and no external asset import dependency.
- `node tools/check-sync.mjs` proves every committed world under `worlds/` is
  byte-identical to what the current templates, core and parameters produce.

## 3 Run / save side (C)

```powershell
<godot> --headless --path <world> -- --probe --probe-request=<req.json> --probe-response=<res.json>
```

- The probe is dormant unless `--probe` and both file arguments are present; a
  normal run is unaffected.
- Request/response schemas and the op table are in `docs/SPEC.md` sections 6-7.
- Exit codes: `0` ran and wrote the response, `64` missing arguments, `65`
  unreadable request, `66` response not written. Gameplay pass/fail is decided by
  the caller from the response file, so expected rejections never fail the process.
- Progress layout: `progress.json` (the only commit point) plus
  `chunks/<cx>_<cy>.r<revision>.json`. Chunk files are revision-versioned and the
  index stores the exact file name, so a save is a two-phase commit: new chunks
  first, index last, superseded files pruned only after the commit. The index
  stores each chunk's SHA-256 and byte count.
- Loading is whole-reject. Reason codes: `missing_progress` (fresh start, not an
  error), `bad_json`, `bad_format`, `bad_state_version`, `bad_world_id`,
  `bad_seed`, `bad_map_size`, `bad_state`, `missing_chunk`, `chunk_corrupt`,
  `chunk_hash_mismatch`, `chunk_out_of_range`, `chunk_world_mismatch`.
- **Read the progress only after the instance has stopped.** The base has no
  cross-process file lock; two writers to one world is last-writer-wins.
- `capture_managed()` / `restore_managed(body)` implement the shared
  `craftmine.godot-progress/1` body (SPEC 5.10). The body carries the chunk edits,
  so a managed receipt binds terrain. A body that would exceed the shared 1 MiB
  `state_guard` limit is reported as `managed_body_too_large` instead of being
  truncated.
- A real write failure is reproduced with
  `CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT=<path whose parent is a file>`; the
  previous committed save stays intact and loadable.

## 4 Shared surface (F)

Four edits, all in F's ownership. Nothing else in `desktop/godot/shared/**` changes.

1. `desktop/godot/shared/adapters/mining-sandbox.gd` — copy
   `desktop/godot/bases/mining-sandbox/contracts/shared-adapter.mining-sandbox.gd`
   verbatim. The file name must equal the base id because `materialize.mjs`
   copies it to `res://craftmine_shared/base_adapter.gd`.
2. `desktop/godot/shared/materialize.mjs` `configs` (around line 9):

```js
'mining-sandbox': { version: '1.0.0', examples: ['blank', 'mine-camp'] },
```

   The base uses the same `tools/new-world.mjs` argument shape as `top-down`
   (`--template <t> --world-id <w> --name <w> --out`), so it must be routed
   through that branch. The current routing condition is
   `baseId === 'top-down' ? [...--template...] : [...--world...]`, so F must
   extend it to include `mining-sandbox` (for example
   `['top-down', 'mining-sandbox'].includes(baseId)`); adding the `configs` entry
   alone would send the base down the `--world` branch and `new-world.mjs` would
   exit with `--template is required`.
3. `desktop/godot/shared/tests/progress.mjs` — add
   `['mining-sandbox', 'mine-camp']` to the base/template matrix and add one
   base-specific bad state (`{format: '...sandbox-state/1', stateVersion: 99}`)
   plus one real body assertion (`body.chunks` non-empty after a dig).
4. `desktop/godot/shared/README.md` — list the base and note that its native body
   contains terrain chunks.

## 5 Storage, reuse and migration (A / H)

- **Terrain edits are player progress, not source.** The chunk files and
  `progress.json` must never be committed to Git content history (plan M, VM §5)
  and a branch merge must not merge inventory or terrain progress.
- The Git-tracked source is the world project produced by `tools/new-world.mjs`:
  `world.json` (generator parameters, materials, items, recipes, entities, initial
  progress), `scripts/base/**`, `scenes/**`, `params/**`, `project.godot`.
  The full generated map is **not** stored in Git; it is re-derived from
  `generation` deterministically, which is why the seed and generator parameters
  are part of the build receipt.
- For A's Rust side: bind the managed body to `worldId`, `baseId`,
  `baseVersion`, `stateVersion` and the build receipt hashes. The base reports
  `seed`/`mapSize`/`terrainHash` in the snapshot; use `terrainHash` as the
  progress fingerprint for a restore comparison.
- For H: a copied world gets a new `worldId` (and therefore a new save root). Do
  not copy progress into a new world; offer "start from the template's initial
  progress" instead, which is what `new-world.mjs` produces.
- Version change policy: an unknown `stateVersion` or format is rejected whole.
  There is no silent migration; a future migration must be an explicit,
  separately tested converter.

## 6 Product entry and delivery (E / K)

- E: the base is created through `new-world.mjs` (or the shared materializer once
  F lands §4). It has no product UI of its own; the entry is the world project's
  `project.godot` and `res://scenes/main.tscn`.
- K: a ready-to-review asset manifest is generated by
  `desktop/godot/bases/mining-sandbox/delivery/make-base-assets.mjs` and delivered
  in the task report at
  `docs/dispatch-reports/godot-remaining/G/delivery/base-assets.mining-sandbox.json`.
  It must be copied to `desktop/delivery/base-assets/mining-sandbox.json`; every
  shipped file needs an entry, `engine.version` must equal
  `toolchain.lock.json.version`, and the Godot notices must carry their real
  bytes and hashes. It is generated outside the base directory on purpose: a
  manifest inside its own `sourceDirectory` would be an undeclared file. Until
  the copy lands, `preflight-core.mjs` reports this base as uncovered — which is
  the honest current state, not a passing check.
- Product enumerations that still need the base (not in this task's write scope):

```jsonc
// plugins/craftmine-world/manifest.json, godot_project_create.baseId.enum
"mining-sandbox"
// plugins/craftmine-world/main.cjs, labels
"mining-sandbox": "横版挖掘沙盒"
```

## 7 Not implemented here

1. Managed directories and process lifecycle — B/C own them; the base's tools
   create a project directly and call the engine directly.
2. Project-version registration and apply transactions — A owns them; the base
   only guarantees a reproducible receipt and a whole-reject loader.
3. OS-level isolation — GD0/B own it; the base does not claim a sandbox.
4. Long-running instance termination — the probe is a short process; C owns
   stopping and cleaning long instances.
5. Real model creation — task I owns the model acceptance run; the sample world is
   authored here.
