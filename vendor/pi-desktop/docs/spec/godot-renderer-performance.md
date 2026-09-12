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

Desktop `node node_modules/typescript/bin/tsc --noEmit` passed. Direct invocation
used existing dependency junctions; `pnpm exec` requested a dependency refresh
and was refused before installation, so no dependency refresh was performed.
