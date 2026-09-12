# Godot save recovery after a lost durable reply

The ordinary Save, checkpoint-before-apply/switch, and quit paths all use the
private runtime adapter. A failed save must leave the live world available and
must not poison every future save with an obsolete durable revision.

Required scenario:

1. Save nontrivial complete progress at revision N. Rust really commits N+1,
   but the response and the first reconciliation read are unavailable.
2. Report that save as unconfirmed and retain its exact world/build/instance
   and full submitted snapshot in memory. Do not claim success or replay it.
3. The player makes further progress and saves again. A conflict may be resolved
   only after the current Rust record exactly matches the earlier uncertain
   snapshot. Save the new complete snapshot under the now-proven revision.
4. A subsequent checkpoint and normal quit succeed from the verified saved state.
5. A different current snapshot, a replaced instance, or a caller without a prior
   uncertain save remains a conflict; no unrelated progress is overwritten.
6. Read and acknowledge already durable state even if a rebuildable artifact has
   become unavailable. Opening that artifact must still reject its corruption.

`tests/godot-runtime-adapter-core.mjs` executes actual packaged Rust persistence
with authored artifact/application fixtures and injected lost replies/read
outages. It verifies the revision recovery, all complete snapshots, stale-owner
refusals, no replay of the older snapshot, process restart and artifact boundary.
It does not launch Godot, a model, or native Electron.

`tests/godot-host-lifecycle.mjs` combines the real host class and adapter with
deterministic runner/store fault injection, covering failed acknowledgement,
continued progress, a successful new checkpoint and quit. The host fixture uses
the real background-view registry and cursor channel, and models the current
background-throttling API; it does not impersonate physical input or painting.

This is an independently reproduced reliability gap. It is not asserted to be
the cause of an unexamined player's latest error. Final native packaged save,
world entry and creation flow acceptance remains a separate coordinated run.
