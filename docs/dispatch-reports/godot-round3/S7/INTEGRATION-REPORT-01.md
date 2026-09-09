# S7 round-three integration report 01 - baseline build, product probe and breakpoint ledger

Date: 2026-09-10. Status: **baseline built and probed; the first end-to-end create -> apply flow does
not run yet.** This report is an integration checkpoint, not acceptance. Every number below was
produced from the committed baseline in this worktree, with the exact commands in section 8.

## 1. Identity of what was built

| Component | Identity |
| --- | --- |
| Integration branch | `codex/godot-round3-s7-20260910` |
| Source baseline | `d77823c2bface9de70aa92da005b075e861a3780` (tree `d89920924bae19f110a98684097b7c110a76c783`), inventory `acfcc015...fde6f63`, 4211 files |
| Ledger commit | `c7590c33ce80` (starting point + identity JSON only) |
| Rust core | `vendor/pi-desktop/target/release/craftmine-core.exe`, 5 730 304 bytes, SHA-256 `45725ab99d5c8e2e32c96391aad8dbe9284b8594cf0d6c7b7b8c2937d1d66aa1`, built with `cargo build --release -p craftmine-core` (cargo 1.96.1) |
| Plugin bundle | `desktop/build/craftmine.world`, 21 files, 35 agent tools. `main.cjs` SHA-256 `40bacdee7a42e0c3925ec508125a19955077549f9ec90b0cb1bc935bfc328067`, `manifest.json` SHA-256 `1419ed78cd9dfc0068060fcdecb09f460cb8c0825ecd479ec847c853d0618f86` |
| Electron desktop build | `vendor/pi-desktop/apps/desktop/out`, 183 files, 31 873 331 bytes; `out/main/index.js` SHA-256 `d1f469f27674a509122039fac338530d8d1458dc0d74d87ffd4f9c996bf4bf07` |
| Agent runtime bundle | `vendor/pi-desktop/packages/agent-runtime/dist-bundle/sidecar.js`, 5.0 MB |
| Managed executor broker | built from the integrated sandbox source: `desktop/godot/sandbox/target/debug/godot-host-broker.exe`, 1 585 664 bytes, SHA-256 `c6f3c78f84027b46c20b831bcdf88bbab9d4fa3cb49001a9e2fe910d21907fb4`. The committed B-final broker is byte-different (`76932e69...2258`) only because a debug build embeds the build path |
| Godot engine | 4.7.2-stable, editor `Godot_v4.7.2-stable_win64.exe` SHA-256 `ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424` (matches `desktop/godot/toolchain.lock.json`), bridge `fb211925619e8acc732744c233f46d4db0ec88178921172dc9cd43a22a5be0d3`, toolchain lock `8cb609ea91659b863b7bb65f05ea27ac8f99eefa5798a78d9e847a13d7a7d288` |
| Toolchain used | Node v24.14.0, pnpm 11.19.0 (lockfile pnpm 11.18.0), cargo/rustc 1.96.1, Windows 10.0.19045 x64 |

All four product builds succeed from the baseline source. `node --check` passes on all 30 plugin
JavaScript sources.

## 2. Product startup probe (no model calls)

`tests/godot-round3/S7/probe-product.mjs` drives the real product path only: the pinned PI plugin
runtime loads the built plugin in a separate host process, which owns the real `craftmine-core.exe`.
No browser, no OS input, no model request.

| Step | Result |
| --- | --- |
| Prerequisites (`probePiPlugin`) | available, model provider configured, core binary + plugin present |
| Real plugin host + real core session | PASS, 35 tools registered |
| `runtime_info` | `godotSourceToolsAvailable=true`, `godotBuildJobsAvailable=true`, `godotExecutorGate=true` |
| `godot_jobs` status | real executor gate reachable; `tokenGatedMethods` listed |
| `godot_capability_report` | PASS |
| Panel `world.create` | PASS (world record created through the product) |
| `godot_project_create` | PASS (3 files, manifest hash recorded) |
| `godot_project_index` / `godot_file_read` | PASS |
| `godot_project_patch` + re-index | PASS (patched file present at the new head) |
| `godot_build_start` | job created; as shipped `executionAvailable=false` |
| `godot_build_read` | terminal `blocked` / `GODOT_EXECUTION_UNAVAILABLE` |
| Candidate | none (no build ran) |

Evidence: `evidence/s7-probe-ashipped/` (as-shipped discovery) and `evidence/s7-probe-provisioned3/`
(toolchain provisioned into the plugin data directory, see 3).

## 3. Managed executor probe

The shipped product has no code path that installs the executor broker or engine, and the host
spawns the plugin with a whitelist that strips every `CRAFTMINE_GODOT_*` variable
(`plugin-runtime.ts` `pluginProcessEnv`: only PATH/SystemRoot/windir/TEMP/TMP/TMPDIR/LANG plus
`CRAFTMINE_CORE_BIN`). The only discovery paths left are inside the plugin data directory. The probe
therefore provisioned that directory explicitly and recorded it:

