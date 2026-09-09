# Failed resumed-turn launch

The host calls private `task.interrupt({context,reason})` when an explicit task resume has committed but appending the continuation, selecting the provider or starting the sidecar fails. It must call this before the ordinary `workspace.endTurn(..., status: "error")`. Model tools and renderer channels must not expose this operation.

The reason is an uppercase code matching `[A-Z][A-Z0-9_]{0,79}`. Raw error messages, paths, prompts and provider response bodies are forbidden as reasons. The exact current workspace context is required. A first call needs a running task that owns its lease; a prior task context cannot affect a later generation.

One SQLite immediate transaction marks the current task cancelled and recoverable, releases its lease, cancels queued/running verification jobs and running reviews, aborts prepared applications belonging to its verification jobs, and revokes worker tokens. Only this task's reserved budget requests become unknown; their estimates remain charged. Draft, revision, generation, cumulative budget owner and original requirements remain intact. Other worlds, leases and reservations are untouched.

An immutable host receipt is kept in the existing receipt table using reserved tool-call identity `@host:interrupt`. It retains the normal draft receipt fields and adds `kind: "task-interrupt"`, status, bounded reason, binding, generation, budget snapshot and `modelReplay: false`. Identical calls return the same receipt even after ordinary error end; changed reasons fail. Once another generation owns the session head, even an old identical request fails with `STALE_TURN`. No schema or backup table change is needed.

The existing end-turn method only changes running status and lease state; it does not clear recovery. A normal new workspace request then fails with `EXPLICIT_RECOVERY_REQUIRED`. A second explicit resume preserves the budget owner, unknown reservations, compaction counters, draft and original goal.

## Verification

Rust tests exercise resume, launch reservation, interruption, normal error end and another explicit resume. They assert original code/goal, three compactions, known usage and unknown reservation remain. They also reject foreign/old identities, unknown fields, sensitive or oversized reason text, and contradictory replay. A separate world's live lease/reservation remains unchanged. Durable job-state fixtures verify token cancellation without claiming actual model, review or application success.
