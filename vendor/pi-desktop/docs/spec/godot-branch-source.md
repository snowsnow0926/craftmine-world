# Managed branch authoring

`godotProject.index`, `godotProject.read` and `godotBuild.start` accept
`branchId`, default `main`. Git `patch` / private `applyFiles` use the branch
in the required OperationContext. A nonexistent branch is refused; create
one through `content.branch.create` before indexing it. Legacy worlds expose
only main until `content.migrate.apply` succeeds.

Source revision numbers are globally monotonic within a world, not counters
reused independently by each branch. `craftmine_godot_project_commits` binds
each revision to its branch, immutable commit, manifest hash, canonical asset
lock hash, author and manifest index. The manifest contains metadata and file
hashes, never source bodies. `craftmine_godot_projects` remains the compatible
main-head index; authoring another branch does not overwrite it.

Build identity and its durable row bind branchId and the exact content commit.
Jobs expose branchId, candidates expose `content:{repoId,branchId,contentOid}`.
Continuation and candidate freshness compare that branch's head. A passing
check supersedes only candidates from the same branch. Application refreshes
the branch index under the same OS operation lock before its database
transaction, preventing an outdated candidate from applying after a source
write or an interrupted Git index update.

Application ordering: prepare a stable content operation from the candidate's
actual content identity and the current formal progress revision; advance its
Git applied reference with CAS; commit the launch-confirmed Godot application;
confirm content using its actual applicationId. Exact prepare/advance/confirm
replays return the durable completed operation. Another world, branch, target,
expected revision or applicationId cannot reuse the operation id. Once an
application committed, recover by confirming it, not by undoing its Git half.

Validation uses two distinct branches with real managed Git commits and core
build/check/application transactions, then restarts the core and replays an old
confirmed operation. Check and launch evidence in these unit fixtures are
synthetic; they are not Godot rendering or real-model acceptance evidence.
