# Separate check completion from formal application completion

Status: accepted, 2026-09-11 (Craftmine CN4).

A core `passed` check creates a candidate before the asynchronous host application completes. Returning it as a complete creation result allows a model turn to end while the host still needs its active authorization.

The managed executor records a bounded, context-bound application receipt in its existing ledger before publishing a passed check. The read-only `godot_build_read` response includes `creationApplication` and may spend its existing 30-second wait on that same application's settlement. The check status remains unchanged. Pending, applying, applied, manual, failed, cancelled, interrupted, and unavailable receipts have distinct meanings.

Receipts are diagnostic evidence, not application capabilities. No new turn, extended permission, replay, or relaxed source/world/progress guard is introduced. Recovery checks without a live context can finish normally but cannot enter automatic application. Restart converts pending receipts to interrupted; a lost finish reply records its actual reason and never retries application. UI application progress is scoped to the host's actual in-flight job, and formal build identity remains the authority for an applied result.

The alternative of keeping an agent turn alive after it ends is rejected because cancellation and authorization must retain their current boundaries. Full hot application and changes to the core check schema are outside this decision.
