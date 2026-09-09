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
- `godotJob.continue {context,worldId,toolCallId,originJobId}` starts a new
  execution of a saved draft. The origin job must be terminal without a pass
  (`interrupted`, `cancelled` or `failed`) and belong to the same world. The new
  job keeps the origin's immutable build copy and records `originJobId`, so the
  original task, draft and accounting stay intact. A moved source head is
  `GODOT_CONTINUATION_STALE`; a formal world that no longer descends from the
  draft's base is `WORLD_BUILD_CONFLICT`. A repeated call replays the stored job.
- `godotJob.usage {worldId,context?}` returns one record per terminal execution
  plus totals. Core-measured values are wall-clock, source/asset/host/artifact
  bytes, artifact count and build file count. Model-side counters (tokens,
  requests, compactions, context tokens, service quota) are not observable here
  and are listed under `unknown` instead of being reported as zero.
- Godot application prepare/commit/read/abort and `world.read` are allowlisted
  through both private broker layers for the native candidate coordinator.
  Panel callers never receive application tokens.

## Job lifecycle and expiry

`expire` runs inside every job-facing transaction and records `interruptReason`
when it ends a job: `GODOT_LEASE_EXPIRED` for a dead worker lease,
`GODOT_QUEUE_TIMEOUT` for a queued job no executor ever claimed,
`GODOT_EXECUTOR_REVOKED` for revocation and `GODOT_HOST_RESTART` for the startup
sweep. `godotBuild.cancel` accepts an optional uppercase reason code and defaults
to `GODOT_CANCELLED_BY_USER`; cancelling twice replays the stored record. A
cancelled, interrupted or revoked job is terminal: a late executor result is
refused with `GODOT_JOB_INACTIVE` and can never register a candidate or revive
the job. Interrupted jobs are not re-queued automatically; the host asks for a
new execution explicitly, either through `godotBuild.start` or `godotJob.continue`.

## Host build resources

New build identities include a versioned hash of the threaded Web preset, HTML
shell and bridge. These immutable `kind: host` files accompany source without
modifying the authored manifest. Builds reject shadowing of the three reserved
paths. Embedded line endings are normalized before hashing. The executor copies
the pinned bridge to `web/bridge.js` and verifies it before serving. Existing
applied builds retain their stored identity and are not silently re-exported.
Databases created before host files existed are migrated by rebuilding the build
file table so `kind: host` rows can be recorded.

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
