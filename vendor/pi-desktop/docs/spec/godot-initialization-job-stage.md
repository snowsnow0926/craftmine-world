# Initialization stages for known job failures

`godot_worlds.rs::godot_world_init_status` emits `status: failed` with
`GODOT_JOB_FAILED` when a persisted build/check job failed without a more
specific reason. It emits the same status with `GODOT_JOB_ENDED` for a
cancelled/interrupted job without a persisted reason. These finite codes come
from the job branch, after project creation, and therefore identify the initial
build stage rather than the project-source stage.

The creation projection must show materialization and project creation as
passed, build as failed, and confirmation as pending for these two codes.
`creation.stage` and `creation.error.stage` must both be `build`. The state
remains failed, the original reason and retry/details actions remain visible,
and no success, progress or executable capability is inferred.

Only the two exact fallback codes are added to the existing explicit build-stage
reasons. A failed status alone, the presence of `projectRevision`, a code prefix
or an arbitrary diagnostic string cannot establish this phase. Unknown/project
errors keep their existing projection; unknown statuses do not become failed
or playable just because their reason resembles a job failure.

The seven regression tests use the actual projection and the real core response
shape. Source provenance is the job selection/mapping and result construction
in `godot_worlds.rs`. They do not run or attest an engine, and they do not replace
full-client release acceptance. This correction is for the next integration;
the frozen 827 package and its existing acceptance records are unchanged.
