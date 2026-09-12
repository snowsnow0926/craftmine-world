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
