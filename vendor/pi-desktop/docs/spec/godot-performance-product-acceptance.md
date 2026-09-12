# GU7: sealed performance tool product verification

Run `desktop-native-complete-PWS1PH` passed against the complete sealed desktop
package built from `56b5aeca298c20d6575c66bdf60dd25479358651`.
The driver was `tests/godot-agent/performance-product.mjs` at `f676b333`.
This is a no-model product integration test, not ordinary player performance
acceptance. Later driver logging additions retain each RPC response/error as well;
this historical successful report contains the full first/reopened probe, receipt,
snapshot and observation results but only input records for intermediate polls.

The test created a fresh protected profile, then used ordinary `world.create`
to initialize a creation-sandbox blank world through the product's real build
pipeline. `playerCreateSession` created an ordinary empty session. A fixed
protected parent-controller method, `godotPerformanceTool`, began a real session
turn and domain binding, invoked the already registered low-risk
`plugin_craftmine_world_godot_performance_observe` tool through the existing plugin
child IPC, and finalized the turn. It never constructed another broker instance
or invoked a model. The entry accepts only session/world narrowing; it does not
accept tool names, tool arguments, code, or caller-supplied turn identities.

## Results

| Phase | OS renderer working set | Instance |
| --- | ---: | --- |
| Initial full app launch | 423.7109375 MiB | `a9cad53d9d65efcace7a5207` |
| Full process cold reopen | 417.89453125 MiB | `6f633e5b407ba66dacdd7858` |

Both registered tool results were available, matched the current world/build/
instance, and left the frozen gameplay snapshot unchanged. Frame time, physics
time, object count and GPU time all remained unknown. These memory values describe
the whole OS renderer process; their difference is not evidence of optimization.

The normal `godot.runtimeSave` product operation returned real Core progress
receipts in both launches. The receipt world/build/content hash and the entire
snapshot matched across cold reopen. This uses actual Core persistence, unlike the
earlier isolated host fixture's local-file receipt. Both complete app processes
exited 0 without forced termination. Their shutdown reports had empty violations,
pageErrors and shutdownFailures; all inspected windows stayed hidden, unfocusable
and offscreen. The sealed package identity checks passed before and after.

Runtime logs contain WebGL zero-size framebuffer warnings during offscreen
initialization. The scene subsequently initialized and answered real observation
and snapshot requests; the warnings are preserved in the archived stdout rather
than suppressed. This run makes no visual quality or frame timing claim.

## Evidence and reproduction

Raw report and per-launch stdout are archived at
`vendor/pi-desktop/docs/evidence/gu7-sealed-performance-product-20260912/`.
The original isolated profile is at
`D:/cm-gu7-performance-product-0912/test-results/desktop-native-complete-PWS1PH/profile`.
It can be audited after shutdown without touching a personal profile.

Run with an explicitly verified package path and full commit:

```
CRAFTMINE_EXPECTED_PACKAGE_COMMIT=<40-character commit>
node tests/godot-agent/performance-product.mjs --packaged-root <sealed win-unpacked>
```

The driver strips model/evaluation credentials and configuration. It supports
normal signal cancellation and an isolated output `cancel.request` file. Ordinary
model discovery/use of the tool, player-scale scenes, optimization preserving
gameplay, and trusted engine/GPU metrics remain unverified.
