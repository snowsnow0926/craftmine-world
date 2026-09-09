# Content-history E2E scenarios (dispatch M)

Status: documented scenarios for the VM0/VM1 content-history delivery. The IDs
`E2E-M-01` … `E2E-M-12` are placeholders; the main task assigns the final
catalog numbers. Scenario structure follows
[04-e2e-test-plan.md](./04-e2e-test-plan.md) section 6.

Milestone labels use the VM stage names from
`docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 10. Acceptance criteria
refer to the V01–V15 scenarios in section 11 of the same plan.

---

### E2E-M-01: History after three edits and a restart

- **Preconditions**: A managed repository exists for a world; three creation
  edits are committed on `main` (create project, add weapon, tune weapon), each
  with `Craftmine-Request` and `Craftmine-Task` trailers; the latest commit
  carries a canonical `craftmine.assets.lock.json`. No UI input is used.
- **Steps**: 1) Read `history("main", 0, 10)` and record `records`, `total`,
  `nextSkip`. 2) Read each commit's parent chain and its changed paths.
  3) Close and reopen the repository store (process restart equivalent) and
  re-read the same page. 4) Read the committed files and the asset lock of the
  newest commit and build its `ContentRef`.
- **Expected**: `total` is 3; records are newest first with an unbroken parent
  chain; `requestId`/`taskId` survive the restart; committed bytes and the
  canonical lock bytes are unchanged; `ContentRef.assetLockHash` equals
  `asset_lock_hash()` of the committed lock; `verify(["refs/heads/main"])`
  reports no damage.
- **Specs linked**: `dispatch-m-content-history.md` sections 4 and 5;
  `tests/godot-remaining/M/contract/asset-lock-vectors.json`
- **Acceptance criterion**: V01; VM1 exit (history and restart retention)
- **Milestone**: VM1
- **Status**: Documented; Git-side behavior covered by
  `repo_tests::commit_branch_history_and_asset_lock_are_authoritative_in_git`.
  Product-level restart proof is pending task A wiring.

### E2E-M-02: Two plan branches stay independent

- **Preconditions**: A world repository with `main` at commit A; two plan
  branches created from A with stable internal branch ids.
- **Steps**: 1) Commit different content on `plan-a` and `plan-b`. 2) List
  branches. 3) Attempt a commit on `plan-a` using `plan-b`'s head as the
  expected value. 4) Commit a further change on `plan-a` with the correct
  expected head.
- **Expected**: `refs/heads/main`, `refs/heads/plan-a` and `refs/heads/plan-b`
  exist independently; the stale expected value fails with
  `GIT_REF_CAS_FAILED` and leaves `plan-a` unchanged; the correct expected value
  advances only `plan-a`; `main` never moves.
- **Specs linked**: `dispatch-m-content-history.md` section 5
- **Acceptance criterion**: V02; VM1 exit (independent branches)
- **Milestone**: VM1
- **Status**: Documented; covered by
  `repo_tests::concurrent_branch_writes_are_rejected_by_compare_and_swap`.

### E2E-M-03: Draft survives a failed check

- **Preconditions**: A branch with a saved draft reference
  `refs/craftmine/draft/<branchId>` pointing at candidate content; the
  content check for that candidate fails.
- **Steps**: 1) Record the draft OID and the `main` head. 2) Fail the check.
  3) Re-read the draft and the branch head. 4) Re-open the store and read them
  again. 5) Confirm no applied marker or version was created.
- **Expected**: The draft reference still points at the same candidate after the
  failure and after restart; `main` and `refs/craftmine/applied/<world>` are
  unchanged; no formal version or applied record was created; the failed
  candidate remains inspectable.
- **Specs linked**: `dispatch-m-content-history.md` section 5;
  `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 6
- **Acceptance criterion**: V03; VM1 exit (drafts retained)
- **Milestone**: VM1
- **Status**: Documented; draft ref behavior is covered by
  `repo_tests::commit_branch_history_and_asset_lock_are_authoritative_in_git`.
  The check itself belongs to tasks C/I.

### E2E-M-04: Restoring old content creates a new record

- **Preconditions**: A world with at least three commits on `main`, an older
  commit carrying a canonical asset lock, and a newer `main` head.
- **Steps**: 1) Read the older commit's tree and asset lock. 2) Restore that
  content as a new commit on top of the current head (never a reset or a
  force-update). 3) Read the resulting history and the new commit's
  `ContentRef`. 4) Read the current applied marker and progress record.
- **Expected**: The restore is a new commit whose parent is the previous head;
  the old commit remains reachable in history; the new commit's
  `assetLockHash` matches the restored lock; the applied marker and confirmed
  progress are not silently rewritten by the restore itself; history can still
  find the original commit afterwards.
