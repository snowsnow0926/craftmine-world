# Batch 07 context boundary checks

Automatic Craftmine compaction uses the complete estimated request before a new
provider call. The acceptance fixture supplies a large completed transcript and
never emits new_context. The actual PI prompt loop must request one metered
summary, persist it, and send the new request with authoritative task facts.
The old user request remains transcript history and does not reappear as a bare
new task. A failed summary keeps the original transcript, installs no checkpoint
and sends no creation request. Provider and Rust ledger are explicit fixtures
in this test; existing real three-summary native runs remain separate evidence.

An explicit native resume adds only the player's continue action to the visible
transcript and requirement journal. It must not reverse, concatenate or
re-journal projected/truncated historical requirements as a new correction.
Original requirements and chronological corrections continue to arrive through
the authoritative request hooks and requirements_read tool.
