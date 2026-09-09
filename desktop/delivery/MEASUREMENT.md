# Craftmine World measurement suite

`desktop/delivery/measure.mjs` produces read-only performance evidence for the
Godot delivery baseline. It writes one JSON record
(`format: craftmine.measurement/1`) and prints a readable table. It exits
non-zero when any measured metric fails its frozen threshold.

```powershell
node desktop/delivery/measure.mjs all `
  --root "D:\Craftmine World-worktrees\godot-remaining-k-20260910" `
  --package "D:\Craftmine World\desktop\build\windows-preview-batch-07" `
  --out "$env:PI_SCRATCH_DIR\k-measurement.json"
```

Suites: `startup`, `waits`, `frame`, `memory`, `size`, `git`, `assets`, `all`.
Options: `--root`, `--package`, `--cache`, `--runs`, `--out`, `--json`,
`--thresholds`.

## Hard isolation rules

* Every suite runs headless or offscreen with a separate scratch data directory
  (`$PI_SCRATCH_DIR/k-measure`). Nothing is written into the repository, the
  engine cache, the packaged client, or the user profile.
* No OS input synthesis and no browser input driver are used anywhere. The
  packaged client is only ever started in its own offscreen, unfocusable
  headless acceptance mode (`CRAFTMINE_HEADLESS_TEST=1`), which blocks
  `show`/`focus`/`sendInputEvent` and requires an offscreen window. It is never
  brought to the front and never takes the pointer.
* `tests/browser.mjs` and `tests/modules-browser.mjs` are not run.
* Mock, synthetic, fixture and synthetic-index numbers are **not product
  acceptance**. Only the `real-*` sources count as product evidence; synthetic
  rows stay `unmeasured` on purpose.

## Percentile and verdict math

Implemented in `desktop/delivery/lib/measure-core.mjs`, no dependencies.

* **Nearest-rank percentile**: sort ascending, `rank = ceil(p/100 * n)`,
  clamped to `[1, n]`, result `sorted[rank - 1]`. No interpolation.
* **Rounding**: half away from zero on the scaled integer, 3 decimals, applied
  only when serializing samples and summaries. Raw samples are unrounded.
* **Verdict**:
  * `unmeasured` when there are no samples, or the threshold is `null`, or
    `status` is `pending-real-sample`;
  * `fail` when `p95 > max` (or `min sample < min`);
  * `pass` otherwise.

## Cold / warm rule

Per measurement process: sample index 0 is **cold**, every later sample is
**warm**. Cold means the first execution of that command in this process, so the
package/project file cache for this process has not been warmed yet. The OS file
cache is never purged (that needs elevation and would perturb the machine).
Startup always takes exactly two launches: launch 1 = cold, launch 2 = warm.

## Metrics

`source` is the classification stored in the JSON record. `process` is the
producer recorded per metric.

### startup — real-client

Signal: spawn `Craftmine World.exe` with `CRAFTMINE_HEADLESS_TEST=1` and wait for
the IPC message `{type:'craftmine-headless-ready'}`. The window is offscreen and
unfocusable. No readiness signal is available without this channel; if a package
lacks it, `measure.mjs` reports `skipped` with the human command instead of
opening a visible window.

| metric | unit | source | process | observed (2026-09-09) |
| --- | --- | --- | --- | --- |
| `startup.cold.ms` | ms | real-client | `Craftmine World.exe` (offscreen) | 138.9 |
| `startup.warm.ms` | ms | real-client | `Craftmine World.exe` (offscreen) | 186.1 |
| `startup.offscreenRendered.ms` | ms | real-client | `Craftmine World.exe` (offscreen) | p95 1562 |

Reproduce: `node desktop/delivery/measure.mjs startup --package <dir> --out <file>`.
`startup.offscreenRendered.ms` is parsed from the client's own
`[timing] kind=boot phase=window-rendered-offscreen elapsedMs` log line.

### waits — real-engine / real-process

| metric | unit | source | process | observed (2026-09-09) |
| --- | --- | --- | --- | --- |
| `waits.engine-import.ms` | ms | real-engine | Godot `--headless --import` | p95 2720.9 |
| `waits.project-build.ms` | ms | real-engine | `new-world.mjs` + Godot import | p95 2735.7 |
| `waits.probe-check.ms` | ms | real-engine | `bases/top-down/tools/verify.mjs` | p95 21730.1 |
| `waits.candidate-apply.ms` | ms | skipped | none available | skipped |
| `waits.install.ms` | ms | skipped | none available | skipped |

* `engine-import`: a fresh scratch copy of `desktop/godot/bases/top-down/worlds/blank`
  is imported per sample, then deleted.
* `project-build`: `node tools/new-world.mjs --template blank ... --out <scratch>`
  followed by an engine import; both wall times are summed.
* `probe-check`: the full top-down base acceptance script with `--work`/`--out`
  under scratch and `APPDATA`/`USERPROFILE` redirected into scratch.
* `candidate-apply` and `install` are **not measured**: no real broker/apply
  timing is exposed in this tree, and running the NSIS installer would change
  the machine. Exact human commands are in the `skipped` records.

Reproduce: `node desktop/delivery/measure.mjs waits --cache <godot cache> --out <file>`.

### frame — real-engine

`frame.time.ms`: per-frame `Time.get_ticks_usec` delta in milliseconds, sampled
from the real top-down blank world main scene. The suite copies the project to
scratch, adds one measurement-only autoload (`measure_frame_probe.gd`) that
prints `FRAME <index> <delta_us>` in `_process` and quits after 300 frames, runs
`godot --headless --path <scratch> --quit-after 500` three times, and pools the
frame deltas. Frame 0 is the initialization frame and is included.

Observed 2026-09-09: 900 frames, p50 6.9 ms, p95 6.975 ms, min 0.017 ms,
max 7.015 ms. This is a headless main-loop number; there is no rendered-frame or
GPU number in this report (see `limits` in the record).

Reproduce: `node desktop/delivery/measure.mjs frame --cache <godot cache> --out <file>`.

### memory — real-process

The packaged client is launched offscreen, then PowerShell samples the root
process with `Get-Process` (`WorkingSet64`, `PrivateMemorySize64`) and the whole
`Craftmine World.exe` process tree with `Get-CimInstance Win32_Process` every
400 ms for 12 s after readiness.

* peak = max over all samples;
* steady = nearest-rank p50 of the last half of the window.

| metric | unit | observed (2026-09-09) |
| --- | --- | --- |
| `memory.workingSet.peak.mb` | MB | 525.1 |
| `memory.workingSet.steady.mb` | MB | 466.4 |
| `memory.privateBytes.peak.mb` | MB | 479.0 |
| `memory.privateBytes.steady.mb` | MB | 420.0 |
| `memory.treeWorkingSet.peak.mb` | MB | 1390.5 |
| `memory.treePrivateBytes.peak.mb` | MB | 1081.5 |

A separate run on the same day measured steady working set 268.9 MB, so this
metric has real run-to-run variance; the frozen limit is intentionally tight and
a later over-limit sample is a `fail`, not a reason to widen it.

Reproduce: `node desktop/delivery/measure.mjs memory --package <dir> --out <file>`.

### size — real-filesystem

`node measure.mjs fs walk` over the package directory. Bytes, MiB = bytes /
1048576. Buckets: root executables/DLLs, `resources/bin`,
`resources/agent-runtime`, `resources/plugins`, `resources/licenses`,
`resources/source`, other `resources/*`, `locales`, everything else, and the
`*Setup*.exe` NSIS installer.

Observed 2026-09-09 on `windows-preview-batch-07`: total 546.6 MB, 828 files,
exe/dll 300.7 MB, installer 147.9 MB, resources/bin 11.7 MB, agent-runtime
4.95 MB, plugins 1.51 MB, licenses 1.79 MB, source 37.36 MB, resources/other
35.78 MB, locales 4.94 MB.

Reproduce: `node desktop/delivery/measure.mjs size --package <dir> --out <file>`.

### git — real-git

`git.exe` commands over `--runs` samples (default 30), index 0 cold and the rest
warm.

| metric | command | observed (2026-09-09) |
| --- | --- | --- |
| `git.log.ms` | `git log --oneline -n 500` | p95 56.0 ms (cold 42.3) |
| `git.diffStat.ms` | `git diff --stat HEAD~50..HEAD` | p95 156.4 ms (cold 226.0) |
| `git.largeFileDiff.ms` | `git diff HEAD~50..HEAD -- <largest changed file>` | p95 40.2 ms (cold 34.6) |

Reproduce: `node desktop/delivery/measure.mjs git --runs 30 --out <file>`.

### assets — synthetic-index, and product `skipped`

The AL2 asset catalog search/preview entry points are **not integrated** in this
tree: `vendor/pi-desktop/crates/craftmine-core/src/asset_catalog/` does not
exist. `assets.search.ms` and `assets.preview.ms` are therefore reported as
`skipped` with a `pending-integration` record naming the expected module and the
expected `library.search` / `library.read` / preview functions from
`docs/ASSET_LIBRARY_DEVELOPMENT_PLAN.md` sections 5-7 (dispatch task N owns
`src/asset_catalog/**`).

To exercise the percentile math and the 1k/10k tiers, the suite also builds a
deterministic synthetic in-memory index of 1,000 and 10,000 entries in a scratch
directory (`index.json`), then measures 40 linear scan searches and 8 metadata
projections per query. These rows are labelled `synthetic-index`, and their
thresholds are `null` with `status: pending-real-sample`, so the CLI reports
`unmeasured` — they can never produce a product `pass`.

Observed 2026-09-09 (synthetic): search 1k p95 0.092 ms, preview 1k p95
0.012 ms, search 10k p95 0.329 ms, preview 10k p95 0.008 ms.

Reproduce: `node desktop/delivery/measure.mjs assets --out <file>`.

## Frozen thresholds

`desktop/delivery/MEASUREMENT_THRESHOLDS.json` was frozen at
`2026-09-09T17:05:00.000Z`, before acceptance, from the real measurements above.
Each entry carries `max`, `min`, `status` and a `rationale`. Latency limits
carry roughly 2-5x headroom over the observed p95; size and memory limits carry
roughly 1.2-1.7x. The limits are:

| metric | max |
| --- | --- |
| `startup.cold.ms` | 1000 |
| `startup.warm.ms` | 800 |
| `startup.offscreenRendered.ms` | 5000 |
| `waits.engine-import.ms` | 8000 |
| `waits.project-build.ms` | 8000 |
| `waits.probe-check.ms` | 60000 |
| `frame.time.ms` | 16.67 |
| `memory.workingSet.peak.mb` | 1024 |
| `memory.workingSet.steady.mb` | 512 |
| `memory.privateBytes.peak.mb` | 1024 |
| `memory.privateBytes.steady.mb` | 512 |
| `memory.treeWorkingSet.peak.mb` | 2560 |
| `memory.treePrivateBytes.peak.mb` | 2048 |
| `size.install.total.mb` | 700 |
| `size.fileCount` | 1200 |
| `size.resources.bin.mb` | 32 |
| `size.resources.agent-runtime.mb` | 16 |
| `size.resources.plugins.mb` | 8 |
| `size.resources.licenses.mb` | 8 |
| `size.resources.source.mb` | 128 |
| `size.resources.other.mb` | 128 |
| `size.exe-dll.mb` | 400 |
| `size.locales.mb` | 32 |
| `size.other.mb` | 16 |
| `size.installer.nsis.mb` | 250 |
| `git.log.ms`, `.cold.ms`, `.warm.ms` | 500 |
| `git.diffStat.ms` | 1000 |
| `git.diffStat.cold.ms` | 1000 |
| `git.diffStat.warm.ms` | 600 |
| `git.largeFileDiff.ms`, `.cold.ms`, `.warm.ms` | 500 |

**Thresholds with no real sample are `null` with
`status: pending-real-sample`**: `waits.candidate-apply.ms`, `waits.install.ms`,
`assets.search.ms`, `assets.preview.ms`, and the four synthetic asset tiers.
They report `unmeasured`, never `pass`.

The full suite was re-run after freezing and passed with exit code 0
(`failed=0`). No threshold was widened after freezing; a later real sample above
a frozen `max` is a `fail`.

## Explicit non-acceptance statement

Mock results, synthetic indexes, fixtures, `pending-real-sample` thresholds and
`skipped` records are **not product acceptance**. They document what could not be
measured and the exact command a human must run. Only `real-engine`,
`real-client`, `real-process`, `real-filesystem` and `real-git` rows that carry
a frozen threshold can produce a product `pass`.

## Tests

`node --test tests/godot-remaining/K/measure.test.mjs` covers nearest-rank
percentile math, verdict logic, cold/warm labelling, source classification, the
JSON record schema, and a guard that greps `measure.mjs` and
`lib/measure-core.mjs` for input-simulation / window-activation tokens and
asserts their absence.
