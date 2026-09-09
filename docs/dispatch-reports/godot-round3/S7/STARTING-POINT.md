# S7 round-three integration starting point

Status: **consumable development baseline, not an accepted release.** This commit set is the
common starting point for S1-S6/R2/S8 and for S7's own independent acceptance work.

## 1. Source identity

| Field | Value |
| --- | --- |
| Branch | `codex/godot-round3-s7-20260910` |
| Baseline commit | `d77823c2bface9de70aa92da005b075e861a3780` |
| Tree | `d89920924bae19f110a98684097b7c110a76c783` |
| Worktree | `D:/Craftmine World-worktrees/godot-round3-s7-20260910` |
| Dirty state | clean (no tracked or untracked changes) |
| Tracked files | 4211 |
| Source inventory SHA-256 | `acfcc015c3a16801fa72d2ff4774fe6bb980c96f5b31be424b4ff23e2fde6f63` |

The inventory hash is `sha256` over the sorted `git ls-tree -r <commit> --format='%(objectname) %(path)'`
lines of the baseline commit, so it identifies the exact blob set, not a hash prefix or a moving worktree.

Reproduce:

```powershell
git -C "D:/Craftmine World" worktree add "D:/Craftmine World-worktrees/godot-round3-s7-20260910" codex/godot-round3-s7-20260910
```

## 2. Included history (committed sources consumed)

| Source | Commit consumed | Merged by | Notes |
| --- | --- | --- | --- |
| Round-two docs (master head) | `c2e592f19cd12f41e8db2d28c858407c22649cbe` | base commit | dispatch + audit documents only |
| R2 client integration head | `2fa3c7c4f55b7b7827d3313d3a0289023aafca24` | `3f8edc7` | main client tree for this round |
| R1 core/Git | `62a700f13f061e1b5d8cafdc6de33ee5ec536b87` | already inside R2 | content history, 25 content RPCs |
| C managed executor | `f35c5c7ab944cbcab54151d9bd490c905a82942e` | already inside R2 | **unsafe reclaim path still present**, see hazards |
| R3 bases | `cf4704f1b20f5422346c5f6020d29b5a4a1d0ad8` | already inside R2 | four bases, mining, scene install |
| R4 creation package | `5ee920612d94d4930aa5d9c08485e10a197bff09` | already inside R2 | package format/zip, install planner |
| R5 durable backups | `58f44add2d0388e4bdf3c46eea6d21eab1f0478e` | already inside R2 | portable archive with bodies |
| R6 asset library | `64948746fa052411669d776d19e81c76ee35d518` | `c1850c7` | final evidence refresh only; product code already in R2 |
| R7 model tools | `bba784724541369d1368a52ea8966a73b2184b22` | `df23691` | 1 mechanical conflict, see 4.1 |
| R8 model acceptance driver | `d726ec3b2ef730e26e688242589702edbf28ff6c` | `def7987` | driver + 62-call ledger |
| R9 release tooling | `dc6e33842d8128df27ccf739d54b3f4bee098d32` | `2e46324` | release scripts, licence material |
| B final sandbox broker | `5cf65eb163e7213edb8a37d2e3c2be98b81da050` | `d77823c` | final isolated broker + recovery ledger |

Ancestry was checked with `git merge-base --is-ancestor`, so no tree was copied and no historical
commit was rewritten. `node --check` passes on all 30 JavaScript sources of
`plugins/craftmine-world` plus `desktop/build-world-plugin.mjs`.

## 3. Not included / not yet usable

| Item | State | Owner |
| --- | --- | --- |
| Round-three S1 commits | none yet; `codex/godot-round3-s1-20260910` = `24edb0c875bd` is only the baseline merge | S1 |
| Round-three S2 commits | none yet; `5838ca3b826a` only merges B's committed work | S2 |
| Round-three S3 commits | none yet; branch equals the S1 baseline `24edb0c875bd` | S3 |
| Round-three S4 commits | none yet; `e79dd89b0bae` is only the baseline merge | S4 |
| S5 / S6 | no branches present at the time of writing | S5 / S6 |
| R2 client continuation | uncommitted work in the R2 worktree is **not** consumed | R2 |
| S8 candidate package | not produced | S8 |
| Round-three product builds (core/plugin/Electron) | not built from this commit yet | S7 |

## 4. Known hazards carried into the baseline

### 4.1 Mechanical merge resolution to re-verify

`desktop/build-world-plugin.mjs` conflicted between R2 (`godot-executor.cjs`) and R7 (eight
`godot-*.cjs` tool modules). It was resolved as a union of both copy lists. The file is owned by
S2; the union must be re-checked when S2 next commits.

### 4.2 Plugin build list does not cover all module sources

`desktop/build-world-plugin.mjs` copies 19 files. These sources exist in
`plugins/craftmine-world` but are **not** copied into `desktop/build/craftmine.world`, and are not
required by `main.cjs` either:

`asset-service.mjs`, `library-service.mjs`, `memory-service.mjs`, `package-format.mjs`,
`package-zip.mjs`, `reuse-service.mjs`, `workbench-ui.mjs`, `view.mjs`, `world.html`
(the last three are handled by separate build steps or the Electron host).

Consequence: R6's asset service and R4's package services are compiled in the Rust/JS trees but not
constructed in the shipped plugin, matching audit section 3.5. Formal wiring is S2's (plugin
construction) and S5's/S3's (service implementations). This is a **missing implementation**, not a
baseline acceptance failure.

### 4.3 Unsafe process reclaim path is present but must not run

`plugins/craftmine-world/godot-executor.cjs` still contains C's `reapTaskProcess` PID+image-name
reclaim (`taskkill /T /F` without creation time or full path). It is inside the baseline tree, so it
must not be exercised or shipped as a release candidate until S2 lands the hardened recovery entry
(consuming B's `5cf65eb`). S7 will not run that path.

### 4.4 Known starting regressions (must stay in the failure denominator)

1. Core regression: one R5 x R1 failure in the latest R2 core run.
2. Asset import: `scan` crash on duplicate/same-name results.

Both are inherited from R2's own records and are listed here so the round-three ledger starts with
the same denominator.

## 5. What this baseline is and is not

- It is the common, committed source for development and for S7's integration builds.
- It is **not** accepted: no round-three build, no formal RPC/private-service/host-injection check,
  no real-model run and no candidate package have been produced from it yet.
- Consuming a module's work means merging its committed branch and rebuilding; patches, temporary
  registrations and uncommitted trees do not count.
