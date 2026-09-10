# Godot candidate native preview and application

The formal host contract remains `godot-formal-runtime-host.md`. This extension
adds a separate pending instance under the same Electron lifecycle owner.
Candidate paths still come only from Rust `godotRuntime.describeCandidate`,
bound to a host-owned application id/token and its exact input hash. A page can
choose a world/candidate id; it cannot supply a path, state, receipt or token.

## Preview

The selected world must already be a running formal Godot world. The coordinator
holds selection polling, pauses the retained formal instance and prepares a
candidate using Rust's current durable full snapshot. The preview does not save
the formal instance. The pending view has a separate scope, loopback origin and
session, pinned artifacts and the same denied permissions. Before loading it has
nonzero detached bounds so WebGL never initializes a zero-sized attachment.

After load, the host checks an exact runner snapshot receipt against the prepared
state. Preview gameplay can then run in that independent copy. Save on a pending
runtime is only a runner confirmation; it never calls the formal progress RPC.
Formal save, world departure and quit are rejected while a candidate remains
staged, including when the old world has a cached checkpoint. Cancelling aborts
the prepared application, destroys only the pending instance, and resumes the
same original instance with its unsaved in-memory play progress intact.

Prepared applications hold the existing core world lock and expire under the
existing timeout/restart protocol. Preview is consequently bounded by that
lease; an expired/stale preview must be opened again. It is not a persistent
fork or a migration from a legacy world.

## Apply

A player must explicitly apply the current preview. Application first aborts and
discards the played preview. It then checkpoints the latest retained formal
instance through real Rust persistence, re-reads the full formal descriptor,
prepares a new application and loads a fresh pending instance. Preview changes
are never reused as play progress or promoted directly.

The fresh instance remains paused. Its `save` confirmation must include the
exact world/build/instance and UTF-8 snapshot text/length/SHA256, and both its
parsed text and complete state must equal the latest prepared snapshot. The
host creates `craftmine.godot-application/2` evidence from that observed receipt.
It calls the private core commit once. Only after matching the applied receipt
and re-reading the formal artifact descriptor does it promote the pending view,
update the durable revision and dispose the previous native instance.

A failed descriptor, load, snapshot, stale candidate or pre-commit storage step
aborts the prepared record, discards pending state and retains/resumes the old
instance. If the commit response is lost, read the original application and
check id, world, candidate, build, input hash/full input, and exact output evidence
including the observed instance. Never repeat the commit to discover its outcome.
An unknown result hides and pauses the pending view while retaining the old
instance and transaction ownership. The user can explicitly confirm the result
again; a foreign receipt cannot authorize promotion or resume an incompatible
world. A post-commit native failure is not silently represented as a rollback of
the committed Rust build.

## Product routes

Private host routes are `godotApplication.prepare/commit/read/abort`, `world.read`
and the existing runtime descriptor/save routes. Both the plugin runtime and
private plugin router must admit the precise methods; neither list expands model
or page authority. The authenticated panel exposes only:

- `godot.candidatePreview` and `godot.candidateApply`: `{worldId,candidateId}`.
- `godot.candidateClose`: `{worldId}`.
- `godot.candidateState`: `{worldId,candidateId}`; bounded completed records recover a lost panel reply without confusing another candidate.

The Godot checks tab uses existing `godot.candidateList` records, with a preview
button for ready candidates. Its preview header has Apply and Return controls;
the native game is inset below the extra 46-pixel header. Godot candidates do
not impersonate a legacy voxel advisory review. An uncertain apply exposes a
Confirm Result action. Reopening/reloading the panel first closes or reconciles
any owned candidate session, so a plugin restart cannot strand an invisible
prepared operation. Quit, disable and panel close first reconcile/discard the
candidate before the formal close checkpoint.

## Validation boundaries

`tests/godot-candidate-coordinator.mjs` injects pure store/runtime faults.
`tests/godot-candidate-host.mjs` runs the real host class with deterministic native
seams and verifies retention, blocked saves, failed promotion and cancellation.
`tests/godot-candidate-typecheck.mjs` checks the new coordinator and host types.
`tests/godot-candidate-native.mjs` uses a fresh test directory, real Rust and
hidden/offscreen Electron with the fixed repository-owned E Web export. Its
executor/check registration is expressly a fixture, while the coordinator's
preview, state confirmation, commit, lost-reply recovery and restart are real.
No test sends real input, activates a window or requests Pointer Lock.

Production readiness also depends on the isolated build/check executor and its
trusted check descriptor. This slice does not manufacture that attestation,
implement first-world bootstrap, establish model authorship or settle asset
redistribution rights. Full product-entry verification remains separate from
the native harness. See the Cycle 6 host evidence report for actual results and
preserved failures; a nonzero check count does not mean a completed run.
