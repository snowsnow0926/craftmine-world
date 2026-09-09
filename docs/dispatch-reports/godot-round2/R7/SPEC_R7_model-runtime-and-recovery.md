# Spec fragment — model runtime observation, jobs and recovery (task R7)

Status: prepared by `R7`, numbering to be assigned by root. Companion ADR:
`ADR_R7_live-and-recovery-boundary.md`. Extends
`docs/dispatch-reports/godot-remaining/L/SPEC_model-tools-and-context.md`.

## 1 Tool surface added this round

| Tool | Risk | Modes | Reaches |
| --- | --- | --- | --- |
| `godot_jobs` | medium | status, usage, resume | `godotExecutor.status`, `godotJob.usage`, `godotJob.continue` |
| `godot_draft_recovery` | medium | list, resume | `task.recoverable`, `task.resume` |
| `asset_library` | low | search, read, versions | `asset.search`, `asset.read`, `asset.versions` |
| `package_library` | low | check, read, list, propose | `package.check/read/list`, proposals only |

Total advertised world tools: 35 (`godot_*`: 19).

## 2 Live observation

- A live sample is accepted only with `sampledAt` (ISO), `worldId`, `buildId` and
  `instanceId`.
- The result is `stale:true` with `mismatches` when: the world or build differs
  from the durable descriptor; the identity is missing; the instance differs from
  the previously accepted instance for that world; or the sample is older than
  the freshness window (default 30 000 ms, `options.maxSampleAgeMs`).
- `ageMillis` is reported. A fresh, identity-verified sample becomes the new
  per-world baseline; a stale one does not.
- Durable progress is never used to fill a live field. When no sampler is
  connected the tool returns `LIVE_OBSERVATION_NOT_WIRED` and lists unknown fields.
- The tool never writes progress and never produces a receipt.

## 3 Jobs and usage

- `status` returns the real gate: whether build and check are enabled, the blocked
  reason, and the registered executors.
- `usage` returns durable per-job wall clock and source/asset/host/artifact bytes
  with totals. These numbers are separate from model token/cache accounting and
  are never merged into it.
- `resume` re-queues an interrupted, cancelled or failed job by its original job
  id, carrying the host tool-call id; a replay returns the first result.
- Executor-facing token methods are never callable and are listed as
  `tokenGatedMethods`.

## 4 Draft recovery

- `list` returns interrupted drafts for the project with `taskId`, `generation`,
  `worldId`, `draftRevision`, `draftHash`, `resumable` and `blockedReason`
  (`OTHER_SESSION`, `NOT_INTERRUPTED`).
- `resume` accepts only an exact `taskId`+`generation` that is still listed and
  belongs to the current session; it opens a new turn and returns the real
  workspace and next generation.
- Expired, conflicting and unknown outcomes are reported with the real code:
  expired (`TASK_NOT_RECOVERABLE`, `STALE_GENERATION`), conflict
  (`NEW_TURN_REQUIRED`, `TASK_BINDING_MISMATCH`, `STALE_RECOVERY_SELECTION`,
  `WORLD_REVISION_CONFLICT`, `WORLD_APPLICATION_BUSY`). Unrecognised codes are
  preserved with `unknown:true`.
- Resuming is a write: discussion-only turns refuse it.

## 5 Automatic durable facts after compaction

- Every request appends a host snapshot as the final text block. It now contains
  `machineFacts.godotFacts`, a single line derived only from host-journal values:
  applied build, build status, world revision, draft revision/hash, the most
  recent journaled source manifest hash, base, engine, candidate, verification
  count and the executor gate.
- A world with no Godot identity (no explicit `godot` section and no journaled
  source manifest hash) produces no Godot line, so a legacy world is not
  mislabelled.
- The block is durable identity, never live game state, and never contains
  equipment or camera data. It stays inside the existing 48 000-byte snapshot cap.
- `godot_project_facts` remains the on-demand full rebuild and additionally
  returns `modelSwitch.capabilityHandshake`, `executor`, `usage`,
  `limits` and `docsCompatibility`.

## 6 Assets, packages and history

- Method names are the delivered R6/R4/M names; nothing is invented.
- `asset_library` is read-only. `current-world` scope is bound host-side; a
  `local-library` search does not claim a world scope.
- `package_library mode=propose` validates one of five intents and returns a
  non-applying proposal naming the real host method:
  `instance-only`→`package.install`, `variant`→`package.register`,
  `upgrade-selected`→`package.upgrade`, `restore-content`→`package.restore`,
  `restore-save`→`backup.restore`.
- `godot_history` requires a complete `OperationContext`: all seven fields present
  (`expected*` may be null). A world with no bound repository returns
  `OPERATION_CONTEXT_INCOMPLETE` with the missing fields instead of inventing a
  branch.
- An unregistered adapter returns `DEPENDENCY_NOT_WIRED` with the exact method and
  owner.

## 7 Acceptance pointers

- `tests/godot-round2/R7/` — 27 tests (logic, binding, context injection, real core).
- `tests/godot-remaining/L/` — 71 tests carried forward and updated.
- Evidence: `docs/dispatch-reports/godot-round2/R7/evidence/`.
- Real-model acceptance remains open (R7 item 7, joint with R8).
