# Godot formal runtime host integration

This Cycle 5 contract supersedes the adapter-gap sections of
`godot-host-lifecycle-audit.md`. Rust remains the owner of formal worlds,
artifacts, complete progress and revisions; Electron owns runtime instances.
No new model-facing build or execution permission is introduced.

## Trust and storage

The main-process `PluginRuntime.requestCraftmineHost` allowlist and the private
plugin router both include the exact three runtime RPCs (`describe`,
`describeCandidate`, `saveProgress`), with a 60-second host transport budget for
artifact hashing and persistence. This does not widen the panel/model methods.
Full-client verification exercises this broker; a test that supplies its own
domain callback cannot prove that the product allowlist is connected.

The private main-process adapter calls `godotRuntime.describe({worldId})`.
Only `craftmine.godot-runtime-descriptor/1` with `phase: formal` is accepted.
A null result means a legacy world; a corrupt or unavailable Godot artifact is
an error. The fixed `web/index.html`, absolute managed artifact root, declared
file hashes, complete snapshot and formal build identity come from Rust. Neither
the panel nor world document supplies a path. Candidate descriptors are excluded.

`GodotWorldOpenRequest` now requires `artifacts`. Before serving, the loopback
runtime checks canonical containment and rejects link components. Every GET and
HEAD checks the declared file length and SHA256, then serves the same verified
buffer. Extra files return 404 and changed files return 409. Limits are 4096
files, 256 MiB per file, 512 MiB per manifest and simultaneous response buffers.
These checks are not OS isolation or proof against arbitrary concurrent native
filesystem races. Export/import of arbitrary generated projects remains gated.

The runner returns its exact UTF-8 `snapshotText`, SHA256 and byte length in
`craftmine.godot-runner-receipt/1`. The adapter checks the currently active native
instance, world/build, parsed complete snapshot and 1 MiB limit, then calls
`godotRuntime.saveProgress`. Its durable receipt must have matching world,
build, instance and snapshot SHA256, a non-decreasing revision and content hash.
An unchanged snapshot can legitimately keep its revision. A lost transport
reply is never resolved by repeating the mutation: the adapter reads Rust and
accepts only the same complete state at the same formal build and an equal or
newer revision. Recovery echoes the verified original instance/text hash for
runner acknowledgement; it does not infer a committed state from runner output.
The older fixture receipt format remains supported by the host class only;
production uses the stricter adapter and new Rust receipt.

## Native lifecycle and panel

The actual Electron main process creates the adapter, host and panel coordinator,
and the build includes its isolated preload. A runtime starts paused, loads the
complete snapshot and resumes before replacing the old view. The main surface
positions the sibling WebContentsView; checks/workbench actions detach and pause
it, and returning to the world attaches and resumes it. Each instance retains its
own loopback origin, nonpersistent session, fixed IPC scope, permission denial,
network origin restriction and context-isolated sandboxed preload.

The authenticated Craftmine panel exposes only world identity plus action flags
through `godot.runtimeState`, `godot.runtimeSave`, `godot.runtimeResume` and
`godot.runtimeSurface`. Supplied state, filesystem paths and foreign world
identities are rejected. The Save control receives a real durable receipt.
Formal Godot worlds can pass through the same navigation UI as legacy worlds.

World-open coordination holds descriptor polling across the explicit switch and
selection commit. Descriptor or old-save failure keeps the old instance. If the
selection write fails after a replacement loaded, the previous world is restored
from its confirmed durable state. If that restoration also fails, or the selected
world changed despite a lost reply, the uncertain view is hidden and paused and
a combined error is reported. This is bounded recovery, not a two-phase native
view commit retaining the original instance through the selection transaction.
Reopening the selected world is the explicit retry path.

Panel close preparation first waits for active page work and checkpoints the
native runtime. Disable, panel close and application quit then use the host's
safe departure API. Failed persistence blocks departure/quit; forceful teardown
is reserved for already saved or test-discarded instances.

The host/native/page wire limit is 8 MiB UTF-8 (state is repeated in receipts),
with at most 16 pending operations and bounded timeouts. Cycles, BigInt, malformed
JSON, oversized responses and callback exceptions return explicit errors; they
must not silently consume a request forever. Foreign instance responses cannot
settle current requests.

## Verification and limits

- `node tests/godot-runtime-boundaries.mjs`: actual HTTP serving plus pure main
  coordinator and page bridge faults; no child process or input.
- `node tests/godot-host-lifecycle.mjs`: host class with deterministic native/store
  seams; includes checkpoint ordering, save failures and concurrent lifecycle.
- `node tests/godot-host-typecheck.mjs`: strict targeted host/adapter/coordinator/
  preload compilation; optional dependency-root environment borrows declarations.
- `node tests/godot-runtime-adapter-core.mjs`: actual Rust process, formal artifact
  registration, complete Unicode progress, no-op revision, identity denial,
  lost reply, process restart and artifact corruption. Executor/launch proof is
  explicitly authored fixture data, not actual Godot or sandbox evidence.
- `node tests/godot-runtime-native.mjs`: fixed repository-owned E managed base
  import/export, offscreen Electron WebContentsView and real Rust persistence,
  equipment mutation, storage failure, sibling visibility and full process
  restart. It uses a fresh data directory, hidden/unfocusable windows and a
  preload guard; no mouse/keyboard, Pointer Lock or user browser automation.
  Native executor/application registration remains test-only. This harness uses
  the same host/adapter modules; full product UI and model authorship are separate.

Actual counts, failures and paths belong in the Cycle 5 evidence report. Do not
infer native success merely from tests that use runtime/store fixtures. Neither
this slice nor a Web export establishes an AppContainer boundary, packaged asset
rights, arbitrary engine capabilities, or candidate application UI completion.
