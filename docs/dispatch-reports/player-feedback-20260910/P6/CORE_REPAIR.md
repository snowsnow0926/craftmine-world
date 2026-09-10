# Initial bridge repair Core follow-up

The integration owner's read-only review request exposed that ordinary `project_patch_bytes` only checks the Git head from `OperationContext`; merely supplying applied/progress fields did not provide an initial-world guard. This follow-up adds a private finite `initialLoadRepair` constraint instead of changing ordinary authoring behavior.

Four targeted Core/Git regression groups passed: exact single-file change and restart replay; nine malformed/scope/identity/CAS refusals; actual Core formal adoption between the host read and repair with unchanged Git head; and repair invalidating a previously prepared old candidate. The tests also preserve customized bridge bytes and verify ordinary applied-world source editing remains available. The actual application transactions use authored Core evidence, not engine execution.

Validation commands use `cargo test -p craftmine-core --lib ... --offline` with the owned target `D:/cm-fb-p6-20260910/test-results/core-target`. No shared binary or sealed package was modified.

Original failures are retained. First compile missed a test-only `base64::Engine` import. The next run refused the post-adoption request through the existing task-finished guard before the desired repair-specific guard; the repair check now runs after read authorization and before active-write authorization. The final targeted run passed all four groups.

Full library run: **287 passed, 1 failed, 7 ignored**. The sole failing configuration-isolation test discovered the containing repository because this run's TEMP was inside the worktree. No production Git code was changed. The same failing test passed separately with a fresh owned non-repository TEMP at `D:/cm-fb-p6-core-temp-20260910`. This is reported separately, not as a full-suite all-pass rerun.

Raw logs live in `core-repair-raw/`; the original files remain under the owned test-results directory. Actual old-world retry/client testing remains the integration owner's follow-up and is not claimed here.
