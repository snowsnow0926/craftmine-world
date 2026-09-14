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

A pending startup is abortable. `runtime.abortStartup(reason)` rejects the
readiness wait of a not-yet-ready runtime, so a main-frame `did-fail-load` or a
`render-process-gone` fails the staging call immediately instead of waiting out
the whole startup budget. The host keeps a bounded per-instance tail of renderer
console lines and page/renderer faults and appends a compact cause summary to the
startup error; `host.diagnostics("formal" | "candidate")` returns that evidence
with the exact world/build/instance identity and the served-request list, whose
per-instance origin token is redacted and whose faults/console/request lengths
are capped. This is
evidence about the renderer process only: it never claims the view was visible,
composited or played.

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

A failed prepare whose exact application id is authoritatively absent releases
the local candidate owner and resumes the retained runtime. The orchestrator
accepts the exact `GODOT_APPLICATION_NOT_FOUND` code carried by the real plugin
bridge's `PluginApiError.code` as well as Core's `errorCode`. Message text alone,
an unavailable transport, or a missing record after a prepare receipt was already
observed cannot authorize this recovery.

## First world load

A world with no formal build cannot preview: `godot.candidatePreview` still
requires a running formal instance and reports `GODOT_FORMAL_WORLD_REQUIRED`.
Creation therefore uses a separate confirmation path instead of a deadlock on a
world that only a confirmed application could produce.

`GodotWorldViewHost.stageCandidate(request, {first:true})` stages the first
instance of a world that has no live formal runtime and refuses when one is
already running (`GODOT_WORLD_ALREADY_RUNNING`). `promoteCandidate` then replaces
nothing and promotes that instance after the matching committed descriptor and
revision are observed. The coordinator exposes the main-process method
`firstLoad(worldId, candidateId)`: it reads the durable world record, prepares
the application from that record's revision and full snapshot, confirms the exact
runner snapshot, commits once and promotes only after re-reading the formal
descriptor. It refuses a world that already has a formal build
(`GODOT_FORMAL_WORLD_EXISTS`). It is deliberately **not** a panel route: a page
that can call `godot.candidateApply` must not be able to commit a ready candidate
onto a world with no formal build without a preview. The initialization
transaction in the main process calls the method. A failed first startup
publishes a failed state with an empty instance id and leaves the world in its
recoverable creation state; no previous instance is invented.

## Product routes

Private host routes are `godotApplication.prepare/commit/read/abort`, `world.read`
and the existing runtime descriptor/save routes. Both the plugin runtime and
private plugin router must admit the precise methods; neither list expands model
or page authority. The authenticated panel exposes only:

- `godot.candidatePreview` and `godot.candidateApply`: `{worldId,candidateId}`.
- `godot.candidateClose`: `{worldId}`.
- `godot.candidateState`: `{worldId,candidateId}`; bounded completed records recover a lost panel reply without confusing another candidate. A record superseded by a later committed build reports `closed` instead of a mismatch the page cannot act on.

The Godot checks tab uses existing `godot.candidateList` records, with a preview
button for ready candidates. Its preview header has Apply and Return controls;
the native game is inset below the extra 46-pixel header. Godot candidates do
not impersonate a legacy voxel advisory review. An uncertain apply exposes a
Confirm Result action. Reopening/reloading the panel first closes or reconciles
any owned candidate session, so a plugin restart cannot strand an invisible
prepared operation. Quit, disable and panel close first reconcile/discard the
candidate before the formal close checkpoint.

The initial page bootstrap reconciles the currently selected world's candidate
**before** calling `world.open`. Waiting until `mount(record)` is too late:
`world.open` correctly refuses a retained candidate, so the old ordering made
reload unable to reach reconciliation. Applied receipts reopen the committed
world; uncommitted previews abort and reopen the retained world. Uncertain
receipts remain blocked with the actual recovery error and are never committed
again. A list fallback that is not the selected world cannot close another
world's application. Sidebar surface requests obey the same busy, closing,
preview and application locks as the page's tab buttons; rejected requests must
not change the selected tab before native visibility has been authorized.

## Validation boundaries

`tests/godot-remaining/D/godot-candidate-coordinator.mjs` injects pure store/runtime faults.
`tests/godot-panel-recovery.test.mjs` executes the actual page bootstrap and
surface functions against deterministic host replies, including reload with a
retained preview, a committed application with a lost reply, and an unconfirmed
outcome. It opens no browser and makes no native rendering claim.
`tests/godot-remaining/D/godot-candidate-host.mjs` runs the real host class with deterministic native
seams and verifies retention, blocked saves, failed promotion, cancellation, fail-fast startup faults, bounded diagnostics and the first-instance path.
`tests/godot-remaining/D/godot-candidate-typecheck.mjs` checks the new coordinator and host types.
`tests/godot-remaining/D/godot-candidate-renderer.mjs` runs the real host against the fixed
repository-owned Web export in hidden/offscreen Electron: repeated staging, non-zero detached
candidate bounds, surface hide/show, a real `forcefullyCrashRenderer` crash during startup, and
renderer console/fault evidence. It needs no Rust core, so it separates the presentation lifecycle
from the application transaction.
`tests/godot-remaining/D/godot-candidate-native.mjs` uses a fresh test directory, real Rust and
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
