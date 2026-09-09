# Memory receipt acceptance

`memory.findReceipt({projectId,sessionId,worldId,operationId,request:{kind,claim,tags?,supersedes?}})` returns null when no receipt exists or the exact committed record after matching the trusted caller identity and normalized request. There is no turnId input and no new write/lease. `MEMORY_RECEIPT_OWNER_MISMATCH`, `REPLAY_MISMATCH`, `MEMORY_RECEIPT_UNVERIFIABLE`, or `MEMORY_RECEIPT_CORRUPT` must leave data unchanged. Main injects project/session/world from its authorized panel; renderer arguments cannot override them.

Scenarios: propose once; complete the turn; read and restart/read the exact receipt; ensure one memory remains; reject different owner/scope/claim/kind/tags/supersedes and unknown fields; absent ID returns null. A pre-migration operation remains unreadable as a trusted retry after repeated database reopen. Corrupted original evidence fails both lookup and backup inspection.

Export schema 2 with a receipt, inspect and restore, then find the same record. Construct a schema 1 archive using exact legacy columns and its original content hash; inspect/restore succeeds, but receipt lookup returns unverifiable. Re-export is schema 2 and validates. Unsupported versions and schema 1 mislabeled with schema 2 columns fail. Tests are pure Rust plus a synthetic stdio process using an explicit isolated binary/profile; no UI input or real model.
