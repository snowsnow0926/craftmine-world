# Retry a cancelled stock world with the engine bridge

Normal creation-sandbox materialization enables `engine-monitor/1`. It installs
`shared/runtime_bridge_engine_v1.gd` as `craftmine_shared/runtime_bridge.gd`,
and retains the original shared bridge as `runtime_bridge_base.gd`. The retry
repair whitelist previously recognized only the original bridge lineage, so a
cancelled, unchanged current blank world was incorrectly rejected as customized
before its next build could start.

Explicit retry now recognizes one exact current pair as an unchanged source:

- Wrapper: `938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08`.
- Inherited base: `58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3`.

The host selects the existing bundled engine-wrapper resource, validates its
exact wrapper hash, and returns no repair. The initializer supplies the actual
inherited-base hash from the indexed source; a missing, mixed or custom base is
not accepted as that current pair. Unknown wrappers still reject. Modified
managed files still fail their existing metadata hash/size check. Historical
old-bridge repair remains pinned to its dependency-compatible historical
resource; no older-world migration is added.

This branch does not patch source, modify managed files, rewrite progress or
reuse unverified application evidence. Existing explicit cancellation clearing,
task recovery, source identity, build/check, selected-world and first-load
guards remain in effect. A known no-op bridge permits normal initialization to
continue; it does not itself prove runtime or gameplay success.

## Explicit continuation of a selected unfinished world

An entry-list `initializing` row describes durable preparation state, not a
running executor. In headless entry, list reads deliberately use
`status({resume:false})`. A retained world may therefore be selected and still
need the player's ordinary Continue Preparing World action after restart.

That existing action is now also shown for the selected initializing row. The
controller permits same-world navigation only when `resumeInitialization` is
explicitly true and the target state is `initializing`. Ordinary selection of
an unfinished world remains non-playable; ready same-world selection keeps its
original behavior. Failed worlds still require their advertised recovery
actions. Busy, saving, unsupported-switch and task-binding rules are retained.

Explicit preparation now uses the existing `world.creationRetry` scheduler so
the initializer receives `recover:true`. For an already selected target it does
not first trigger a status-only navigation, which would lack recovery intent.
Other targets still use the existing guarded switch before recovery. Immediately
before recovery, a fresh list must confirm selection, the same initialization
operation ID and an initializing state. A world already ready needs no recovery;
another terminal state remains an explicit failure rather than a hidden retry.

When work is already running, the scheduler joins that existing promise and
returns; it does not append another recovery attempt after success or failure.
The main initializer adapter obtains an existing running promise before any
asynchronous status query. Otherwise normal explicit recovery retains the
original task/generation checks and bridge/source pins. Passive status remains
unable to cross an interrupted workspace. No new RPC, source repair, background
retry or synthetic initialization status is introduced.
