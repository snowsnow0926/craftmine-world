# S7 round-three integration report 03 - R2 client fixes and joint verification

Date: 2026-09-10. Status: **all six round-three module deliveries plus R2's client fixes are
integrated and rebuilt. The baseline P0 wiring breakpoints are closed; the remaining gap is that
no S7 harness yet drives the Electron host, so the isolated check and everything after it are
still unverified end to end.**

## 1. Consumed

| Source | Head | Merge |
| --- | --- | --- |
| R2 client fixes | `165b5bf` (`1b45d06`, `bfbb5ee`) | `e90247bc58a9` |

Conflict: `plugin-runtime.ts` only. R2 named the injected verifier `godotVerification`, S2/S6 had
named it `craftmineGodotCheck`. Resolved by declaring both and resolving
`this.services.godotVerification ?? this.services.craftmineGodotCheck` in the
`craftmine.godotCheck` case, so R2's `index.ts` injection and the plugin's private bridge both work
without renaming either owner's code.

## 2. Baseline breakpoints re-checked after R2

| # | Breakpoint | Status | Evidence |
| --- | --- | --- | --- |
| P0-2 | host isolated check never wired | **fixed** | `index.ts:602` `new GodotBuildVerifier()`, `:606` `godotVerification: {...}` |
| P0-3 | creation returns after initialize; world stays pending; unsafe directory delete | **fixed** | `godot-world-creation.ts` now queries `godotWorld.initStatus` on failure and only removes the managed copy when the core proves it never registered the world and the operation owns the directory; stable operation id kept for retries |
| P0-4 | double path -> URL conversion | **fixed** | `index.ts:936` passes a plain path; `godot-world-creation.ts:277` calls `pathToFileURL` once |
| P0-1 | `godotWorld.*` unreachable | fixed earlier (S2) | `plugin-runtime.ts:942`, `host-requests.cjs:125` |
| P0-5 | core RPC gaps | fixed earlier (S1/S5) | `main.rs` asset/package/portable routes |
| P0-6 | no executor hand-off | fixed earlier (S2/S6) | probe report 02 section 4.2 |
| P0-7 | services missing from the bundle | fixed earlier (S2/S6) | 24-file bundle, production construction |

## 3. Joint verification on the integrated build

Every command below ran against this branch after the rebuild, with no OS input, no browser
automation of mouse/keyboard, and no Pointer Lock.

| Verification | Command | Result |
| --- | --- | --- |
| Real panel -> gateway -> plugin -> Rust core create/switch/restart | `node tests/godot-remaining/e/world-create-e2e.mjs` | **19/19 passed**; the page asserts it never requested Pointer Lock or focus; two worlds survive a plugin+core restart |
| Client creation factory (identity, retry id, verifier injection, panel coordinator) | `node --test vendor/pi-desktop/apps/desktop/test/godot-world-creation.test.mjs` | **15/15 passed** |
| Core RPC registration and validation | `node tests/godot-round3/S1/core-rpc-registration.mjs` | **54/54 passed** |
| Plugin private routes and packaged services | `node tests/godot-round3/S2/plugin-routes.mjs` | **5/5 passed** |
| S7 product probe, toolchain provisioned | `node tests/godot-round3/S7/probe-product.mjs --provision-executor` | executor registers, job runs import -> export, check stage reports `Isolated Godot check unavailable` **in the probe harness only** (the probe does not construct the Electron host service) |
| S7 product probe, as shipped | same without `--provision-executor` | `GODOT_BROKER_MISSING` (no packaging path installs the broker; owner S2/S8) |
| Frozen-set verifier | `tests/godot-remaining/I/run.mjs` audit/replay/negative | unchanged: 0/30, 6 passed/1 insufficient/23 not-run, 2 failed/28 not-run; live still refused on provenance |

## 4. What is still not verified, and why

1. **The full chain create -> build -> check -> candidate -> apply -> observe -> modify has not
   been run by S7.** The isolated check runs inside the Electron host (`GodotBuildVerifier` +
   offscreen renderer), which no S7 harness currently constructs. The probe stops at the check
   stage by construction; the panel E2E covers creation, not the managed build.
2. **No real-model requirement has been run in round three.** With the check stage unverified,
   a model batch would still stop at the same place; the audit forbids consuming it for a known
   gap.
3. **Shipped-build executor discovery is still missing** (P1-4): no packaging step installs the
   broker or engine, and the host strips `CRAFTMINE_GODOT_*`. A packaged client reports
   `GODOT_BROKER_MISSING`.
4. **History tool method names** (P1-3): `godot-history.cjs` defaults to `content.version` /
   `content.checkpoint` / `content.mergeCandidate` / `content.operationResult`, while the core
   registers `content.version.list` / `content.checkpoint.list` and has no merge/operation
   methods. Needs an object-shaped `historyMethods` provider from S2.
5. Frozen-set live mode remains refused because the pinned provenance document
   `docs/GODOT_MULTIBASE_DEVELOPMENT_PLAN.md` is not reproducible (report 01 section 4).

## 5. Next S7 steps

1. Build a product-level E2E that runs the real Electron main (verifier injected) and drives one
   create -> build -> check -> candidate -> apply -> observe cycle headlessly, with an isolated
   data directory. This is the gate for the real-model requirement.
2. Then run one real-model requirement through the product hook and record usage/unknown.
3. Re-run the frozen set and the joint suites after every further integration.
4. Freeze the functional candidate and hand it to S8; re-verify from the package.

## 6. Reproduce

```powershell
$wt = 'D:\Craftmine World-worktrees\godot-round3-s7-20260910'; cd $wt
cd vendor/pi-desktop; cargo build --release -p craftmine-core; pnpm --filter @pi-desktop/desktop run build; cd ..\..
node desktop/build-world-plugin.mjs; node desktop/prepare-client.mjs
node tests/godot-remaining/e/world-create-e2e.mjs
node --test vendor/pi-desktop/apps/desktop/test/godot-world-creation.test.mjs
node tests/godot-round3/S1/core-rpc-registration.mjs
node tests/godot-round3/S2/plugin-routes.mjs
```
