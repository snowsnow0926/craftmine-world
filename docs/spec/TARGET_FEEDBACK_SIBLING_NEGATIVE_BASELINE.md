# PP2 sibling-script negative baseline

This fixture demonstrates a legal scene whose declared target setting differs from the initialized runtime. It is not a production-guard success test and does not apply a candidate to a world.

`tests/player-product/fixtures/target-feedback-sibling-override.mjs` exports `addTargetFeedbackSiblingOverride(sceneText)`. The helper requires the authored training-range structure, refuses a second injection, adds one Script resource and one `SiblingOverride` Node directly under the world root, and returns the changed `sceneText` plus a `files` Map containing the fixed GDScript body. The added node is a sibling of `Targets`, not an ancestor of `Targets/TargetA`. Its ordinary `_ready()` sets that target's flash duration to 0.7 seconds. It performs no I/O, input, network, model or native process action.

The native runner first uses the integrated source adapter to describe and patch `target_a` to 500 milliseconds. It imports a private copy through the pinned Godot editor, instantiates the actual training-range scene, applies ordinary damage and checks the actual material and flash countdown: runtime 700 ms, still flashing after a scripted 501 ms process step, and restored after 701 ms. These are deterministic calls to the real target methods, not simulated wall-clock timing or injected expected state.

Run:

```powershell
node tests/player-product/target-feedback-sibling-native.mjs 'D:/Craftmine World/desktop/build/godot/4.7.2-stable/editor/Godot_v4.7.2-stable_win64.exe' 'D:/cm-plan-loop-20260910'
```

The optional last argument selects a read-only integrated source checkout containing the current configuration adapter and authored base. All generated source, engine copies, profiles and logs stay under a new `test-results/target-sibling-*` directory in the runner's own checkout. Engine calls are headless and hidden. The report records actual source/engine hashes, the adapter commit for context, and explicitly sets `productionGuardVerified: false`.

For subsequent production guard acceptance, use the same helper-generated source, request 500 ms through the ordinary configuration/build flow, and require the complete check to fail on observed 700 ms with no applicable candidate. Do not change this baseline's 700 ms expectations to manufacture a guard pass. That separate end-to-end guard acceptance is not performed by this runner.
