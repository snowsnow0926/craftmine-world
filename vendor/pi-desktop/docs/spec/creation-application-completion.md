# Creation application completion

For a creation-sandbox check, `status: passed` proves the frozen check and candidate, not adoption. `godot_build_read` additionally returns a same-job `creationApplication` receipt when the local managed executor has one for the exact world/project/session/turn. The production wait remains bounded to 30 seconds overall, including import/export/check and application. `waitReason: application-pending` preserves the last actual pending state at the deadline; reads never start application or prolong a turn.

The receipt contains format, job/world/build/candidate identity, status, bounded reason, and timestamp. The stored form also contains the owner context. `applied` is returned only from the host's matching application result; manual, failed, cancelled, or interrupted adoption does not rewrite a passed check as a failed check. Missing legacy receipts are `unknown`, not reconstructed success.

Pending publication precedes `godotJob.finish`. Before calling the host, the executor verifies current cancellation, stop, and ledger-write conditions. A check resumed without live context does not acquire adoption authority. A lost finish reply can be read back and settled, but does not trigger adoption. Restart preserves terminal diagnostics and changes pending application receipts to interrupted without replay.

The desktop task display shows applying only for the same in-flight host application. It reports applied from the actual formal build, and otherwise retains the checked candidate as awaiting adoption. Existing session/world/source/requirements/candidate/progress guards remain mandatory.

Verification covers read/apply ordering, bounded wait, cancellation and world switch, mismatched receipts, unconfirmed disk state, restart, context-less recovery, and lost finish replies. Deterministic timing evidence does not prove the cause of a historical model failure.
