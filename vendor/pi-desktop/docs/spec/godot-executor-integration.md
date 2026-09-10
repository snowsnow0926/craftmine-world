# Managed Godot executor integration

The private builtin plugin owns the worker connection. Model tools submit a
world/task-bound build request and read its durable result; they never supply
an executable, local source directory, OS evidence, launch token or artifact root.

## Core interfaces

- `godotExecutor.status` reports the current core's live build/check availability.
  Restart clears registrations. A capable executor is selected even if another
  registered executor lacks the requested capability.
- `godotExecutor.revoke {executorId}` removes that registration and interrupts
  its claimed/running jobs, invalidating run tokens. Other executors are untouched.
- `godotJob.checkDescriptor {jobId,token,artifacts}` requires a live claimed check
  job and rechecks source/assets/host resources and staged artifact paths, counts,
  sizes and hashes from the core-owned root. Entry is `web/index.html`. Duplicate
  paths, foreign owners, revoked leases and corrupt bytes fail. Its phase `check`
  grants neither formal progress writes nor candidate readiness. Only the private
  verifier receives paths; the method does not register artifacts or publish.
- Godot application prepare/commit/read/abort and `world.read` are allowlisted
  through both private broker layers for the native candidate coordinator.
  Panel callers never receive application tokens.

## Host build resources

New build identities include a versioned hash of the threaded Web preset, HTML
shell and bridge. These immutable `kind: host` files accompany source without
modifying the authored manifest. Builds reject shadowing of the three reserved
paths. Embedded line endings are normalized before hashing. The executor copies
the pinned bridge to `web/bridge.js` and verifies it before serving. Existing
applied builds retain their stored identity and are not silently re-exported.

After application, a new authoring turn may continue its source only when the
current formal Godot world's source lineage matches the manifest. The new
immutable source revision advances `baseBuild` to that actual applied baseline
and keeps the real writer binding. Previous revisions retain their baseline;
foreign lineage is refused, and source edits never mutate formal play progress.

## Execution boundary

The worker is the fixed private Windows `godot-host-broker.exe run` protocol,
with a parent-owned channel, fresh task root and exact pending build binding.
Versioned policy and per-launch token/Job/network checks belong to that broker;
Godot stdout cannot attest to OS permissions. The Node supervisor must validate
responses and copied inputs/artifacts, maintain leases, propagate cancellation
and run an isolated Web check. Core interfaces alone do not enable availability;
an operational worker and verifier must be present and tested.
