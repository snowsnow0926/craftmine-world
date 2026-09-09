# ADR 0313: Managed Godot build, check and candidate transactions

- Status: Accepted for the GD2 managed build slice
- Date: 2026-09-09
- Related: ADR 0307, ADR 0309, ADR 0312

## Problem

ADR 0312 stores Godot source revisions but nothing can turn a revision into a
verified build. The product needs managed import/compile/check jobs that are
queryable, cancellable and recoverable, binary assets that do not travel through
the 2 MB draft document, a candidate that cannot replace the formal world by
itself, and a hard gate so no model-authored project runs without a verified
isolated executor.

## Decision

`craftmine-core` gains additive tables in the same `tasks.sqlite`:
`craftmine_godot_assets` and `craftmine_godot_asset_receipts`,
`craftmine_godot_builds` and `craftmine_godot_build_files`,
`craftmine_godot_build_receipts`, `craftmine_godot_jobs`,
`craftmine_godot_candidates`, `craftmine_godot_applications` and
`craftmine_godot_applied_drafts`. No second world database and no second Agent
loop is created. Existing world identity, task/session/turn binding, exclusive
world lease, receipts and startup recovery are reused unchanged.

**Build identity.** A build is a pure function of the formal world, the base ID,
the formal base build, the exact source revision and manifest hash, the asset
manifest hash and the locked engine/renderer/target tuple. Its ID is
`gbd-<sha256(canonical identity)>`, so any source or asset change produces a
different build and a stale build can never be presented as the current
candidate. The asset manifest hash is the digest of the sorted asset list; asset
payloads are content-addressed under
`<domain-data>/godot-assets/<sha256(worldId)>/<sha256>` and are never overwritten
in place: one virtual path holds exactly one payload.

**Per-build copies.** `<domain-data>/godot-builds/<sha256(worldId)>/<buildId>/`
contains `source/` (materialized source and assets), `cache/`, `artifacts/` and a
`manifest.json`. Materialization re-reads every blob from the content store,
verifies size and hash, writes with write-through semantics and re-verifies
existing content instead of overwriting it. Cache and artifacts are rebuildable
and are never treated as authoring source. The recorded file list is the exact
verified set an executor may read.

**Execution gate.** The core never starts Godot. An executor must call
`godotExecutor.register` with a bounded attestation (`craftmine.godot-executor/1`,
isolation label, 64-hex evidence hash, the locked engine version and its
import/build/check capabilities). Registration is process-scoped and is dropped
on restart; the core records identity and hash but does not claim to have
verified the operating-system isolation itself. Without a matching registration a
job is created `blocked` with `executionAvailable: false` and
`blockedReason: GODOT_EXECUTION_UNAVAILABLE`, and `godotJob.claim` refuses.
There is no unisolated fallback path. Jobs are `blocked|queued|claimed|running`
plus terminal `passed|failed|cancelled|interrupted`; claims carry a 120 s lease,
heartbeats extend it, `read`/`claim` expire dead leases to `interrupted`, and
queued jobs that never see an executor become `blocked` after 600 s.

**Result recording.** `godotJob.finish` accepts only a result whose `inputHash`
equals the job's request hash, whose engine version and evidence hash match the
claiming executor, and for check jobs whose assertion list is non-empty. A
claimed pass is not enough: `passed` is recomputed from import, compile errors,
check flag and every assertion. Declared artifacts are resolved inside the build's
`artifacts/` directory and must exist with the declared size and hash before they
are recorded. A result arriving after cancellation or interruption is rejected
with `GODOT_JOB_INACTIVE` and produces no candidate. A duplicate finish with the
same body returns the stored receipt; the claiming token is retained on terminal
jobs so a lost response is answered without re-running anything.

**Candidates.** A passing `check` job creates `gcan-<sha256(...)>` with status
`ready` and supersedes older ready candidates of that world; a failing check
creates a `rejected` record that can never be prepared. Candidate readiness is
re-evaluated against the current source head, so a later patch makes an older
candidate `GODOT_CANDIDATE_STALE`.

**Application.** `godotApplication.prepare` requires a ready candidate, the
current formal world revision and content hash, and unchanged player progress; it
stores the complete previous world document and does not touch the world.
`godotApplication.commit` additionally requires a new-instance launch record for
the exact `buildId` with a state hash, the same player state, and the caller's
token. Only then does one transaction publish the new build descriptor
(`scene.format: craftmine.godot-scene/1`, `godot.*` identity including the source
`baseBuild` lineage), keep the existing extensions and snapshot, advance the world
revision, mark the candidate applied, and record the authoring draft as applied so
the next turn resumes from the applied build instead of a stale scene. Abort,
interruption, restart or any failed check leaves the formal world and its progress
unchanged. Prepared applications are moved to `interrupted` at startup.

## Consequences

- Source revisions remain authoritative; builds, caches and artifacts are derived
  and reproducible, so retained storage can grow and needs a later lifecycle
  design. No garbage collection is introduced here.
- The formal world descriptor changes shape for applied Godot builds. The legacy
  runner must treat `build.scene.format: craftmine.godot-scene/1` as not its own;
  legacy worlds are untouched.
- `godotBuild.start` is synchronous only for identity, materialization and job
  creation, which are bounded (4,096 files, 4 MiB per file, 64 MiB per build).
  Import, compile and check always run in the isolated executor.
- Model-facing tools never receive host identity. `worldId`, `context`,
  `toolCallId` and `baseBuild` come from the broker; panel reads may omit the
  turn context but then only the world identity is checked.
- Applying a build closes the authoring task, exactly like the legacy application
  flow, so further tool calls in that turn are rejected as `TASK_INACTIVE`.
- The core does not verify that an executor is genuinely isolated. That evidence
  belongs to task A and must be validated before any deployment claims isolation.

## Validation

`cargo test --offline -p craftmine-core` covers assets (hash forgery, path/media
consistency, per-world isolation, size limits, corrupt blob), build identity
changes with source/assets/base, stale-source rejection, cross-world and ended-turn
rejection, blocked-without-executor and promotion after attestation, claim
ownership and absolute isolated paths, monotonic progress and lease extension,
compile errors overriding a claimed pass, empty assertion rejection, candidate
creation/supersession/staleness, cancellation with a late result, restart
interruption, artifact hash/escape rejection and input-hash mismatches. The
application suite covers prepare/commit, retained previous world, launch evidence
mismatches, newer-progress conflict, single prepared application per world,
replay safety, restart interruption, rejected candidates and next-turn continuity.

`node --test tests/godot-build-tools.mjs` drives the real broker bundle against the
real core over stdio with a simulated executor process: blocked-then-queued
pipeline, candidate readiness, stale/cross-world refusal, cancel with late result,
receipt recovery for a lost asset write and a lost job start, the player-only
application transaction and the tool catalogue shape. No test imports model-authored
Godot code, sends real input, requests Pointer Lock or focuses a window.