- broker copied to `<pluginData>/bin/godot-host-broker.exe` (hash above);
- engine `editor/` + `templates/` copied read-only from the pinned cache (a junction is refused by
  the executor's `ordinaryDirectory()` guard, which is correct);
- `godot/web/bridge.js` and `godot/toolchain.lock.json` copied from the source tree.

With the toolchain present the executor **does** register:

```
state: registered, executorId craftmine-windows-broker-v1
evidenceHash: 51fb1b7dac14a597d46cc0617e64ded2d38488a8c2ef07706894547bf32f4597
preflight: processVerified=true networkVerified=true cleanupVerified=true
           (tcp/udp checks rawOsError 10013 = LPAC blocks the network, as designed)
capabilities: import/build/check = true
```

`godot_build_start` then returns `executionAvailable: true` and `status: queued`, but the job is
never claimed: it stays `queued` and is finally reported `interrupted`. Root cause (S7 finding,
section 5 P0-6): nothing in the product calls `godotExecutor.enqueue`, and the executor's only
automatic promotion path, `reconcile()`, calls `godotJob.pending`, which the core does not
implement (`UNKNOWN_METHOD`). So the executor is attested and idle while every managed build
queues forever. This is the same class of failure the round-two audit recorded as
`GODOT_BROKER_MISSING`, now narrowed to a precise wiring gap.

## 4. Independent frozen-set verifier (task I)

The frozen spec is hashed as raw bytes but `tests/godot-remaining/I` had no `.gitattributes`, so on
this machine (`core.autocrlf=true`) all nine frozen JSON files checked out as CRLF and the verifier
refused to run at all (`0 missing, 8 changed`). S7 owns this directory, so
`tests/godot-remaining/I/.gitattributes` was added with `*.json -text` (mirroring
`tests/godot-remaining/M/.gitattributes`) and the raw LF blobs restored. The verifier now runs
in-place.

| Mode | Command | Exit | Rounds | Passed | Failed | Insufficient | Not run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| audit | `node tests/godot-remaining/I/run.mjs --mode audit --out test-results/s7-i-audit` | 0 | 30 | 0 | 0 | 0 | 30 |
| replay | `node tests/godot-remaining/I/run.mjs --mode replay --out test-results/s7-i-replay` | 0 | 30 | 6 | 0 | 1 | 23 |
| negative fixtures | `... --mode replay --fixtures tests/godot-remaining/I/fixtures/negative ...` | 1 (expected) | 30 | 0 | 2 | 0 | 28 |
| live | `... --mode live ...` | 2 | - | - | - | - | refused |

- replay passes R01.1, R02.2, R04.2, R05.2, R06.1, R12.2 (verifier self-proof only, no model);
  R14.2 is `insufficient` (missing human-review record). The other 23 rounds have no replay
  fixture. Ledger: A17 and AL-A17 `证据不足`, the rest `尚未执行`.
- negative fixtures fail R02.1 and R03.1 with four hard failures, proving the verifier can judge
  red. 0 model calls, 0 input events in every mode.
- live mode is **refused**, not skipped: `FREEZE.lock.json` pins
  `docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md` to `92b0a04f...67592`, but no copy of that document
  with that content exists any more (the main tree's copy is an in-progress edit; every worktree
  copy differs). Live rounds therefore stay `not-run`; they are not counted as passes. Deciding
  whether to re-freeze the provenance is a main-task call, not a silent S7 edit.

Evidence: `evidence/s7-i-audit/`, `evidence/s7-i-replay/`, `evidence/s7-i-negative/`.

## 5. Breakpoint ledger (owner, evidence, next step)

P0 = blocks the first real create -> build -> check -> apply flow.

| # | Breakpoint | Owner | Evidence | Next step |
| --- | --- | --- | --- | --- |
| P0-1 | `godotWorld.*` is rejected before it reaches the plugin: `godot-world-creation.ts:287` calls `godotWorld.initialize` through `plugins.requestCraftmineHost`, whose allowlist (`plugin-runtime.ts:904-912`) has no `godotWorld.*`; `host-requests.cjs` also has no route | R2 + S2 | static audit; `main/index.ts:1006` builds the factory with the same allowlisted bridge | add the route in the plugin and the host allowlist (host-only, never renderer) |
| P0-2 | `GodotBuildVerifier` is never constructed in production (only tests) | R2 + S2 | grep `.firstLoad(` = 0 production call sites; `godot-build-verifier.ts` imported only by tests | construct it in `index.ts` and pass it into creation |
| P0-3 | Creation returns right after `initialize`; no project registration, no first build, no `firstLoad`; world stays `status='pending'` | R2 | `godot-world-creation.ts:287-293`; `godot_worlds.rs:126` | continue the transaction after initialize |
| P0-4 | Double path -> URL conversion (`file:/D:/` + `%2520`) breaks materializer loading | R2 | `index.ts:923` + `godot-world-creation.ts:256` | pass one form only |
| P0-5 | Core has no `asset.*`, `package.*`, `portable.*` or `legacy.convert` routes although the implementations exist | S1 | `main.rs` dispatch table; `asset_catalog/*`, `library/{installer,package_format,packages,reuse}.rs`, `backups/{portable,complete}.rs`, `legacy/convert.rs` | register the RPCs |
| P0-6 | No caller ever enqueues a Godot job; `reconcile()` depends on the missing `godotJob.pending`, so builds queue and then time out | S2 (+S1) | this probe (`evidence/s7-probe-provisioned3/`), `godot-executor.cjs:706,759`, `host-requests.cjs:77`, `plugin-runtime.ts:904` | enqueue from the build path and/or add `godotJob.pending` |
| P0-7 | Shipped plugin omits `asset-service.mjs`, `package-format.mjs`, `package-zip.mjs`, `reuse-service.mjs`, and none is constructed in production | S2 + S5/S3 | `desktop/build-world-plugin.mjs` copy list; no production require | copy + construct through the private service router |
| P1-1 | Frozen provenance document no longer reproducible -> live rounds refused | main task (S7 reports) | section 4 | decide re-freeze vs. restoring the document |
| P1-2 | Frozen spec checked out as CRLF -> verifier unusable | S7 (fixed here) | `.gitattributes` added; before/after evidence in section 4 | done |
| P1-3 | `tests/godot-remaining/I/README.md` still says 14 categories / 28 rounds / 128 assertions; the frozen set is 15 / 30 / 141 | S7 | README vs `FREEZE.lock.json` | correct the doc (no assertion change) |
| P1-4 | No packaging script installs the broker or engine; `build-client.ps1`/`windows-package-tools.mjs` never mention `godot-host-broker` | S8 + S2 | probe `prerequisites.packaging.installsBroker=false` | define and implement the package contract |
| P1-5 | UI surface gaps: asset library panel is mounted but the backend route is dead; history, restore and creation-package install have no UI/panel channel | R2 + S3/S5 | static audit section 4 | wire after P0-5 |
| P1-6 | C's weaker `reapTaskProcess` is still in the baseline tree and must not run or ship before S2's hardened recovery lands | S2 | `godot-executor.cjs:314-340` | consume S2's fix; S7 will not exercise it |

## 6. What this report does not claim

- No real-model request has been made in round three yet. The audit's rule stands: the executor
  must be usable first, otherwise a model batch is consumed to produce the same
  `GODOT_EXECUTION_UNAVAILABLE` evidence.
- R15 remains a source-level heuristic and is not counted as a runtime pass.
- The round-two numbers (62 traceable model calls, the R5 x R1 core regression, the asset scan
  same-name crash) stay in the denominator; nothing was deleted.
- No candidate package exists yet, so no same-package verification is possible.

## 7. Next S7 actions (in order)

1. Consume S1/S2/R2 commits as they land; rebuild and re-run this probe after P0-1..P0-6 are fixed.
2. Re-run the frozen verifier after each integration; keep audit/replay/negative/live separate.
3. Once the executor actually runs a job, run the one real-model requirement through the product's
   own hook (`tests/godot-round2/R8/run-real-requirement.mjs` path) and record usage/unknown.
4. Freeze the functional candidate (full commit set, all binary hashes, dirty state) and hand it to
   S8 for the candidate package; then re-verify from the package.

## 8. Reproduction

```powershell
$wt = 'D:\Craftmine World-worktrees\godot-round3-s7-20260910'
cd $wt
pnpm install --frozen-lockfile --dir vendor/pi-desktop
node desktop/build-world-plugin.mjs
node desktop/prepare-client.mjs
cd vendor/pi-desktop; cargo build --release -p craftmine-core; pnpm build:js
pnpm --filter @pi-desktop/agent-runtime bundle
pnpm --filter @pi-desktop/desktop run build
cd $wt; cd desktop/godot/sandbox; cargo build --locked --bin godot-host-broker

$env:CRAFTMINE_I_LIVE_CONFIG = 'D:\Craftmine World\.craftmine\secrets.json'
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
node tests/godot-round3/S7/probe-product.mjs --out test-results/s7-probe-ashipped
node tests/godot-round3/S7/probe-product.mjs --out test-results/s7-probe-provisioned3 --provision-executor

node tests/godot-remaining/I/run.mjs --mode audit  --out test-results/s7-i-audit
node tests/godot-remaining/I/run.mjs --mode replay --out test-results/s7-i-replay
node tests/godot-remaining/I/run.mjs --mode replay --fixtures tests/godot-remaining/I/fixtures/negative --out test-results/s7-i-negative
node tests/godot-remaining/I/run.mjs --mode live   --out test-results/s7-i-live   # refused: frozen provenance
```

Input policy in every command above: no browser, no mouse/keyboard, no pointer lock, no window
activation, no `tests/browser.mjs` or `tests/modules-browser.mjs`.
