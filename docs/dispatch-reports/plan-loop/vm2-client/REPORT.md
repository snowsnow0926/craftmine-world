# VM2 actual development desktop acceptance

Final run: `C:/cm-vm2/test-results/desktop-native-vm2-XPMPZn`.
Tested source: `774a3453f8b0f0c8014be2a3128aced45739a3c8`.
Result: **9/9 passed**, process exit **0**, no forced stop. Actual headless exit
reported `violations:[]`, `pageErrors:[]`, `shutdownFailures:[]`. The original
explicitly authorized completed test core inventory remained unchanged.

## What was actually exercised

- Newly compiled Main and React, using the real plugin navigation bridge and
  history service. The first-person world is a copied genuinely adopted 500 ms
  archive from `desktop-native-parameters-6Uvnzp`, not a seeded applied Git ref.
- Finite `historyView` uses form submission and DOM reads. It has no script,
  arbitrary selector/RPC, write, branch-creation, check or application capability.
  Forms use the same handlers as ordinary player actions; no real/simulated mouse
  or keyboard, click/fill, focus or Pointer Lock was used.
- Real history sheet opening, historical comparison and exact source patch
  rendering each preserved all native progress fields, core database currentHash
  and existing workbench operation records. Opening history did not open an
  editor or create a comparison automatically.
- A separate test-owned compiled legacy world was opened through the product.
  The former world's comparison request failed with `GODOT_WORLD_CHANGED`.
  Returning to the original Godot world succeeded.
- In an explicitly separate mutation phase, the existing finite target adjustment
  flow generated a 501 ms source revision, real broker check and validated runtime
  requirement assertion. A fresh history view was then captured with the new
  source head but old formal OID. Actual candidate preview/application changed
  the formal OID while leaving that source head unchanged. Its old comparison
  request failed with `GODOT_HISTORY_VIEW_STALE`.
- React refresh/self-comparison and actual panel teardown again preserved complete
  progress, database fingerprint and operation records. The client completed its
  owned shutdown successfully.

## Build and identity

Dependencies were installed offline from the local pnpm cache, with lifecycle
scripts disabled (796 cached, zero downloaded). Actual `pnpm build:js` and desktop
TypeScript noEmit completed successfully. Core and host were built from this
worktree's source, including the literal content.diff fix. Core SHA-256:
`4ae551823094146d8b2acebfd24d0de6d09a37b5d1c069f1919e6dd3a8f23784`.
Main SHA-256:
`27555c3b9e9def06cbf7de522abf9993bc647a7cd3326f3bfa83ed8122a281f1`.
The runtime stage was generated against the tested clean commit and verified
its broker/source identity and pinned engine/template/Git bytes. Supplied caches
and the original broker were read only. Compiled feature code was unchanged
between its build and final run; intervening commits fixed only runner setup and
recorded build logs. No old core or ASAR substituted for current code.

The first default-parallel Rust compile failed in serde_derive rustc with
`0xc0000005 / STATUS_ACCESS_VIOLATION`; the tool output was retained in the task,
not reclassified as a source failure. The already-started jobs=2 retry finished
successfully in 1m20s (`raw/rust-build.log`). Future builds follow the coordinator's
jobs=1 requirement. `raw/build-js.log` records the actual desktop build. The
finite probe and actual shutdown-module tests passed **6/6**; these controlled
fixtures are separate from the nine actual-client checks.

## Retained failures and limits

- `native-first-failure.json` / `jo3oV6`: zero completed steps; the harness omitted
  the world binding on backup.status and Main correctly rejected
  `SELECTED_WORLD_CHANGED`. The runner now uses the existing world-bound panel
  channel. Shutdown was clean and archive unchanged.
- `native-switch-fixture-failure.json` / `ldFIEO`: the three initial real UI reads
  passed, but the runner's incomplete legacy fixture lacked compileScene output;
  returning from it timed out. It was replaced with actual compileScene and
  INITIAL_SNAPSHOT, plus an explicit legacy-ready wait. No timeout was extended.
- `HeVNdG`: a subsequent setup-only attempt omitted compileScene's required
  `night` field and failed before Electron launch. Its command output is retained
  in the task. The required field and setup-failure report persistence were added;
  it is not counted as a native run or a passing result.
- Software offscreen WebGL framebuffer warnings remain visible in the final
  stdout log. Empty pageErrors does not mean zero renderer-console diagnostics.
- This is a development client acceptance, not a new sealed package, installer,
  clean-machine, signature or model acceptance. It does not extend the frozen
  release's feature claims. No personal profile or credential store was read.

The copied reports and final stdout/stderr are hashed by `evidence-index.json`.
The full original profiles remain separate on C:; no previous run was deleted.
Executable command and precise scope are in
`vendor/pi-desktop/docs/spec/godot-version-diff-desktop-acceptance.md`.
