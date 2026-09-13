# Player workflow fluency and F2 input handoff

The existing PI desktop interface remains unchanged. A real input handoff defect
was fixed in the trusted world preload: if the player held W, opened F2, released
W in the conversation and returned to play, the game retained W and continued
moving. The preload now releases keys and pointer/mouse buttons that previously
reached that game when chat blocks input, on blur, and on disposal. New blocked
presses are not replayed. Normal movement deceleration remains authored behavior.

## Measured baseline

Read-only package: `7fde6778b768-b5420f1c-174e-4573-a287-f1ba479e364d`.
Its inventory SHA-256 was
`dc47161aef022d37c3288c277b1811b8824fbe704af79707751695e31a16af0a`
before and after the run. All data was created in a fresh isolated offscreen
profile; no installed player profile or archived world was changed.

| Action | Observed elapsed time |
| --- | ---: |
| Process spawn to example chooser ready, fresh profile | 2.58 s |
| Create mainline personal copy to native snapshot | 29.30 s |
| Create flight personal copy to native snapshot | 29.00 s |
| Create rain personal copy to native snapshot | 24.87 s |
| Create city personal copy to native snapshot | 26.13 s |
| Switch to existing mainline | 13.93 s |
| Switch to existing flight | 13.11 s |
| Switch to existing rain | 12.02 s |
| Switch to existing city | 8.97 s |
| Relaunch same profile to active city native snapshot | 12.83 s |
| Native durable save request/receipt | 2.6–14.5 ms |
| F2 compact conversation handler to visible DOM | 4.0–7.8 ms |

These are individual observations, not percentile service targets. A fresh
profile is not a flushed OS disk cache. Creating and switching include native
world preparation/loading; save measures the core receipt rather than how long
the UI keeps a success message visible. PI renderer animation-frame sampling is
included in the raw evidence and is separate from Godot engine FPS. No native
engine FPS or visible-screen presentation latency claim is made. All runs used
zero model calls, so they do not measure generation or AI cancellation time.

## Reproduction and correction

The sealed baseline's `heldInput` record confirms that a synthetic page W press
reached actual Godot movement (1.93 world units). After F2 and release in the
conversation, the next 600 ms still moved 4.72 units. The baseline report's
`passed` field means the original collection completed; `heldInput.released`
is explicitly false and the input regression did not pass.

An initial fixed-build diagnostic measured too soon after resuming and detected
normal residual velocity. That run was cancelled normally and retained rather
than treated as a successful player test. The final regression allows one second
of authored movement deceleration, then samples another 600 ms. Actual movement
from the initial W press was 1.81 units and sustained drift after returning from
chat was exactly zero. No position, velocity, engine input state or world source
was assigned by the test. All three overlay transitions retain runtime identity;
the resulting mainline world also switches and reopens through the ordinary flow.

Validation: 15 focused immersion/shortcut tests, desktop TypeScript check,
complete JS build, native fixed mainline handoff/switch/reopen, syntax and diff
checks passed. Both native launches exited normally with no input/focus/Pointer
Lock violations or shutdown failures. The complete four-world timing collection
used the sealed baseline; the fixed native regression used the built isolated
checkout with the unchanged sealed native binaries/resources. Final integrated
package verification remains the parent task's responsibility.

## Repeatable driver

`tests/player-fluency-client-native.mjs` accepts a built checkout and its runtime
resources as absolute paths. Add `--packaged-root ABS_PACKAGE` for a sealed
client. Default scope covers four worlds; `--mainline-only` is the targeted F2
regression. The driver creates its own profile, prints its cancel-file path,
uses normal world chooser forms and protected native APIs, and asserts the
held-key regression after the workflow completes. It never uses OS input,
Playwright input methods, focus emulation, or Pointer Lock. Geometry/full-overlay
checks now wait for the corresponding committed React shell class as well as
layout state; the historical baseline's non-compact shortcut timings are not
presented as completed visual transitions.

Evidence:

- `docs/evidence/player-fluency-20260913/sealed-baseline.json`
- `docs/evidence/player-fluency-20260913/fixed-native.json`
- `docs/evidence/player-fluency-20260913/pre-deceleration-diagnostic.json`

## Integrated continuation

The four-world run `desktop-native-fluency-rYC71B` passed creation, real native
snapshot, save, switch, F2 held-input release and cold reopen. Unlike the earlier
renderer-only result, it also samples the actual Godot engine through the
source/PCK-verified host monitor. The Windows artifact reader now handles Core's
extended-length path namespace without weakening its link or hash checks.

| World | First personal copy | Existing-world switch | Engine FPS sample | Engine frame work |
| --- | ---: | ---: | ---: | ---: |
| Pomeranian / mainline | 31.05 s | 15.11 s | 60 | 5.91 ms |
| Flight | 26.63 s | 13.92 s | 60 | 3.14 ms |
| Rain | 23.21 s | 15.78 s | 60 | 2.97 ms |
| City | 26.29 s | 10.82 s | 60 | 3.70 ms |

Fresh chooser readiness was 3.37 s; warm-profile active-city reopen was 13.13 s.
Each normal save acknowledgement took 3.4–11.7 ms. These are small already-live
snapshots, not large new content generation or archival export. All four engine
samples are verified, active gameplay readings; FPS is a cached engine monitor,
not a long-session minimum or a physical-display measurement. Other development
work was running on this machine, so these single observations are not a
controlled before/after speed comparison. GPU duration remains unknown.

Real Codex cancellation and cold-reopen evidence is recorded separately in
`docs/PLAYER_CANCELLATION_RESULT_2026-09-13.md`; its model turn must not be counted
as part of this no-model timing run. Current world loading still takes visible
time. This delivery fixes the held-input handoff and reports actual loading
stages; it does not claim instant world switching.

Compact evidence: `docs/evidence/player-fluency-20260913/integrated-native.json`.
The staged desktop JS hash is included. Native binaries/resources were reused
read-only from the prior sealed candidate; final package inventory and launch
verification are recorded by the delivery report.
