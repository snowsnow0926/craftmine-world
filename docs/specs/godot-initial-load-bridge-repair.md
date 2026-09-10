# Initial-load bridge repair constraint

The private `godotProject.applyFiles` API accepts optional `initialLoadRepair: {initId: string}`. Unknown members are rejected. `godotProject.patch` does not gain this field. Ordinary edits without this flag keep their prior behavior.

The flagged operation must target the Git `main` branch and contain exactly one replacement:

- Path: `craftmine_shared/runtime_bridge.gd`.
- Expected previous SHA256: `318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76`.
- Actual replacement SHA256: `faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2`.

Inside the same `OperationLock::domain` and SQLite Immediate transaction used by Godot application commit, Core checks the initialization ID, absence of an applied initialization/application, the original initializing world build, the exact numeric `operation.expectedProgressRevision`, and `operation.expectedAppliedOid` against the actual Git applied reference. The normal source revision, manifest, branch-head and old-file hash guards still apply.

This validation occurs after read authorization but before live-write authorization and receipt replay. Thus a finished author task cannot hide an already-applied repair refusal. A successful reply lost before adoption can replay in a restarted Core with the same request; a repair request after formal adoption is refused even if its receipt exists. The host can first read playable status and finish without requesting another repair.

The host must send a numeric `initStatus.worldRevision`, not null. It must continue to build/check the new manifest and use ordinary first-load/candidate adoption. The operation does not modify managed-base materialization or progress, and cannot approve a candidate by itself.

The targeted regression uses actual Core/Git transactions with fixed authored artifact/check/launch receipts. It covers both serialization orders: formal adoption before the source repair (reject repair despite the same Git head), and source repair before an already prepared old application (reject stale candidate). This is not real Godot execution, a multiprocess stress test, or product-client acceptance.

## Host integration

Only an explicit initialization retry enables the repair. The host reads the bundled replacement and requires its pinned bytes. A customized bridge is refused; an already updated bridge requires no edit. For an already checked project or an initialization with a candidate, missing source files are refused instead of being filled from the original managed base. Initial incomplete materialization can still resume its existing installation path.

The host binds the repair to the current manifest, Git head, applied reference and numeric world revision. It does not change original managed-base files, their receipt, or progress. A new manifest must pass a fresh check before first-load adoption. Durable first-load failure remains a confirmation-stage, actionable message even when Main retains an older raw timeout string.

Verification: 37 controlled initializer, creation-stage and acceptance-relay tests pass in the integrated checkout. Six of these exercise old/new bridge bytes and preserved materialization; none is a claim of native gameplay or final-package acceptance.
