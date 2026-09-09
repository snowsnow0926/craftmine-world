# Dispatch D: persistent gameplay runtime

The existing web renderer and bounded behavior/extension Workers remain the runtime. No generated source becomes a native plugin.

## Startup and persistent state

Existing `craftmine.behavior-state/2` and `/3` module records accept optional `initialized: boolean` and `extensions: Record<extensionId, {version, state}>`. Fresh instances receive `initialized: false`. A successful startup marks the record initialized; restarting or upgrading that instance does not run startup again. Legacy persisted records without the field are treated as initialized. Startup failure retains the module error. New instances have independent initialization; preview/application preflight state remains separate from committed world state.

Extension state is per behavior instance and exact extension version. It survives snapshots and Worker recreation. Incompatible extension requirements reject migration and preserve the old save. The extension ABI state remains a bounded JSON record, and no code executes during migration. Target state, health, inventory and behavior migration retain their existing ownership.

Gameplay snapshots additionally contain optional `cooldown` in [0, 10]. Missing legacy cooldown means zero. Ranged reload progress, ammunition and cooldown survive restart. Incoming attack distance must be finite and nonnegative. Tick duration is bounded and nonnegative.

## Portable extensions

Portable behavior calls execute extensions using the authored local object identifiers and coordinates. The host maps returned object patches and target damage/revive effects back through the explicit instance binding. Extension source and fixed-version target declarations remain unchanged. Arbitrary state strings and item identifiers are not globally rewritten. `training-token` in the example is an intentionally shared item.

## Executable review advice

Extension self-test results retain the actual sandbox trace. Adversarial review assertions execute against those traces and report `reviewExecution` with scope `extension-selftest-traces`. Failed design assertions remain advisory and are not reclassified as mandatory player requirements. Self-tests and their no-op negative control remain machine gates. This does not claim the review explores inputs absent from the supplied self-tests.

The extension loader is frozen. G must review its implementation diff and explicitly update its single checksum before full-kernel verification passes. No assertion evaluator or expected gameplay value is changed.

## Physical acceptance and selection

Preview `request-step` attack now invokes the same physical raycast/ammunition/damage path as player attacks. `equip` accepts `weapon: ranged | melee`; `reload` starts the real reload timer. Optional player yaw and pitch are bounded by existing save limits. Existing key/interact/contact/land events retain their behavior-hook scope; they are not physical input simulation. Observations additionally include the actual `gameplay` snapshot. Failure of an attack-triggered behavior fails the request.

A loaded game may receive a host-bound `worldId`. Only formal worlds emit `selection` with `{worldId, build:{id,hash}, objectId, selectionRevision}` after the actual raycast selection changes. Missing world identity produces no authoritative selection event. The desktop must independently reject stale world/build/nonce/source/revision and unknown object IDs. This event does not grant filesystem or tool access.

## E2E scenarios

`node tests/dispatch/d/headless.mjs` runs independent headless Chromium and actual game/Workers: thin flowers/grass, physical hit/miss/occlusion, melee range/cooldown, empty ammunition, reload through restart, target death/rewards, persistent player death, fixed-version extension invocation before/after instance remapping and restart, missing dependency, no-op negative control, Worker timeout/permission failures, and bound selection. It disables pointer lock and focus before scripts load and never sends OS input.

Actual PI model creation, Rust library capture/prepareInstall/application receipts, package execution and desktop selection rejection remain G/F integration scenarios. Fixed examples do not count as model-authored content or full native acceptance.
