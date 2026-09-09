# F acceptance matrix

Status at the development-client checkpoint, 2026-09-09. This matrix does not declare all W2–W5 complete. F's packaged representative run is pending the integrated source freeze.

| Remaining-plan item | Evidence actually obtained by F | Status / remaining boundary |
| --- | --- | --- |
| Immutable tree/flower/gameplay versions, dependencies, search/install | Native capture and exact-reference Agent install across full restart/new session; 5 real Rust-process tests of fixed dependencies, hashes, creation bindings, cross-world reuse | Passed for covered native tree and component cases; native multi-version selection UI not separately tested |
| Native configured model → tree → changes → checks/review → player application → restart/new-session reuse | Actual PI Agent baseline, 3-compaction task, reuse chain plus one explicit schema-corrected real review | Passed in development builds; final package representative pending |
| Rules, corrections, source provenance, invalidation, world scope | Actual player-rule propose/search/replay; Rust-process scope/false-evidence/staleness/retirement tests | Passed covered paths; actual multi-message user correction through three compactions not exercised |
| Whole-request budgets, summaries/reviews, model changes, on-demand tools | Durable request ledger independently audited: 3 actual summaries + review share one owner; actual ToolSearch in transcript; unknown crash request keeps its reserve | Passed covered paths; actual provider/window switching not tested |
| Three actual compactions with green completion | 3 persisted PI checkpoints, 4 saved edits, actual application and full restart; 22 requests, 200900 provider tokens | Passed development; packaged repeat pending |
| Completed task stays completed, cancelled old task cannot resume implicitly | Completed baseline restarts; native fixed negative late-write test; real interrupted task needs explicit panel resume | Partial: cancel then start an unrelated request is not a real-model scenario in this batch |
| Crash, lease, explicit recovery/discard, message recovery | Kill own Electron after real patch; restart transcript and revision retained; actual panel resume creates generation 2 with same budget owner, completes and applies after explicit corrected review; real second-writer refusal component test | Passed patch-stage recovery; crashes during verify/apply/save and player discard not exhaustively exercised |
| File tools cannot bypass transaction; project/world switching and old receipts | Native forged identity, stale evidence, late writes and receipt replay negatives; real Rust cross-world/scope tests | Covered negative/component cases; full actual two-project UI switch during live generation remains untested |
| Thin ground-level flowers/grass, passage, appearance | F reran D actual browser/game/Worker suite: flower/grass geometry at y=6 and noncollision; viewed real `garden.png` showing petals, stem, slender grass | Passed geometry/actual render; artistic preference and physical walking remain player checks |
| Health, melee, shooting, cooldown, ammo, death/rewards, migration/restart | F reran D actual game/Worker suite 27 checks and 7 runtime tests: ray hits/misses/cover/range, ammo/reload/cooldown, kill/reward, restart persistence | Passed covered game/runtime fixtures; not a model-authored gameplay package in the native client |
| Extension resource addition, sandbox loading, real assertions, no-op rejection | Actual restricted extension Worker, remapped instance, verifier missing-dependency rejection, self-tests green/no-op red, timeout/unauthorized-effect rejection | Passed actual game/Worker fixture paths; complete native model-authored new extension chain remains untested |
| PI desktop features, Chinese, model settings, selection, layouts/theme/split persistence | F native main renderer/preload + actual model configuration verified; C's separate reported layout/UI evidence available | Partial: F has not performed the full desktop feature regression matrix |
| Windows credential protection/migration | F latest native reruns actually used E's DPAPI-enabled host to save/read the provider; E separate Rust tests/package report | Partial: no different Windows account/machine migration or deliberate system-protection failure |
| Backup validation/rollback, failed restore preserves original | Actual renderer/E file grants/Rust export → inspect → byte change refused → original bytes restored → fresh grant/new operation → completed restore; real Rust corrupt/CAS/cancel/portable trust tests | Passed local portable-domain paths; interrupted disk-full or clean-machine restore not tested |
| First install, offline opening, upgrade protection, identity/update/protocol | E evidence identifies its earlier independently built package; F package runner now refuses mismatched binaries/source manifest | Pending integrated final package run; clean OS installer/upgrade validation remains unavailable |
| Diagnostics/redaction, performance/size, licenses/tutorials | No keys in F reports; startup-to-complete timing retained; D image inspected; final package runner checks source ZIP hash | Partial: no stable peak-memory/FPS sample. Late memory sampling found already-exited processes and is explicitly unusable. Final package size/hash proof pending |
| Visible composition, physical movement, clean Windows installation | Not run, per user's no-input/no-focus constraint | Unverified; explicit isolated environment or player checklist required |

## Representative final-package gate

After E supplies the integrated package, set `CRAFTMINE_PACKAGED_ROOT`, authorized `CRAFTMINE_LIVE_CONFIG`, and `CRAFTMINE_F_COMPACTIONS=3`; run `node tests/dispatch/f/native-agent.mjs`, then `node tests/dispatch/f/audit-native.mjs <new-F-profile>`. Require actual packaged executable/ASAR/binaries/source hash agreement, three real checkpoints, final tree geometry, completed actual review/application, full restart, preserved cumulative ledger and zero input audit. The package result will be appended separately; the development results above will not be relabeled as packaged tests.

## Suggested personal-use performance gates (not yet accepted measurements)

- On one declared Windows machine, with other builds stopped: five isolated launches; world-ready p95 <= 10 seconds.
- The included small garden at 1200×800: sustained 30 FPS or more for 60 seconds, measured by actual game frames.
- Sum simultaneous client-owned process working sets <= 1.5 GiB during the small-garden scenario; measure per process and include Rust host/core/sidecar. Do not sum unrelated historical peaks and call that the simultaneous peak.
- Local patch/read tool p95 <= 1 second across a fixed fixture workload. Model/network time is measured separately, not attributed to local harness overhead.
- Package size is recorded with source archive included and excluded; no unsupported size pass/fail claim is made until G agrees a distribution target.

## Manual / isolated-environment checklist

On an explicitly provided clean Windows VM: verify unsigned-package install identity and destination, first start without developer dependencies, offline world open/save, remove/reinstall behavior, same-version repair, upgrade failure rollback, DPAPI failure message, backup transfer, app-source/license availability, visible layout at common DPI, real WASD movement/pointer capture/release, and uninstall data choice. F does not run these against the user's current desktop.
