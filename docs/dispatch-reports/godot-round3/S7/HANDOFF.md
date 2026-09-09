# S7 handoff - round-three integration state

Written at the point the S7 session was stopped on user instruction. Everything below is committed
or explicitly marked as unverified. Branch: `codex/godot-round3-s7-20260910`, head at handoff:
`59ef3a3849db8b4f675f796240803cea7bf8ef2a` (plus the two harness files added by the handoff commit).

## 1. One-paragraph state

All six round-three module deliveries (S1-S6) and R2's client fixes are integrated into one branch,
built from that source, and verified by the owners' own suites plus S7's own product probe and the
frozen-set verifier. Every baseline P0 wiring breakpoint identified by the round-two audit is closed
and has file:line evidence. What is **not** done: no S7 harness has yet produced evidence for the
isolated check inside the Electron host, so the create -> build -> check -> candidate -> apply chain
and the single real-model requirement remain unverified.

## 2. Verified (evidence committed)

| Verification | Command | Result | Evidence |
| --- | --- | --- | --- |
| Builds from integrated source | `cargo build --release -p craftmine-core`, `node desktop/build-world-plugin.mjs`, `node desktop/prepare-client.mjs`, `pnpm --filter @pi-desktop/desktop run build` | all succeed | `evidence/build-identity.json`, `evidence/candidate-identity.json` |
| S7 product probe (real plugin host + real core) | `node tests/godot-round3/S7/probe-product.mjs --provision-executor` | executor registers (real preflight), job runs import -> export, check unavailable in a non-Electron harness | `evidence/s7-probe-int2/` |
| S7 product probe, as shipped | same without `--provision-executor` | `GODOT_BROKER_MISSING` | `evidence/s7-probe-int2-ashipped/` |
| Real panel -> gateway -> plugin -> core | `node tests/godot-remaining/e/world-create-e2e.mjs` | 19/19 | console |
| Client creation factory | `node --test vendor/pi-desktop/apps/desktop/test/godot-world-creation.test.mjs` | 15/15 | console |
| Core RPC registration | `node tests/godot-round3/S1/core-rpc-registration.mjs` | 54/54 | console |
| Plugin private routes | `node tests/godot-round3/S2/plugin-routes.mjs` | 5/5 | console |
| S3 package/install | `node --test tests/godot-round3/S3/*.test.mjs` | 35/35 | console |
| S5 preview cancel | `node --test tests/godot-round3/S5/*.test.mjs` | 3/3 | console |
| S6 model-tool services | `node --test tests/godot-round3/S6/*.test.mjs` | 29/30 (one stale fixture, see 5) | console |
| Frozen-set verifier | `tests/godot-remaining/I/run.mjs` audit/replay/negative | 0/30, 6 passed/1 insufficient/23 not-run, 2 failed/28 not-run | `evidence/s7-i-*/` |

Reports: `STARTING-POINT.md`, `INTEGRATION-REPORT-01.md`, `INTEGRATION-REPORT-02.md`,
`INTEGRATION-REPORT-03.md`.

## 3. Unverified work added by this handoff

`tests/godot-round3/S7/probe-electron.mjs` + `tests/godot-round3/S7/fixtures/probe-electron-main.mjs`
were written to close the last gap: run the real `PluginRuntime` and the real `GodotBuildVerifier`
inside a hidden offscreen Electron process, then drive world create -> project create/patch ->
`godot_build_start(mode=check)` -> poll -> `godot_candidate_read`.

**Status: never produced evidence.** The first run was aborted on user instruction; no report.json
exists for it and nothing here should be quoted as a result. What is known:

- the launcher bundles the probe entry together with the product main-process modules into
  `vendor/pi-desktop/apps/desktop/out/main/s7-probe.cjs` so `GodotBuildVerifier` resolves its
  packaged preload at `out/preload/godot-check.cjs` (verified to exist);
- the Electron 43.4.0 binary was materialised into this worktree by
  `node -e "require('electron')"` run from `vendor/pi-desktop/apps/desktop` (it now exists at
  `vendor/pi-desktop/node_modules/.pnpm/electron@43.4.0_supports-color@7.2.0/node_modules/electron/dist/electron.exe`);
  `CRAFTMINE_ELECTRON_BIN` overrides it;
- the executor toolchain is provisioned into the isolated plugin data directory by the probe itself
  (broker + editor/templates copy + bridge + lock), because the host strips `CRAFTMINE_GODOT_*`;
- the probe never shows a window, never focuses one and never sends input.

Run it with:

```powershell
cd 'D:\Craftmine World-worktrees\godot-round3-s7-20260910'
$env:CRAFTMINE_GODOT_CACHE_DIR = 'D:\Craftmine World\desktop\build\godot\4.7.2-stable'
node tests/godot-round3/S7/probe-electron.mjs --out test-results/s7-electron-1
```

Expected first outcomes to watch for: whether `godot_jobs mode=status` reaches `build=true
check=true` (executor registered with the verifier present), and whether the terminal job is
`passed` with a candidate or `failed` with the verifier's real assertion detail. Anything else is a
harness bug, not a product result, and must be reported as such.

## 4. Still open (owners)

| # | Item | Owner |
| --- | --- | --- |
| 1 | Isolated check / candidate chain not yet evidenced (section 3) | S7 (next) |
| 2 | Single real-model requirement not run; must wait for 1 | S7 |
| 3 | `godot_history` method names: defaults `content.version`/`content.checkpoint`/`content.mergeCandidate`/`content.operationResult` vs the core's `content.version.list`/`content.checkpoint.list`; S2's `historyMethods` array has the wrong shape for `createHistoryService` | S2 (+S6 contract) |
| 4 | No packaging step installs the executor broker/engine; a shipped build reports `GODOT_BROKER_MISSING` | S8 (+S2) |
| 5 | `tests/godot-round3/S6/plugin-load.test.mjs` staging list predates S2's `asset-service.mjs`/`reuse-service.mjs` requires (product bundle itself is correct, 24 files) | S6 |
| 6 | Frozen live mode refused: `FREEZE.lock.json` pins `docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md` at `92b0a04f...67592`, which no longer exists anywhere; re-freezing is a main-task decision | main task |
| 7 | `tests/godot-remaining/I/README.md` still says 14 categories / 28 rounds / 128 assertions; the frozen set is 15 / 30 / 141 | S7 (doc only) |
| 8 | C's weaker `reapTaskProcess` is still in the tree; S2's hardened recovery is merged but the old path must not be exercised or shipped | S2 |

## 5. Input policy honoured throughout

No real mouse/keyboard, no Playwright `click/fill/mouse/keyboard`, no `requestPointerLock`, no window
focus or activation, no `tests/browser.mjs` or `tests/modules-browser.mjs`. Electron work is
offscreen and hidden with isolated profiles; audio was never played.
