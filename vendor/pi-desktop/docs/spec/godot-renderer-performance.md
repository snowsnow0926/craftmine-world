# GU6: trusted renderer process performance channel

The formal Godot Web view now exposes its host-owned OS process identity to a
read-only sampler. `pi.craftmine.godotPerformance` calls
`craftmine.godotPerformance`, restricted to `craftmine.world`, then the sampler
reads Electron `app.getAppMetrics()` for the current view's exact renderer PID.
No page JavaScript, input, focus, pause/resume, source edit, or engine request is
needed. The existing pinned source cohorts remain unchanged.

Before and after metric collection, the sampler compares world, build, instance,
WebContents ID and OS PID. World transition/checkpoint activity is refused by the
host; stopped or destroyed views return no sample. Caller identities only narrow
the current view. Unknown keys, malformed identities, mismatches, and replacement
during the asynchronous boundary fail closed.

## Measured value and scope

- `memoryWorkingSetMb`: Electron's `memory.workingSetSize` (KB) divided by 1024.
  The inherited field name is preserved; `memoryUnit: "MiB"` gives its exact unit.
- `measurementScope: "renderer-process"`: includes the entire renderer process,
  potentially including multiple documents/engine overhead. This is **not**
  isolated world asset memory, JS heap usage, GPU memory, or an optimization score.
- `provenance: "electron-app-metrics"`; `sampledAt` is host receipt time;
  `rendererProcessId` and `webContentsId` identify the measured process/view.
- Missing, malformed, ambiguous, or non-renderer process metrics omit the numeric
  field and give a reason under `unavailable`. A measured zero is preserved.
- `frameTimeMs`, `physicsStepMs`, and `objectCount` remain unavailable because the
  current engine protocol does not expose them. Browser scheduling intervals
  cannot be substituted for engine timings.

Trusted engine metrics need a separately versioned runtime observer exposing
actual Godot monitors, with source cohort validation and native/Web parity tests.
That work remains open, as do player-scale benchmarks and a semantics-preserving
optimization regression. This channel does not satisfy those acceptance gates.

## Validation, 2026-09-12

`node --test vendor/pi-desktop/apps/desktop/test/craftmine-performance-sample.test.mjs`
passed 5 tests, covering process selection, narrowing, replacement during await,
missing/invalid readings, and host/OS failure propagation.

`node vendor/pi-desktop/apps/desktop/test/craftmine-performance-electron.mjs`
ran the production sampler against an actual independent Electron offscreen
WebContentsView. It measured **63.25 MiB** from OS metrics with zero windows,
input events, and focus events. Pointer Lock was disabled at initialization.
The fixture is a minimal HTML renderer, **not** a Godot world or player workload.
Its report is archived at
`vendor/pi-desktop/docs/evidence/gu6-renderer-performance-20260912/report.json`.
The actual Godot view owner/IPC/broker chain still needs integration validation.

### Actual Godot Web host follow-up

`test/craftmine-performance-godot.mjs` now reuses an existing verified Godot Web
descriptor and verifies every artifact's byte count and SHA-256 before and after
execution. The run used the earlier collision-v2 formal export, with pinned
`index.pck` and `index.wasm`, through the actual `GodotWorldViewHost` class.
Two independent Electron processes/profiles loaded the scene. Production
`performanceProcess` and `createCraftminePerformanceSampler` returned:

| Phase | Renderer working set (MiB) | Instance |
| --- | ---: | --- |
| First load | 394.59765625 | `3865b9235f199c1d4d59ce7c` |
| Cold reopen | 400.37109375 | `801c94fcd3bf92b46b07ff5b` |

Each metric's identity matched the real engine observation. The first process
saved through the host's normal save/acknowledgement sequence into a local fixture
file; the second process restored that file and obtained an equal snapshot.
The saved receipt is fixture-owned, **not** a Core transaction receipt. The second
instance rejected requests using the first instance ID. Both runs also disposed
the real host while a metrics request awaited completion and verified that its
result was rejected. Once disposed, sampling returned null.

Owner windows remained hidden and unfocusable; runtime views were offscreen.
Input, Pointer Lock and focus counters were all zero. Both processes exited 0.
Report, artifact descriptor and saved fixture progress are archived under
`vendor/pi-desktop/docs/evidence/gu6-godot-renderer-performance-20260912/`.
This proves actual Godot host sampling and cold instance isolation; it does not
exercise the plugin IPC, broker, actual Core persistence, or ordinary model path.
The two numbers are observations, not an optimization comparison or performance
target; hardware and sampling instant can change them.

Run from the repository root with `CRAFTMINE_PERFORMANCE_DESCRIPTOR` pointing to
a descriptor JSON (or a prior `cases.json` containing a `formal` variant):

```
node vendor/pi-desktop/apps/desktop/test/craftmine-performance-godot.mjs
```

Optionally set `CRAFTMINE_PERFORMANCE_DEPS` to an existing desktop dependency
directory. The test reads export assets only and writes a new test-results folder
with two independent Electron profiles; it never changes source/export files.

### Packaged broker follow-up

The same test now builds a real plugin with `desktop/build-world-plugin.mjs` and
loads its `createWorldTools` broker. It injects the production performance sampler
and `createCraftmineLiveSampler`, which reads a fresh engine `observe-envelope`
from the actual running Godot host. Core start, `task.context`, and
`godotRuntime.describe` are explicitly controlled fixture responses. No RPC other
than those expected read operations is allowed. This tests the packaged broker
with real runtime/OS data; plugin IPC and actual Core persistence remain outside
the fixture.

Both load and cold reopen returned `available: true` and preserved the exact
numeric memory value collected during that broker call. Frame/physics/object/GPU
metrics stayed unknown. On cold reopen, replaying the previous process's actual
sample was rejected by the broker as `PERFORMANCE_SAMPLE_INVALID`. The new report
includes exact hashes of the packaged broker, manifest, projection/query helpers,
observation and service modules, plus the immutable Godot export descriptor path.
It is archived under
`vendor/pi-desktop/docs/evidence/gu6-packed-godot-performance-20260912/report.json`.

The verified final run is `test-results/performance-godot-JrLSwz`. An earlier
successful run `performance-godot-25xRV9` lacked the package file hash list. Two
earlier harness attempts (`L6jaFO`, `jO93bp`) failed respectively on bundled
`import.meta.url` and missing fixture `core.start`; neither was a product failure,
and their original failure records remain in test-results.

When testing against a different integration checkout, explicitly set
`CRAFTMINE_PERFORMANCE_PLUGIN_ROOT` to that checkout. The plugin's commit is
recorded as context; the hashes describe the actual loaded bytes. Do not interpret
this fixture as sealed desktop release or ordinary player acceptance.

Desktop `node node_modules/typescript/bin/tsc --noEmit` passed. Direct invocation
used existing dependency junctions; `pnpm exec` requested a dependency refresh
and was refused before installation, so no dependency refresh was performed.
