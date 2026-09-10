# Selected issue export stays in the native host

Date: 2026-09-10
Status: Accepted for the PP6 selected-record slice; pending product integration

## Context

The local notebook already retains immutable player wording and separately
bound followups. Players need a way to save one selected record without granting
the panel arbitrary filesystem access or collecting unrelated diagnostics.

## Decision

Add a bounded native `issue.export` service and a detail-view action. Export a
finite projection of existing collected fields at the player's selected
revision. Resolve the destination only through the existing native save picker.
Keep file bytes and paths inside Main. Reuse the existing atomic selected-file
writer and allow its pre-commit guard to be asynchronous; await both its previous
synchronous guards and the new selection/record reread.

Freeze bytes and picker authorization per operation. Do not silently update a
stale revision, repick during a retry, or evict an operation to recycle its
identity. Bind the UI reply to the original world epoch and request identity.
Use a strict 512 KiB output cap and 32 operation slots per host process.

## Consequences

The file is suitable for a player to inspect and manually share, but it does not
include a saved game, source project, screenshots or a full diagnostic bundle.
No model, credentials-status call, upload or external service is involved.
The notebook remains byte-identical after success, cancellation or write failure.
Same-process lost replies can be recovered with the original operation. Durable
cross-process export receipts, crash cleanup and import remain out of scope.

The implementation is verified with actual service/filesystem fault tests and
the production DOM over loopback HTTP. Native dialog behavior, complete Electron
wiring at runtime and packaged acceptance remain separate integration work.
