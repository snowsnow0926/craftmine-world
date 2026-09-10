# Local, immutable problem descriptions before model diagnosis

Date: 2026-09-10

The existing diagnostics exporter contains an allowlisted application summary;
it is not a persistent player problem notebook. Reusing memory proposals would
also involve task/model semantics that are inappropriate for local recording.

Add a host-owned, bounded local service with immutable descriptions, projected
formal runtime identity, and persistent mutation receipts. Keep it separate from
authoritative world/content/progress state: recording a problem cannot save or
change the world. Client wiring supplies the trusted context and profile path;
the panel cannot supply build identities, attachments, paths or capabilities.

Choose an atomically replaced, file-synced JSON ledger because the first slice
has at most 100 active records/2 MiB and one profile-owning host process. Reserve
delete-receipt capacity and refuse further creation at the lifetime cap instead
of forgetting old idempotency facts. The separate-process concurrency invariant
comes from Electron profile ownership, not this file format. Future archival and
private backup support need explicit versioned behavior rather than silent data
movement or operation reuse.

The service deliberately has no model, network, observation, log, screenshot,
snapshot, repair or export dependency. Full PP3 repair is not claimed. See
[Local issue records](../spec/local-issue-records.md) for the frozen contract,
bounds, durability limits and integration acceptance scenario.
