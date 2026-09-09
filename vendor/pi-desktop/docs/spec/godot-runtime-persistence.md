# Managed Godot runtime persistence

The private `godotRuntime.describe` and `godotRuntime.saveProgress` operations
connect the Electron orchestrator to the Rust-owned world store. They are not
panel channels, agent tools, or execution permissions.

## Complete progress

`craftmine.godot-progress/1` has `worldId`, `baseId`, `baseVersion`, a positive
`stateVersion`, and an object `body`. The entire object is retained, including
custom gameplay fields. Its UTF-8 JSON size is at most 1 MiB. Each base validates
its native body; the core validates the envelope and world/base identity. Body
coordinates do not inherit the legacy voxel bounds. If the body includes
`worldId`, that identity must also match. Plain saves cannot change base/schema
versions or replace this state with legacy progress. Such changes need an
explicit future migration operation. Existing legacy saves keep their format.

The runner returns `craftmine.godot-runner-receipt/1` with world, build and live
instance identity, `snapshotText`, `snapshotSha256`, and UTF-8 `bytes`. The exact
snapshot text is hashed and its parsed value must equal the supplied snapshot.
Integral-float spelling differences (`1.0` vs `1`) are accepted without aliasing
large integers. A runner receipt confirms the snapshot only; it does not prove
host persistence or trustworthiness of arbitrary generated code.

The orchestrator binds each receipt to its own live instance before calling the
core. The core uses the current world/build/revision in one SQLite transaction,
keeps the build/extensions, and returns `craftmine.godot-progress-receipt/1`
with revision, content hash, persistence time, and snapshot hash. A no-op save
returns the existing durable revision and receipt; it is a valid checkpoint.
A prepared application freezes saves of the new Godot progress format. Failure
leaves the prior world intact. The page never submits its own durable receipt.

New-format progress requires application evidence `craftmine.godot-application/2`
containing the complete restored `snapshot`. A null legacy player projection
cannot stand in for full inventory, task, scene and reward preservation.

## Verified export descriptor

`describe({worldId})` returns null only for supported legacy formats. Missing,
unapplied, corrupt, unsupported, or migration-requiring Godot worlds return an
error. The descriptor includes a real revision, content hash, full build and
snapshot, base ID, root, fixed `web/index.html` entry, threading policy and
artifact hashes/sizes. Artifact paths derive from the core's own build store;
paths in a world document are never used to grant access.

The core verifies the applied application, its input/output hashes, candidate
and passed check, exact artifact list, every file's bytes/hash, and safe ordinary
path components. It retains the artifact caps (256 MiB/file, 512 MiB total,
4096 entries). A newer source draft does not revoke an already applied world.
`artifactManifestHash` identifies a core JSON manifest containing format
`craftmine.godot-artifacts/1`, world ID, build ID and sorted artifacts. The host
serves only those listed files, and must verify the actual bytes it serves;
startup hashing alone does not address later filesystem changes.

These operations do not register an executor, enable arbitrary engine import,
create a delivered base, or implement legacy-to-Godot conversion. Authored
fixtures with simulated executor results prove the host/storage integration
only. OS isolation and real model creation require separate evidence.
