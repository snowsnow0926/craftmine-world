# First-load failure closeout

Scope: the proven post-prepare first-load failure previously survived only in
the initializer's memory. On restart, a ready candidate projected as checked
and could automatically launch again. The new Core failure record keeps this
terminal state across restart, with an exact explicit-retry tombstone.

Production: Core godot_worlds.rs + main dispatch + two backup allowlist entries;
Main candidate coordinator and initializer. No root index/creation or public
panel permission changes are included. Root must register the two exact private
RPCs and map GODOT_INITIAL_LOAD_FAILED/failureStage confirm to player text.

Validation: 13 actual Core world tests pass, including 4 new failure tests:
restart/replay/retry/tombstone, wrong identity/unsettled/stale/applied rejection,
new candidate isolation, and domain archive roundtrip/older archive compatibility.
Twenty-eight JS tests exercise the actual coordinator and initializer with controlled Core-
shaped callbacks; they do not replace Rust persistence evidence. Raw results
are archived in evidence/init-launch. Strict TypeScript includes initializer.

All new test data and Cargo outputs are in this D-drive worktree; existing
dependencies are read from the authorized dependency cache. No windows, input,
Pointer Lock, paid model calls or user profiles were involved. Missing or lost
prepare receipts and not-yet-recorded crash failures remain outside this bounded change. Root's
integrated client and durable restart acceptance are still separate.