- **Specs linked**: `dispatch-m-content-history.md` sections 5 and 6;
  `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 6
- **Acceptance criterion**: V05; VM2 exit (restore record)
- **Milestone**: VM2
- **Status**: Documented; the Git-side commit/CAS primitives exist. Real
  progress migration and application are pending tasks A/C/D.

### E2E-M-05: Stale candidate versus a changed baseline

- **Preconditions**: A candidate was prepared from a baseline
  `ContentRef`; afterwards either `main` advanced or the committed asset lock
  changed.
- **Steps**: 1) Recompute the baseline `ContentRef` for the candidate's branch.
  2) Compare it with the candidate's recorded baseline. 3) Attempt to apply the
  stale candidate. 4) Read the branch, draft and applied marker.
- **Expected**: The candidate is reported stale and is not applied; the updated
  baseline is not overwritten; the original branch content and the candidate
  draft are retained for repair or a new branch; no applied marker moves.
- **Specs linked**: `dispatch-m-content-history.md` sections 5 and 6
- **Acceptance criterion**: V07; VM2 exit (stale candidate)
- **Milestone**: VM2
- **Status**: Documented; `content_ref`/`asset_lock` comparison primitives
  exist. The staleness decision point is wired by tasks A/C.

### E2E-M-06: Crash between the Git reference update and the database commit

- **Preconditions**: An apply operation has advanced
  `refs/craftmine/applied/<world>` to the target content; the process is
  terminated before the deployment/progress transaction commits.
- **Steps**: 1) Record the operation id, the target OID and the pre-operation
  applied OID. 2) Kill the process at that boundary. 3) Restart and run
  recovery. 4) Inspect the Git reference, the deployment record, the save and
  the running instance.
- **Expected**: Recovery reports only what Git can prove: the reference is at
  the target while the database is not, so the operation is completed or rolled
  back before any new write or publish is allowed; "Git advanced" is never
  reported as "apply succeeded"; Git, deployment record, save and instance end
  up consistent; a reference that moved elsewhere is reported as a conflict and
  freezes writes.
- **Specs linked**: `dispatch-m-content-history.md` sections 5 and 7;
  `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 7
- **Acceptance criterion**: V08; VM2 exit (crash recovery)
- **Milestone**: VM2
- **Status**: Documented; the Git-side reference transaction and recovery
  primitives exist. The database/progress half belongs to tasks A/N.

### E2E-M-07: Lost response with operationId replay

- **Preconditions**: An operation with a known `operationId` committed
  successfully but its response was lost before reaching the caller.
- **Steps**: 1) Replay the same request with the same `operationId` and the same
  input. 2) Read the returned receipt, the applied reference and the progress
  revision. 3) Replay with a different input under the same `operationId`.
- **Expected**: The first replay returns the stored receipt for the original
  operation without applying anything again and without granting rewards twice;
  the applied reference and progress revision are unchanged; a reused
  `operationId` with different input is rejected as a mismatch.
- **Specs linked**: `dispatch-m-content-history.md` section 5;
  `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 7
- **Acceptance criterion**: V09; VM2 exit (idempotent replay)
- **Milestone**: VM2
- **Status**: Documented; the durable receipt/operation identity lives in the
  VM2 transaction layer. End-to-end proof is pending tasks A/C/D.

### E2E-M-08: Text-clean merge that is a gameplay conflict

- **Preconditions**: Two plan branches from a common base where a clean Git
  text merge is possible (no overlapping text hunks) but the merged result is
  semantically invalid — for example an entity is deleted on one side while the
  other side adds a reference to it, or a required dependency is removed.
- **Steps**: 1) Run the three-way merge and record `conflicted`, `tree` and
  `conflicts`. 2) Confirm the merge returned a tree with no Git conflict.
  3) Run the content verifier on the merged tree. 4) Inspect the branch,
  applied marker and check evidence.
- **Expected**: The Git merge is clean and returns a tree, and the verifier
  still fails the merged result. A clean Git merge is never reported as a
  gameplay pass; parent check evidence is not reused; nothing is applied.
- **Specs linked**: `dispatch-m-content-history.md` section 6;
  `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 6
- **Acceptance criterion**: V10; VM3 exit (re-verification)
- **Milestone**: VM3
- **Status**: Documented; the Git-level clean/conflicted outcomes are covered by
  `repo_tests::merge_reports_clean_text_and_real_conflicts_without_reusing_parent_checks`.
  The semantic verifier is pending tasks C/I.

### E2E-M-09: Binary and asset-version conflicts

- **Preconditions**: Two branches change the same binary asset, or reference two
  different versions of the same asset, or one deletes an asset another branch
  depends on.
- **Steps**: 1) Diff the changed paths with `changes` and `file_diff`. 2) Run
  the three-way merge. 3) Inspect the reported conflicts and the resulting
  lock. 4) Apply an AI- or human-proposed resolution and re-check the result.
- **Expected**: Binary changes are reported as `FileDiff::Binary` with byte
  sizes and are never shown as a text patch; the merge never concatenates
  binary content and never resolves a conflict by "take newest"; asset-version
  and dependency conflicts are listed for a new candidate; the resolution forms
  a new candidate that is checked again before it can be applied.
