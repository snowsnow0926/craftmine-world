# Fixed Godot engine monitor collector

`desktop/godot/shared/engine_performance.gd` adds one synchronous, fixed-whitelist
`sample()` operation. It reads built-in Performance monitors and engine metadata.
It does not enumerate project nodes, call custom monitors, alter scene state,
pause/resume, schedule a measurement loop, or modify existing runtime bridges.
Its only changing state is its own monotonically increasing request sequence.

The native test uses the exact pinned Godot 4.7.2 editor binary running a trusted
authored scene headlessly. The SHA-256 matches the shipped ClassDB evidence and
toolchain lock. The seven monitor names/numbers are checked against that ClassDB
and again by the collector at runtime. Engine version identity comes from the
built-in version fields; the human display string differs from CLI `--version`.

The official [Performance API documentation](https://docs.godotengine.org/en/stable/classes/class_performance.html)
defines process/physics times in seconds and warns that monitors can update with
a delay. These are engine-published durations, not OS CPU usage, per-script cost,
rendered-frame intervals or distributions. The collector retains raw values and
units; it does not convert them into a claimed frame-rate benchmark.

## Native evidence

Run `test-results/engine-performance-native-ExIIHp` passed seven assertion groups:

- Empty tree: 2 nodes and 1487 engine objects.
- After adding 256 inert nodes: 258 nodes and 1743 engine objects.
- After removal: 2 nodes and 1487 engine objects.
- Positive process/physics/FPS readings after allowing monitor publication.
- Paused process/physics/FPS readings remain unknown for active gameplay.
- Headless draw calls/primitives and unsupported GPU time remain unknown.
- The registered test custom monitor callback was never invoked.

The raw stdout/stderr, engine/collector/fixture hashes, all five samples, exact
arguments and exit result are archived under
`docs/evidence/gu6-engine-monitors-native-20260912/`.
The first attempt `engine-performance-native-eyq3sZ` failed because it assumed the
display version string had CLI formatting. Its original result remains recorded.

The native process reports `debugBuild: true`, `editorHint: false`,
`headless: true`, `renderingMethod: gl_compatibility`, and zero drawn frames.
Configured rendering method alone therefore does not establish active rendering.
Release/Web availability is not proven by this native editor test. Unsupported
versions/enums, unpublished zero timings, and unavailable rendering stay unknown
instead of becoming fabricated zero measurements.

## Trust and integration boundary

The final native and release evidence both pass the strict parser (five samples
each); combined parser and packaged-broker tests passed 12/12. The integrator
also ran the real release fixture as `engine-performance-native-l0obV1`, with
its report/stdout/stderr archived using `integrator-` prefixes in the release
evidence directory. The pinned source release executable is unchanged.

Independent review found no blocking implementation issue. It verified exact
monitor identifiers and method signatures from local ClassDB, but ClassDB does
not encode units or refresh-period semantics. These tests demonstrate value
availability, controlled count changes and declared-unit conversion; they do
not independently calibrate timing units or prove an exact one-second refresh.
Positive headless FPS is an engine counter, never proof of rendered FPS.

The integrator added `godot-engine-performance.mjs` to validate the exact fixed
engine version, monitor names, raw units, finite values, integer counters,
sampling sequence and environment constraints. It preserves seconds as raw units
and exposes separate millisecond values; it refuses measured timings while paused,
draw statistics before any rendered frame or in headless/dummy mode, fabricated
GPU measurements, and values attached to unknown fields. Its output explicitly
says structural validation does not attest source/transport authority.

Eleven parser/packaged-broker tests passed, including validation of all five real
native collector samples and their retained stdout/stderr hashes. The integrator
also reran the native experiment in `engine-performance-native-1Kdk6e`; its exact
report and logs are archived alongside the first native result with `integrator-`
prefixes. An earlier local run `vTkioF` used equivalent CRLF fixture bytes and is
kept separately in test-results; the final run uses the exact committed fixture.

The collector is declared as an app-bundle resource with its byte hash; it is not
copied into ordinary generated worlds yet. The parser is included in plugin
packaging but not called by the production performance tool. All five staged
base materializers still pass. The existing runtime bridge and source cohorts
have not been changed by this increment.

The format is `craftmine.godot-engine-performance/1`, profile `engine-monitor/1`.
Sequence, process/physics frame counts and timestamps provide sampling context;
request sequence increments do not prove monitors themselves refreshed. Paused
object/node counts describe the current tree, while paused timing data is withheld.

This fixed script is not a defense against arbitrary hostile code in the same
engine process. Its hash or a nonce alone does not prove trusted origin. Runtime
transport, host instance binding, source/PCK identity and explicit capability
support must be implemented before exposing these measurements through the
production tool. Existing source cohorts and pins are unchanged. No player-scale
workload or optimization benefit is asserted.

Run with the existing verified Godot cache:

```
node tests/godot-agent/engine-performance-native.mjs
```

Set `CRAFTMINE_GODOT_CACHE_DIR` to an absolute verified cache if needed. The fixture
copies the engine and uses fresh independent profile directories with `--headless`.

## Native release template follow-up

Run `engine-performance-native-wJr8rF` also passed using the actual Windows release
template (`debugBuild: false`) from the sealed 56b5aeca package. The source template
was read-only, verified against `WINDOWS_TEMPLATE` SHA-256
`d34d36f3be1a6c49c56525ae86469b92e4f417ddf0b43cf00dd80c385c4b0562`,
copied into independent scratch, and verified unchanged afterward. No archive was
re-extracted and no installed/sealed executable was modified.

The fixed editor exports a PCK containing the collector and an explicit Node main
scene fixture; the copied release binary starts that adjacent pack with only
`--headless --language en`. The release template forbids `--path` overrides, so
the editor-style test invocation is not used. The fixture's one additional main
node is a known structural difference from the editor SceneTree script fixture;
the node/object comparisons are within each process, not between editor/release.

The same exact 256-node increase/removal, positive unpaused engine monitor values,
paused/headless unknown semantics, sequence/counter checks, and zero custom
monitor callbacks passed. Raw samples, stdout/stderr, import/export logs, release
binary/pack/collector/fixture hashes are archived under
`docs/evidence/gu6-engine-monitors-release-20260912/`. Release availability of this
fixed whitelist is therefore directly tested. Render/GPU availability and Web
release behavior remain unproven by this headless native run.

Earlier attempts are retained: `5WRMxj` received the genuine release path-override
rejection; `IBWK6X` loaded a pack without an executable main scene and was stopped
after the native fixture timeout; `B7ynl3` failed in the JS harness before execution
because fixture setup referenced an uninitialized variable. These are not evidence
that release monitors are unavailable, and are not ordinary player failures.

To reproduce release mode, set `CRAFTMINE_ENGINE_MONITOR_RELEASE_BIN` to an absolute
copy/source of the already verified Windows release template, then run the same
native test command. The runner checks its exact pinned hash before execution.
