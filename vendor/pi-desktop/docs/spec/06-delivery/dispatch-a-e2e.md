# Dispatch A acceptance scenarios

1. Reserve a request, lose the network result, restart the actual service, and confirm the reservation remains charged and the draft cannot reopen without explicit recovery.
2. Resume into a fresh host turn, confirm the draft and original budget remain, then attempt an old-turn edit and confirm rejection.
3. Record three distinct compaction attempts and replay each event; the count must remain three. Resume and verify the count and requirements persist.
4. Finish the main stream while a matching verification exists; required review may reserve against that current draft. Cancel or replace it and reject new review requests. Known/unknown settlement cannot revive it.
5. Discard an interrupted task, open a fresh draft, and verify original draft history and formal progress remain intact.

Rust regression tests cover the transaction/accounting subset. Native PI compaction and real provider flow require the integration acceptance package; domain counter fixtures are not native compactions.
