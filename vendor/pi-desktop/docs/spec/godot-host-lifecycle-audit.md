# Godot host lifecycle audit repair

Historical audit contract: the Cycle 5 adapter and production integration
superseding its outstanding gaps is in `godot-formal-runtime-host.md`.

This contract supersedes the lifecycle and descriptor examples in task C's original
`INTEGRATION_C.md` / `integration.patch`. Those examples are not product wiring.

## Host API

`GodotWorldOpenRequest` requires the trusted host's `worldId`, `buildId`, absolute
artifact `root`, and durable `revision`. `entry`, `threads`, `snapshot`, `build`,
and startup `timeoutMs` remain optional. Missing revisions fail; zero is never
inferred. Every new instance initializes its save baseline from that revision.

- `checkpoint()` waits for an earlier save, pauses the current runtime, then takes
  a fresh snapshot and commits through `progress`. Success returns
  `{status:"persisted",receipt,runnerReceipt,snapshot}` and keeps the instance
  paused. Failure resumes the existing instance and returns `{status:"failed",error}`.
- `resume()` invalidates the cached checkpoint. Mutating `request()` calls are
  rejected with `WORLD_BUSY` during a transition or while checkpointed.
- `ensure(request)` checkpoints an existing instance before starting a replacement.
  A valid paused checkpoint is reused. The new runtime must load successfully
  before the old view is disposed. Failure resumes and retains the old instance.
- `switchWorld(null)` checkpoints before departing for the legacy renderer.
  Saving failure keeps the old instance. `sync()` uses this safe path and treats
  descriptor RPC failure differently from an explicit null descriptor.
- `prepareForQuit()` checkpoints before exit; failed persistence never exits.
- `close()` / `dispose()` remain forceful teardown primitives for already-saved
  or discarded instances. Product switch, disable and quit paths must use the
  safe API first, and must not ignore a failed checkpoint.

A receipt is accepted only with exact `craftmine.progress-receipt/1`, matching
world/build identities, an increasing safe-integer revision, and a 64-character
lowercase SHA256 `contentHash`. Missing data must not be synthesized by the
callback. The callback must perform the real Rust progress transaction and own
transport-result recovery; a runner confirmation alone is not persistence.

## Artifact and progress adapters remain required

`godotEngineOf` now recognizes B's `build.id`, `scene.format=craftmine.godot-scene/1`
and `godot.target=web`. It returns metadata only (`kind`, `buildId`, `threads`).
Neither this helper nor legacy `build.engine` can authorize `root` or `entry`.
The trusted host must resolve verified artifacts by world/build identity. The
runtime checks canonical paths against canonical allowed roots, rejecting an
out-of-root target even when the lexical path appears inside the allowlist.
This is not an OS sandbox or a claim against concurrent native filesystem races.

The runtime save result remains a base-specific state. B's existing
`world.saveProgress` accepts the legacy `craftmine.progress/*` envelope; the
integrator must define a lossless state adapter and persist its complete fields.
Do not forward arbitrary state into the old validator or discard fields to pass
it. A product Godot switch also needs host selection rollback and a real artifact
resolver. The renderer still needs a channel to hide the sibling game view on
checks/workbench pages. These shared interfaces are outside this repair.

## Validation

Run `node tests/godot-host-lifecycle.mjs` from the repository root (Node 24).
The real TypeScript host class executes in a VM with deterministic runtime/view
and persistence callbacks. Seventeen tests cover persistence-before-switch,
failed storage/candidate/descriptor handling, safe null departure, paused receipt
reuse, rejection of malformed receipt identity/hash/revision, pause failure,
concurrent startup/save, cancellation during startup, missing revision, canonical
root containment, save-before-freeze ordering, and B metadata path suppression.
No Electron, browser, Godot import, player input or real database is launched.

`node tests/godot-host-typecheck.mjs` strictly checks the edited host. The optional
`CRAFTMINE_TYPECHECK_DEPENDENCY_ROOT` borrows installed types from a checkout without
writing there. Evidence used the original C checkout's unchanged imported modules.
The result was zero TypeScript diagnostics. This is a targeted typecheck, not a
full desktop build. Logs are in `C/audit-evidence/`.

The original Electron fixture now supplies an explicit fixture revision and a
proper SHA256-shaped content hash; this does not turn its callback into Rust
persistence. Its real Electron/Godot acceptance was not rerun during this repair.
Windows junction behavior and native concurrent reparse races remain unverified.
