# S7 round-three integration report 02 - consuming S1-S6 and the executor breakpoint

Date: 2026-09-10. Status: **integrated, rebuilt and re-probed. The managed executor now really
runs jobs; the remaining blocker for a first end-to-end create -> apply flow is the host-side
isolated check (R2) and, for a shipped build, the executor toolchain (S2/S8).**

## 1. Consumed commits

| Source | Head consumed | Merge commit on this branch |
| --- | --- | --- |
| S1 core transactions/RPC | `7e17ea97162c` | `fe08b97` |
| S3 bases and package install | `60eb3b535958` | `18e9676` |
| S4 durable backups | `e303fb75795e` | `b9f3895` |
| S5 asset catalog and preview | `5ac509f4b4ae` | `5306c66` |
| S2 executor, plugin and private services | `7f0ff4e` | `bb2442e` |
| S6 model tools and live services | `43e6a75` | `b09144f` |

Ancestry was verified; no tree was copied and no contribution history was rewritten.

## 2. Integration resolutions (all recorded, none hidden)

| File | Conflict | Resolution |
| --- | --- | --- |
| `vendor/pi-desktop/docs/spec/godot-portable-archive.md` | S1 vs S4 wording of the reclaim-pins contract | kept the S1-owned wording (same behaviour, more detail), noted here |
| `vendor/pi-desktop/crates/craftmine-core/src/main.rs` | `hello` capability list | union: S1's superset (`creationPackages`, `portableBackup`) |
| `desktop/build-world-plugin.mjs` | three different copy lists (S7 baseline, S2, S6) | union of all three: 24 files including `asset-service.mjs`, `reuse-service.mjs`, `tool-services.cjs` |
| `plugins/craftmine-world/main.cjs` | two different tool-service blocks (S2 vs S6) | took S6's `toolServices` (it matches the merged `world-tools.cjs` provider contract and wires `executorStatus`/`executorEnqueue`/`executorCancel`), kept S2's `createAssetService`/`createReuseService` construction |
| `plugin-host-process.mjs`, `plugin-runtime.ts` | S2's `godotCheck`/`assetPreview`/`sampleLiveState` vs S6's `godotLiveState` | union of both bridges; the plugin's provider uses `godotLiveState` |
| `docs/spec/06-delivery/04-e2e-test-plan.md` | two different CRAFTMINE-GODOT-023 sections | kept both sections |

### New finding from the S2/S6 resolution

S2 passed `historyMethods: ['content.history', ...]` and `libraryMethods: ['library.search', ...]`
as **arrays**. The merged consumers expect object tables:
`createHistoryService({methods})` spreads `{...DEFAULT_METHODS, ...methods}` and
`createLibraryBinding({methods})` reads `methods.asset` / `methods.package` / `methods.write`.
The arrays were therefore dropped, and the tools fall back to their defaults. That exposes a real
gap:

- `godot-history.cjs` defaults to `content.version`, `content.checkpoint`, `content.mergeCandidate`,
  `content.operationResult`;
- the core registers `content.version.create` / `content.version.list`,
  `content.checkpoint.set` / `content.checkpoint.list`, and has **no** `content.mergeCandidate` or
  `content.operationResult`.

So the history tool's version/checkpoint/merge paths report `UNKNOWN_METHOD` unless S2 supplies
`historyMethods: {version: 'content.version.list', checkpoint: 'content.checkpoint.list', ...}`.
The library defaults (`asset.search/read/versions`, `package.check/read/list`) do match the core
and are fine. Owner: S2 (plugin wiring), with S6 for the contract shape.

## 3. Identity after integration

| Component | Identity |
| --- | --- |
| Branch head | `b09144fa06c7` |
| Rust core | `craftmine-core.exe` SHA-256 `11add5d3b56b014bfb063a9664b0e8fdbc6c9bcd797749257229e1762e51be00` |
| Plugin bundle | 24 files, 35 agent tools; `main.cjs` SHA-256 `dbdeb8270f6e35150ef165b1fc192af92ad58def3b926ca31519e9fcec234b95`; `manifest.json` unchanged `1419ed78...0618f86` |
| Electron build | `out/main/index.js` SHA-256 `41f611970d1d279c89af437826852724e8b73a59b0f59a8ecf8eec3023cc45fc` |
| Broker / engine | unchanged from report 01 |