- **Specs linked**: `dispatch-m-content-history.md` sections 5 and 6;
  `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 6
- **Acceptance criterion**: V11; VM3 exit (conflict reporting)
- **Milestone**: VM3
- **Status**: Documented; binary diff separation is covered by
  `repo_tests::changes_and_file_diffs_separate_text_from_binary`. Asset-level
  conflict judgement is pending tasks C/I.

### E2E-M-10: Missing legacy blob and corrupt object are reported

- **Preconditions**: A world already migrated from legacy revisions; one legacy
  blob file is deleted or tampered with, or a Git object is corrupted.
- **Steps**: 1) Run migration preflight on a damaged legacy source and inspect
  `problems`. 2) Attempt `apply`. 3) After a successful migration, tamper with a
  legacy blob and run `verify`. 4) Corrupt a Git object and run
  `verify(["refs/heads/main"])`.
- **Expected**: Preflight reports the missing/tampered blob and `apply` refuses
  with `CONTENT_MIGRATION_SOURCE_INVALID`; nothing is written; post-switch
  `verify` reports the byte mismatch instead of repairing it; repository
  integrity checking returns only real damage lines and never hides damage
  behind a passing exit code; the backend stays `git`.
- **Specs linked**: `dispatch-m-content-history.md` sections 5 and 7
- **Acceptance criterion**: V12; VM1 exit (honest damage reporting)
- **Milestone**: VM1
- **Status**: Documented; covered by
  `migration_tests::a_missing_blob_is_reported_and_blocks_the_import` and
  `migration_tests::verification_reports_legacy_damage_after_the_switch`.

### E2E-M-11: Bundle plus full restore in a new directory

- **Preconditions**: A world with a protected named version, at least one
  branch and a recorded applied marker; a fresh empty target directory; the
  complete backup package produced by the backup owner.
- **Steps**: 1) Create the Git bundle for the protected refs and verify it.
  2) Assemble the full backup (Git bundle, asset bodies, drafts, revision map,
  deployment/check metadata, selected save). 3) Restore into the new directory.
  4) Verify history, refs, asset locks and the selected progress. 5) Re-run the
  restore with one body missing or a hash mismatch.
- **Expected**: The bundle verifies and the restored world has identical
  history, protected refs, asset locks and selected progress; the original
  world is untouched; a restore that is missing content or fails a hash check
  is rejected and does not replace the original world.
- **Specs linked**: `dispatch-m-content-history.md` section 5;
  `docs/VERSION_MANAGEMENT_DEVELOPMENT_PLAN.md` section 8
- **Acceptance criterion**: V13; VM2 exit (full backup/restore)
- **Milestone**: VM2
- **Status**: Documented; `bundle()` create+verify is covered by
  `repo_tests::bundle_reclaim_and_prune_only_touch_unreachable_objects`. The
  full-package and new-directory restore is task H's work.

### E2E-M-12: Reclaim keeps protected refs; hostile paths and config

- **Preconditions**: A repository with a named version, a task checkpoint, a
  draft, a migration ref and an applied marker, plus an abandoned branch whose
  ref has been deleted; a world tree containing Chinese and long paths and two
  paths that differ only by case; a repository whose `config` contains hostile
  keys.
- **Steps**: 1) Run `reclaim_plan` with `main` only and record
  `garbageObjects`, `referencedElsewhere` and the sample. 2) Add every protected
  ref to the keep set and re-plan, then `prune`. 3) Commit the Chinese/long
  paths and the case-colliding pair. 4) Append hostile keys
  (`core.hooksPath`, `filter.*.clean`, `core.fsmonitor`, `diff.external`,
  `credential.helper`, `include.path`, `alias.*`) to the repository config and
  open the repository.
- **Expected**: Objects of the deleted branch are reported as garbage and only
  they are pruned; objects of non-keep branches are reported as
  `referencedElsewhere` and are never deleted; every protected ref survives
  reclaim and history still verifies; the Chinese and long paths commit and
  materialize correctly; the case-colliding pair is rejected with
  `PATH_COLLISION`; the hostile configuration is refused with
  `GIT_CONFIG_FORBIDDEN` and no hook, filter or external command is executed.
- **Specs linked**: `dispatch-m-content-history.md` sections 3, 4 and 8
- **Acceptance criterion**: V14 and V15; VM4 exit (reference protection and
  hostile input)
- **Milestone**: VM4
- **Status**: Documented; covered by
  `repo_tests::bundle_reclaim_and_prune_only_touch_unreachable_objects`,
  `repo_tests::materialised_copy_has_no_git_metadata_and_reports_unsupported_entries`,
  `repo_tests::authoring_exclusions_traversal_and_case_collisions_are_refused`
  and `git_tests::hostile_repository_configuration_is_rejected`.

---

## Project rule for every automated run

Only independent headless or offscreen processes and pure-logic tests may be
used. Automated acceptance runs in its own process and its own data directory,
disables Pointer Lock at initialization, and must not send real mouse or
keyboard input, steal or move focus, activate or foreground a window, or
operate the user's browser. UI-driven input automation is out of scope for
these scenarios.
