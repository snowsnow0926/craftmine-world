# Known initialization job failures: stage correction

Base: `8276b4540289c0d397c382dff2123edfe1861d42`.
Branch: `codex/plan-init-stage-20260910`.
Worktree: `C:/cm-init-stage-0910`.

Confirmed source defect: `godot_worlds.rs:385-388` generates
`GODOT_JOB_FAILED` / `GODOT_JOB_ENDED` in the existing-job branch. The response
at lines 411-419 includes the derived failed status and project revision. The
creation projection previously recognized only execution-unavailable and path
budget errors as build failures, so these ordinary job failures were incorrectly
shown at project creation.

The original 827 projection reproduced both wrong stage arrays in the new
contract tests: 2 failed / 5 passed. The fix adds only these two exact reason
codes; unknown reasons, code lookalikes and project errors are not reclassified.
No core, executor, initialization retry, package or permission behavior changes.

Validation outputs are preserved in `evidence/`. These are core-contract
projection tests, not new actual-engine runs. This commit is held for the next
integration and must not be described as present in the frozen 827 release.

After the fix, all 33 tests passed (7 stage contracts, 11 terminal lifecycle
regressions and 15 creation tests). Strict checking of the creation/initializer
TypeScript modules also passed using existing dependencies. The E2E scenario
was appended without changing any previous file bytes. No engine or client was
launched and no original acceptance evidence was changed.

Boundary: arbitrary custom interruption reasons are still unclassified. The
current status response does not expose a separately trusted failed-stage/job
identity; this patch does not guess that provenance from an error prefix or
from project existence.