All builds succeed: `cargo build --release -p craftmine-core`, `node desktop/build-world-plugin.mjs`,
`node desktop/prepare-client.mjs`, `pnpm --filter @pi-desktop/desktop run build`.

## 4. Probe results on the integrated source

### 4.1 As shipped (no provisioned toolchain)

`GODOT_BROKER_MISSING` -> executor unavailable -> `godot_build_start` returns
`executionAvailable:false` and the job is `blocked`. Unchanged from report 01: no packaging path
installs the broker, and the host strips `CRAFTMINE_GODOT_*`. Owner: S2 (discovery/contract) + S8
(package contents).

### 4.2 With the toolchain provisioned (probe-time provisioning, recorded)

This is the important change since report 01: **the executor hand-off now works end to end.**

```
executor discovered -> registered (preflight process/network/cleanup verified)
godot_build_start  -> executionAvailable: true, status: queued
godot_build_read   -> running stage=import  progress=10
                      running stage=export  progress=45
                      failed
godot_candidate_read -> status: rejected
```

The job's real output explains the failure:

```
import.passed  = false   (no import log)
check.passed   = false   assertions: [{id: "runtime.not-run",
                                      detail: "Isolated Godot check unavailable"}]
compile.errors = ["Isolated Godot check unavailable"]
```

So the broker ran the engine for real (import/export stages executed and reported progress), and
the only remaining failure is the host-owned isolated check: `GodotBuildVerifier` is still not
constructed in `electron/main/index.ts` (no `craftmineGodotCheck` service is ever injected), so the
plugin's private `craftmine.godotCheck` call answers `UNSUPPORTED`. Owner: R2.

## 5. Breakpoint status after integration

| # | Breakpoint | Status now | Evidence |
| --- | --- | --- | --- |
| P0-1 | `godotWorld.*` unreachable | **fixed** | `plugin-runtime.ts:942-943` allowlist + `host-requests.cjs:125-129` routes |
| P0-5 | core missing `asset.*`/`package.*`/`portable.*`/`legacy.convert` | **fixed** | `main.rs:110-152` + `asset_catalog_dispatch` hook; `hello` advertises the capabilities |
| P0-6 | no executor hand-off | **fixed** | probe 4.2: queued -> import -> export |
| P0-7 | asset/reuse services absent from the shipped plugin | **fixed** | 24-file bundle; `main.cjs:11-12,41-51` construct both |
| P0-2 | host isolated check never wired | **open** | probe 4.2 `Isolated Godot check unavailable`; no `GodotBuildVerifier` in `index.ts` |
| P0-3 | creation returns after `initialize`, world stays pending | **open** | `godot-world-creation.ts:287-293` (unchanged) |
| P0-4 | double path -> URL conversion | **open** | `index.ts:928` + `godot-world-creation.ts:257` (unchanged) |
| P1-4 | no packaging path for broker/engine | **open** | probe 4.1 |
| P1-3 | history/library method-name providers | **new** | section 2 |
| P1-1 | frozen provenance doc unreproducible | open | report 01 section 4 |

## 6. Frozen-set verifier after integration

Unchanged, as expected (it does not exercise the product): audit 30 rounds 0 passed / 30 not-run;
replay 6 passed / 1 insufficient / 23 not-run; negative fixtures 2 failed / 28 not-run (exit 1).
Live mode still refused for the provenance reason in report 01.

## 7. Why no real-model batch was run

The executor is now usable, but the isolated check is not: any model-driven
create -> build -> check -> candidate -> apply requirement would stop at the same
`Isolated Godot check unavailable`, and the audit explicitly forbids consuming a model batch to
reproduce a known environment gap. The single real-model requirement will be run as soon as R2
lands the verifier injection (P0-2), together with P0-3/P0-4 so the flow can reach apply.

## 8. Reproduce

```powershell
$wt = 'D:\Craftmine World-worktrees\godot-round3-s7-20260910'; cd $wt
cd vendor/pi-desktop; cargo build --release -p craftmine-core; pnpm --filter @pi-desktop/desktop run build; cd ..\..
node desktop/build-world-plugin.mjs; node desktop/prepare-client.mjs
$env:CRAFTMINE_I_LIVE_CONFIG = 'D:\Craftmine World\.craftmine\secrets.json'
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
node tests/godot-round3/S7/probe-product.mjs --out test-results/s7-probe-int2-ashipped
node tests/godot-round3/S7/probe-product.mjs --out test-results/s7-probe-int2 --provision-executor
```
