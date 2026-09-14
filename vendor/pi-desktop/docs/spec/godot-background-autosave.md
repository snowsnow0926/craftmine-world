# Godot background autosave during candidate work

Periodic saves use `godot.runtimeAutosave` with exactly `{worldId}`. Main validates
the selected live world. If its candidate coordinator currently owns a preview
or application transaction, it returns `{worldId,status:"deferred",
reason:"GODOT_CANDIDATE_ACTIVE"}` without calling save. A native pre-save refusal
with that exact code may return the same result only while Main confirms current
candidate ownership. Other errors remain failures; copy and profile-restore
guards apply just as they do to explicit saving.

Successful saves return `{worldId,status:"saved",receipt}` only after the normal
native save transaction reports persistence and the runtime identity is still
current. The route does not checkpoint, close candidates, apply changes, create
additional retries, or authorize any model operation. It does not modify the
explicit `godot.runtimeSave` contract or candidate exclusion guards.

The periodic view operation has its own busy lifecycle. It preserves a prior
real error, retains the loaded world, and never calls resume after an expected
deferral or a failed background save. The next existing periodic tick retries
normally; deferred work is not presented as saved. Unexpected save errors remain
visible. Explicit Save continues to report failure during candidate work, with
an explanation to complete the preview/application before saving. Since an
ordinary explicit save does not freeze the runtime, its error path does not
issue an unrelated resume request.

Tests execute the actual view functions and Main panel coordinator together,
covering deferred and successful receipts, preservation of previous errors,
unrelated failures, strict candidate ownership, and explicit Save feedback.
