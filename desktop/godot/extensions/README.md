# Controlled L3 part extensions (Godot path)

Engine-independent metadata layer for **L3 low-level part extensions**: part
packages are described, checked against a fixed engine/base, installed,
upgraded, rolled back and uninstalled here. The modules never execute part code;
loading an entry script stays inside a managed Godot job owned by the executor
and sandbox tasks.

This directory is the Godot counterpart of the legacy runtime's replaceable
parts (`app/harness/parts.mjs`, `app/harness/kernel.mjs`). It reuses the same
concepts — fixed interface per kind, human/native approval, self tests that must
go red for a no-op implementation — without importing or modifying those files.

## Files

| File | Purpose |
| --- | --- |
| `formats.mjs` | Format strings, part kinds and interfaces, semver range helpers, id/path grammars |
| `content-ref.mjs` | Content references with a resolvable hash (shared contract with the version-management and asset-library plans) |
| `manifest.mjs` | Manifest validation, canonical JSON, manifest digest |
| `package.mjs` | Derive the file list + hashes from authored sources; read a package back from disk |
| `compat.mjs` | Engine / host-ABI / base / state-format / native-validation / license gate |
| `store.mjs` | Atomic package store, `index.json`, append-only `journal.jsonl`, on-disk re-hash verification |
| `lifecycle.mjs` | `install` / `activate` / `upgrade` / `rollback` / `uninstall` / `status` |
| `budget.mjs` | Budget accounting that refuses to treat "unmeasured" as "passed" |
| `index.mjs` | Public surface |

## Package lifecycle

```js
import { buildPartPackage, createPartManager, measureBudget } from '../../desktop/godot/extensions/index.mjs';

const pkg = buildPartPackage({
  manifest: {
    format: 'craftmine.godot-part-manifest/1',
    partId: 'tile-batch-renderer',
    partKind: 'renderPass',
    version: '0.1.0',
    apiVersion: 1,
    engine: { name: 'godot', version: '4.7.2-stable', renderer: 'gl_compatibility' },
    compatibleBases: [{ baseId: 'top-down', baseVersion: '>=1.0.0 <2.0.0', stateFormat: 'craftmine.godot-topdown-state/1' }],
    entry: { script: 'res://addons/tile_batch_renderer/part.gd', language: 'gdscript' },
    native: false,
    budgets: { frameMsP95: 1.0, memoryBytes: 1048576, measured: false },
    license: { spdx: 'MIT', source: 'docs/dispatch-reports/godot-remaining/J/J_L3_CANDIDATES.md' },
    selfTests: [{ id: 'batch.reduces-draw-calls', kind: 'engine-headless', expect: 'draw calls per frame drop without changing world state' }],
  },
  sources: { 'addons/tile_batch_renderer/part.gd': 'extends Node\n' },
});

const manager = createPartManager({ root: 'C:/tmp/part-store', host: { engineVersion: '4.7.2-stable', apiVersion: 1 } });
manager.install(pkg, { target: { baseId: 'top-down', baseVersion: '1.0.0', stateFormat: 'craftmine.godot-topdown-state/1', engineVersion: '4.7.2-stable' } });
manager.activate('tile-batch-renderer', '0.1.0');
manager.rollback('renderPass');           // previous version, or the built-in default
```

## Invariants the tests pin down

1. A package whose bytes do not match its manifest is refused **before** anything
   is written to the store.
2. Engine version, host ABI version, base id, base version range and state format
   must all match. A part is never "tried and hopefully works".
3. `native: true` requires an external validation record produced by the
   sandbox/executor/performance tasks. This layer cannot mint that record.
4. Content references must resolve to a hash right now; pointer-only references
   are refused.
5. The active version is never replaced silently — every switch is journaled and
   the previous version is kept for `rollback`.
6. An active part cannot be uninstalled; switch away first.
7. `measureBudget` returns `unknown` (never `pass`) when no real samples exist,
   and records the evidence source (`logic-only`, `engine-headless`,
   `engine-rendered`, `release-package`).

## Not in this layer

* Running or sandboxing part code (executor/sandbox tasks).
* Widening engine permissions or patching engine source. Those stay outside the
  normal creation path and need their own versioned development plus review.
* Deciding *which* parts are worth building. See
  `docs/dispatch-reports/godot-remaining/J/J_L3_CANDIDATES.md`.
