# Restored Godot source to playable runtime

Portable archives intentionally exclude Web build caches. An applied database row alone therefore does not establish playability. `godotWorld.initStatus` now verifies the runtime artifact set before returning `playable:true`; unavailable artifacts return `playable:false`, the actual reason, and `rebuildRequired:true`. The recorded application, world build and full progress remain untouched.

## Core contract

Private `godotWorld.rebuildPlan({worldId})` returns:

```
format: craftmine.godot-rebuild-plan/1
worldId, rebuildRequired, reason, formalBuildId, worldRevision, snapshotHash
repoId, contentOid, branchId, rebuildBranchId, rebuildContentOid
```

`contentOid` is the exact formal build's indexed source. Old pre-Git builds use their exact legacy source-revision migration map. It is never replaced by current main HEAD. `rebuildBranchId` is a deterministic dedicated branch for this world/formal build. `rebuildContentOid` is initially null; after creating that branch from contentOid it is the new commit. The core verifies its tree equals the formal source tree and refuses `GODOT_REBUILD_BRANCH_CHANGED` otherwise. Ordinary application/check evidence validation runs even when the disposable artifact files are unavailable. Invalid formal evidence cannot gain rebuild permission by pretending to be missing cache.

## Main-process integration

Construct `createGodotRestoreRebuildService({domain,selection,restoreLoad})` with the actual private domain and candidate coordinator's **private** restoreLoad callback. `start(worldId)` returns one shared promise while that world is running; `status(worldId)` reports source/check/confirm/ready/failed. It upgrades legacy source storage when needed, creates the dedicated source branch, builds/checks its exact revision through the existing enqueue route, and validates the returned candidate against a refreshed core plan. It never recreates the world or writes a replacement snapshot.

The coordinator's restoreLoad must require a missing/unusable artifact plan, no running formal instance for this world, unchanged world revision/progress, and candidate content identity equal to `repoId/rebuildBranchId/rebuildContentOid`. It then uses the existing prepare/launch/commit/content-confirm transaction with the actual world snapshot. The ordinary first-load path must not broadly swallow runtime errors. The service reports ready only after the callback completed and an actual formal runtime descriptor resolves with the same full saved progress. Reading a plan or obtaining a passing check alone is not ready.

Root owns navigation, restored data-root activation, native renderer launch and the restoreLoad entry. This service is not a renderer/model capability. A failed or blocked check leaves the restored source, old formal world and complete progress intact. A changed dedicated branch is rejected, not reset over user edits.

## Related read-only source binding

Private `godotProject.sourceContext({worldId}) -> {context:{projectId,sessionId,turnId}}` obtains an existing session head joined to the world's real task/workspace. It does not open a new turn, create a task or mutate Git/SQLite. A finished task may supply read-only context. Missing source returns `GODOT_PROJECT_NOT_FOUND`; no valid current workspace returns `GODOT_SOURCE_CONTEXT_UNAVAILABLE`. A stale original author turn is never fabricated as a current head. Source index/read still enforce world identity.

## Evidence and remaining limits

- `core-restoration-full.log`: **269 passed, 7 ignored**, documentation test ignored. Includes binary-safe migration, pure source-context binding, and the real portable archive restoration described below.
- `rebuild-worlds-final.log`: 7 Godot world tests passed. The new test exports an applied world with modified inventory/quest progress and a newer unapplied main draft, makes the original source path unavailable, restores to a new directory without godot-builds, verifies not playable, rebuilds the exact old formal tree in a separate branch, commits/confirms, reopens the core and checks the full progress and main draft stayed equal.
- That test uses actual archive/Git/SQLite/build source materialization and application transactions, but **synthetic executor output and HTML artifacts**. It proves the recovery contract, not actual Godot rendering, Electron restoreLoad integration or model gameplay.
- `rebuild-service-final.log`: 3 orchestration fixtures cover success, truthful blocked check, wrong-candidate refusal; they do not create runtime evidence. `rebuild-service-types.log`: strict standalone service TypeScript passed. Earlier compilation and fixture failures remain archived.
- Copied worlds whose formal build belongs to another world's repository can require a separate source-transfer contract: if the exact formal commit is absent from the target repository, the plan refuses `GODOT_REBUILD_SOURCE_NOT_AVAILABLE`. It does not rebuild from a potentially different copied draft. This uncommon ownership case is not covered by the new restoration fixture and is not claimed complete.
- Deep Windows path limits and actual installed-package restore/renderer composition remain integration acceptance items.
