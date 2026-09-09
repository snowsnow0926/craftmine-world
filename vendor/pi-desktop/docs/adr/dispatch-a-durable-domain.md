# Dispatch A: retain task budgets across explicit recovery

Status: implemented domain layer, desktop integration pending.

PI remains the only agent loop. SQLite records reservations before transport starts and accepts idempotent settlements after cancellation. A recovered task gets a fresh identity but retains the original budget owner, preventing crash/compaction from granting a fresh allowance. Immutable prior drafts and receipts remain available. Recovery uses the existing workspace transaction rather than a second writable store.

The broker owns identities and usage. Model arguments cannot select a task, generation, budget limit or source requirement record. Unknown consumption remains reserved until explicitly accounted for, rather than silently treated as zero.
