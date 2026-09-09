# Managed Godot build, check and candidate behavior

Scope: GD2 managed build slice, dispatch task B. Companion to ADR 0313 and
`docs/dispatch-reports/godot-parallel/B/INTERFACE_B.md`. Source authoring itself is
specified by ADR 0312.

## 1 Identities

| Identity | Value | Bound to |
| --- | --- | --- |
| `buildId` | `gbd-` + sha256 of the canonical identity document | world, base, formal base build, source revision, manifest hash, asset manifest hash, engine, renderer, target |
| `jobId` | `gjob-` + sha256(`craftmine.godot-job/1\|worldId\|taskId\|toolCallId`) | one tool call in one task |
| `candidateId` | `gcan-` + sha256(`craftmine.godot-candidate/1\|worldId\|buildId\|checkJobId`) | one passing check job |
| `executorId` | caller-supplied, ≤240 printable | one registered executor process |
| `token` | broker `randomUUID` | one claim |

The model never supplies `worldId`, `context`, `toolCallId`, `baseBuild`, a token
or an executor ID. Those come from the trusted broker or the executor process.

## 2 Asset store

- `godotAsset.put {name, mediaType, sha256, bytesBase64}` stores one payload of at
  most 98,304 decoded bytes. The declared hash must equal the actual payload hash
  (`CORRUPT_GODOT_ASSET`). Extension and media type must agree
  (`UNSUPPORTED_GODOT_ASSET`). Text extensions must decode as UTF-8.
- Assets are unique per `(world, path)`: the same path with different content is
  `GODOT_ASSET_CONFLICT`; the same content under a different name is
  `GODOT_ASSET_CONFLICT`. There is no in-place replacement and no delete tool.
- Limits: 256 assets and 32 MiB per world (`GODOT_ASSET_LIMIT`), 512 KiB per stored
  asset. Blobs are content-addressed and verified on every read; corruption is
  reported, never repaired.
- `godotAsset.list` pages 32 items and returns the world `assetManifestHash`.

## 3 Build jobs

- `godotBuild.start {revision, manifestHash, mode}` requires the exact current
  source head (`GODOT_SOURCE_STALE`) and a project authored against the world's
  current base or against an applied build of the same source lineage
  (`WORLD_BUILD_CONFLICT`).
- The per-build copy is materialized and verified before the job row exists. A
  materialization failure leaves no job and no build row.
- `mode: build` imports and compiles; `mode: check` additionally runs frozen
  assertions and, when it passes, creates a candidate.
- Without a matching attested executor the job is `blocked`,
  `executionAvailable: false`, `blockedReason: GODOT_EXECUTION_UNAVAILABLE`;
  `godotJob.claim` returns `GODOT_EXECUTION_UNAVAILABLE`. Registering a matching
  executor promotes such jobs to `queued`.
- `godotBuild.read` returns status, stage, progress, lease, build identity, the
  terminal output, recorded artifacts and `sourceStale`. It never starts work.
- `godotBuild.cancel` moves a non-terminal job to `cancelled`. A later result is
  refused with `GODOT_JOB_INACTIVE` and creates no candidate.
- `godotBuild.start` and `godotAsset.put` are idempotent by `toolCallId`: the same
  call replays its durable receipt, a different payload with the same call id is
  `REPLAY_MISMATCH`. The broker recovers an uncertain transport outcome by reading
  the original receipt (`godotBuild.receipt`) and never by repeating the write.

## 4 Executor contract

- `godotExecutor.register` validates the attestation format, a non-empty isolation
  label, a 64-hex evidence hash and the locked engine version, otherwise
  `INVALID_EXECUTOR_ATTESTATION`. Registration is process-scoped and lost on
  restart.
- `godotJob.claim` returns absolute `projectRoot`, `cacheRoot`, `artifactsRoot`, the
  `inputHash` the result must echo, the verified source/asset file list and the
  lease. Wrong executor or no registration: `GODOT_EXECUTOR_UNAVAILABLE`; wrong
  capability: `GODOT_EXECUTOR_CAPABILITY_MISSING`; non-queued job:
  `GODOT_JOB_INACTIVE`.
- `godotJob.progress` is monotonic and refreshes the lease
  (`INVALID_GODOT_PROGRESS` on a lower percentage). `godotJob.heartbeat` extends
  the lease. Both require the claiming token (`GODOT_JOB_OWNER_MISMATCH`).
- `godotJob.finish` requires `inputHash` = the job's request hash
  (`GODOT_JOB_INPUT_MISMATCH`), a matching engine version and evidence hash
  (`GODOT_EXECUTOR_MISMATCH`), and non-empty assertions for `check`
  (`GODOT_CHECK_ASSERTIONS_REQUIRED`). A job passes only when the executor's flag,
  import, compile with no errors, check flag and every assertion all pass. Artifacts
  must exist under `artifacts/` with the declared size and hash, otherwise
  `GODOT_ARTIFACT_MISSING`, `CORRUPT_GODOT_ARTIFACT`, `INVALID_GODOT_ARTIFACT` or
  `GODOT_ARTIFACT_CONFLICT`. A duplicate identical finish replays the stored record.
- Cancelled or interrupted jobs answer `GODOT_JOB_INACTIVE`, so a late result
  cannot revive them.

