# Explicit engine monitor bridge profile

`runtime_bridge_engine_v1.gd` extends a separate byte-identical copy of the original
runtime bridge. Its single new operation is `engine-performance`. Capabilities
advertise this operation and explicit `engine-monitor/1`, envelope format, and
`hex-64` nonce encoding. Normal operations delegate to the original implementation.
The original `runtime_bridge.gd` source bytes remain unchanged.

The new request must contain exactly `id`, `op`, `args`, `worldId`, `buildId`, and
`instanceId`; `args` contains only a 64-character lowercase hex nonce. IDs follow
the existing Web protocol's positive safe integer sequence (including JSON float
representation), not a string guessed by a test harness. The world must already
be initialized, loaded and bound. Every identity must match the existing scope
and project world setting. A performance request never establishes or changes
scope. Rejected requests do not call the collector.

Success returns `craftmine.godot-engine-performance-envelope/1`, profile, exact
world/build/instance, echoed nonce and the fixed collector's synchronous sample.
The nonce correlates a host challenge; it does not alone attest code origin or
defend against arbitrary code already executing in the same engine process.
Source/PCK/instance authority and product provider wiring remain separate work.

## Explicit materialization

`materializeBase({..., enginePerformanceProfile: 'engine-monitor/1'})` explicitly
opts into the extension. It preserves the old bridge as
`craftmine_shared/runtime_bridge_base.gd`, installs the extension as
`craftmine_shared/runtime_bridge.gd`, and adds `engine_performance.gd`.
The returned managed manifest records the opt-in profile and the exact file hashes.
Unknown profile values are rejected before creating even the output parent.

When the option is absent, all five defaults preserve historical generated source
bytes and manifests. The parity test separately normalizes only side-view's
existing `MATERIALIZED.json.output` absolute directory, whose expected difference
comes from generating into two different test directories. No cohort classifier,
production source pin, distribution manifest or runtime provider is changed here.

## Verification

`engine-performance-materializer.test.mjs`: 3 tests passed, covering default
five-base parity, exact three-file opt-in changes, and pre-write option rejection.

Native run `engine-bridge-native-EEKtiG` passed using actual Godot 4.7.2, opt-in
creation world, original base adapter, normal load/resume/snapshot operations and
the fixed engine collector. It verifies unloaded reads cannot bind, explicit
capability discovery, identity and challenge refusal, actual JSON numeric IDs,
snapshot preservation, sequence behavior and active/paused timing semantics.
Raw result, source manifest, fixture/engine hashes and stdout/stderr/import logs
are archived in `docs/evidence/gu6-engine-bridge-native-20260912/`.

An earlier native attempt hit D: ENOSPC while copying its independent engine; a
second missed the required class-name import pass. Both original failed reports
remain. The successful runner supports `CRAFTMINE_ENGINE_BRIDGE_OUTPUT_ROOT` so a
fresh C: temporary directory can be used without deleting prior evidence.

This is authored native protocol validation, not a sealed product, ordinary model
or Web rendering test. Existing worlds gain no implied support until they opt in
and the host verifies the corresponding runtime/source authority.

## Actual Web transport follow-up

`engine-performance-bridge-web.mjs` exported the opt-in creation world with the
fixed Godot threaded Web release template and ran it through the production
`GodotWorldViewHost` in an isolated offscreen Electron process. Run
`engine-bridge-web-FD58pV` passed capability discovery, paused/active envelopes,
world/build/instance/nonce matching, invalid challenge refusal, snapshot
preservation, and sequence progression. The Web binary reported
`debugBuild: false`; the player controls were never used and Pointer Lock/focus
guards remained zero. GPU time remained unknown.

The original result, opt-in source hashes, actual Web artifact manifest and
stdout/stderr/import/export logs are archived under
`docs/evidence/gu6-engine-bridge-web-20260912/`.
This run used the pre-host-service generic request path from this test's baseline;
it proves the actual bridge/Web protocol, not the later private host service.
When the dedicated host method is integrated, callers must use that method and
generic requests must remain denied. Core-issued source authority and ordinary
model use are outside this authored fixture.

The runner accepts `CRAFTMINE_ENGINE_BRIDGE_OUTPUT_ROOT` for a fresh absolute
temporary location and `CRAFTMINE_ENGINE_BRIDGE_DEPS` for an existing desktop
dependency directory. It never modifies the verified engine/template cache.
