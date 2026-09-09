# Batch 07: staged behavior and extension steps

One behavior module event stages its state, inventory, object patches, extension states and visible effects until every extension has returned and passed host validation. Failure, invalid permissions/state or disposal before publication discards the entire staged module step. Previously committed modules and unrelated player motion remain unchanged. Extension calls retain their authored order and each call observes earlier staged extension state and health effects.

Before publication, geometry is checked again against the current player position and target state. Time elapsed during asynchronous calls remains in the committed clock. The host then publishes one combined effect batch and its state. This is validation atomicity, not process-crash atomicity for GPU, sound or UI rendering. A failure inside the trusted final rendering callback is still an engine error; arbitrary external I/O is not part of the extension contract.

Existing extension permissions, exact dependency versions, source isolation, command limits and result validators are unchanged. No generated code runs as a migration. Incompatible extension-state versions still fail safely and retain the previous save; a universal extension-version upgrade language is outside this change.

Acceptance: tests/dispatch/batch07/extension-transaction.test.mjs covers a second command throwing, violating permissions or returning malformed state; no partial health/inventory/message/state publication; sequential staged health/state; player entering staged geometry during the await; disposal; and retaining the elapsed clock. Existing D actual game/Worker and native combination checks must be rerun against this runtime.