## 5 Candidates

- A passing check creates a `ready` candidate and marks older ready candidates of
  the world `superseded`; a failing check creates a `rejected` record.
- `godotCandidate.read` returns the candidate, its build identity and the real
  `check` assertions plus the full job output. `godotCandidate.list` pages 32
  newest-first.
- Readiness is re-checked at prepare time: a candidate whose source revision is no
  longer the project head is `GODOT_CANDIDATE_STALE`; a non-ready candidate is
  `GODOT_CANDIDATE_NOT_READY`.

## 6 Player application

- `godotApplication.prepare {id, token, candidateId, worldId, revision, snapshot}`
  requires a ready current candidate, the formal world's exact revision and content
  hash (`WORLD_REVISION_CONFLICT`) and unchanged player progress
  (`APPLICATION_PLAYER_CHANGED`). One prepared application per world
  (`WORLD_APPLICATION_BUSY`). It stores the full previous world document and does
  not change the world. Repeating the same request returns the same record; a
  different body for the same id is `REPLAY_MISMATCH`.
- `godotApplication.commit {id, token, evidence}` requires the prepare token
  (`GODOT_APPLICATION_OWNER_MISMATCH`), status `prepared`
  (`GODOT_APPLICATION_INACTIVE`), evidence format `craftmine.godot-application/1`
  with the prepare `inputHash` (`APPLICATION_EVIDENCE_MISMATCH`), a passed launch of
  the exact candidate `buildId` with a 64-hex state hash (`GODOT_LAUNCH_REQUIRED`),
  the unchanged player state (`APPLICATION_PLAYER_CHANGED`) and an unchanged formal
  world (`WORLD_REVISION_CONFLICT`).
- Success publishes the new build descriptor, keeps `extensions` and the player
  snapshot, advances the world revision, marks the candidate `applied`, records the
  authoring draft as applied and closes the authoring task. A duplicate commit with
  the same evidence replays the stored output; a different body is
  `REPLAY_MISMATCH`.
- `godotApplication.abort` moves `prepared` to `aborted`. Startup moves every
  `prepared` application to `interrupted`; the formal world is unchanged in all
  failure paths.

## 7 Limits

| Item | Limit | Code |
| --- | --- | --- |
| Stored asset | 512 KiB | `GODOT_ASSET_TOO_LARGE` |
| Model asset payload | 98,304 bytes decoded | `GODOT_ASSET_TOO_LARGE` |
| Assets per world / total | 256 / 32 MiB | `GODOT_ASSET_LIMIT` |
| Build files / file / total | 4,096 / 4 MiB / 64 MiB | `GODOT_BUILD_TOO_LARGE` |
| Artifact | 4 MiB | `GODOT_ARTIFACT_TOO_LARGE` |
| Job output document | 2 MiB | `GODOT_JOB_OUTPUT_TOO_LARGE` |
| Claim lease | 120 s | `GODOT_JOB_INACTIVE` after expiry |
| Queued without executor | 600 s | `blocked` + `GODOT_EXECUTOR_TIMEOUT` |
| Pages | 32 items | `INVALID_PROJECT_PAGE` |

## 8 Capability reporting

`hello` returns `godotProjects: true`, `godotExecution: false`,
`godotBuildJobs: true`, `godotExecutorGate: true`. `godotExecution: false` means
the core never runs the engine itself; builds require a registered executor.
`runtime_info` reports `godotBuildJobsAvailable`, `godotExecutorGate` and
`godotExecutionInCore` from that response, never from inferred tool names.

## 9 Out of scope

Real Godot import/export commands, OS isolation and its evidence belong to task A.
World view, layout and base projects belong to C/E. Model authorship, visual
acceptance and packaging are separate accounts. Nothing here claims that a fixed
author sample or a simulated executor proves real model creation.


## Integration audit corrections (2026-09-09)

- `godotJob.claim.projectRoot` is the `source/` directory containing `project.godot`. Each recorded source/asset is verified again before claim; corruption leaves the job queued.
- Export artifacts have streaming SHA-256 verification, separate from source/asset budgets: 256 MiB per file, 512 MiB per result, 4096 paths. Duplicate case-folded paths and reparse components are rejected. These acceptance limits are not disk quotas.
- Materialization flushes unique temporary files before publishing final filenames. Existing corrupt finals remain errors. Abruptly orphaned temporary files still need garbage collection.
- Application prepare requires the complete supplied snapshot to equal latest formal progress, including inventory/quests. Player mismatch retains `APPLICATION_PLAYER_CHANGED`; other mismatch uses `APPLICATION_PROGRESS_CHANGED`. Commit saves the formal snapshot and rechecks current source and asset identities (`GODOT_CANDIDATE_STALE`).
- World list/read summaries add optional `baseId` and `runtimeKind` derived from verified persisted builds. Known Godot scene + Godot metadata yields `runtimeKind: godot` and scene baseId. Known legacy scene formats yield `runtimeKind: legacy`, without an invented baseId. Unknown formats omit both. Metadata never grants launch permission.
- No executor is enabled. Host registration is an assertion, not an OS proof. Loopback isolation and host-authenticated new-instance evidence remain product gates.
