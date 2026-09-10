# Finite runtime parameter requirements

Production verifier implementation: `7070720`. Actual authored native fixture:
`test-results/target-feedback-verifier-lANgAN`, completed 2026-09-10.

The official training-range source was patched through the finite configuration
adapter to 500 ms. The fixed broker independently imported and exported that
source, then the real production verifier ran Godot Web in isolated hidden
Electron. It observed `target_a = 500` after load and after resume/three captures;
all seven runtime assertions passed. The three 960x640 captures were nonblank
(35/35 colored samples); their hashes were identical, so this is not a claim of
visible animation. Existing liveness checks and snapshot response were retained.

The negative scene used Plato's explicit sibling override fixture. The source
parameter patch still declared 500 ms; actual Godot reported 700 ms. The verifier
returned `passed:false`, `runtime.target-feedback:false`, and
`GODOT_CHECK_TARGET_FEEDBACK_MISMATCH:loaded`, preserving the one actual 700 ms
observation. It stopped before the rendering phase and cleaned up successfully.
No expected runtime value was assigned by the test transport or verifier.

Both source trees had separate actual broker import/export receipts. Source
manifests/digests, output hashes, process/network preflight and cleanup were
checked. The browser bridge was copied from the tested source tree and rehashed.
No engine cache, root build output or user profile was modified.

The earlier `IYtnBi` harness attempt let Electron exit normally when the verifier
destroyed its only window, before returning its report. The harness now handles
`window-all-closed` like the existing full-chain fixture. Its original missing
report failure, raw logs and rerun exit record are preserved under
`harness-failure`; they were not rewritten as a product pass.

All 49 archived raw files have original paths, sizes and SHA-256 hashes in
`raw-evidence-index.json`. The first run's absent report remains absent.

Boundaries: this fixture invokes the real verifier with authored descriptors;
it does not exercise Rust-issued requirements, executor forwarding, core finish
rejection or complete client candidate adoption/restart. Those are separate
integration requirements. Two live samples cover the bounded check window,
not arbitrary later script behavior. No model, visible window or input was used.

Run `tests/player-product/target-feedback-verifier-native.mjs` with explicit
`CRAFTMINE_NATIVE_DEPENDENCY_ROOT`, `CRAFTMINE_GODOT_BROKER_BIN` and
`CRAFTMINE_GODOT_ENGINE_ROOT`. It always creates a fresh owned results directory.
The fixture consumes `d6d4437`'s sibling helper, already independently delivered.
