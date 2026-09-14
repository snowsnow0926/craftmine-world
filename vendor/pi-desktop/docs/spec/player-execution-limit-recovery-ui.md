# Explicit player recovery from local execution limits

The task workbench and a failed-turn card with an exact request, compaction or
deadline exhaustion code offer an explicitly labeled action to remove local
execution limits and continue. Ordinary failures keep the existing continuation.
Token budget failures and provider/context errors never authorize this action.

`task.releaseExecutionLimits` is a Main-owned persistent panel operation accepting
only world ID, task ID, generation and operation ID. Main derives the viewed
session/project and verifies the selected world and inactive current task. The
private Core API owns the interrupted/exhausted checks and audited policy change.
An uncertain result is retrieved through `budget.findExecutionReleaseReceipt`
before another write; the same historical receipt remains readable after resume.
Its validation requires preserved token policy, null request/compaction/deadline
limits, and explicit `modelReplay:false` / `resumed:false`.

After a confirmed release, the player action checks the viewed session and world
again before invoking ordinary `task.resume`. It does not send the old prompt,
reset the ledger, fabricate a task or continue after an unknown receipt. A model
never receives this capability. If resumption fails, the committed release and
draft remain inspectable and the UI reports that continuation is unconfirmed.

The workbench displays null request/compaction limits as unlimited. New ordinary
tasks use the Core policy; this UI does not change per-request model capacity or
the player's explicitly configured token budget.

The real Core receipt includes a numeric `createdAt` timestamp. Main validates
that field rather than rejecting a successful policy change. If a release reply
was lost, the next explicit action resolves its matching journal entry before
resuming. If release succeeded but continuation launch failed, the new interrupted
task can resume its already-unrestricted policy without attempting another
release. `tests/player-execution-release-core.test.mjs` exercises these paths
through the actual Rust Core, private host gateway, Main journal and UI helper;
it does not launch a model or substitute mocked Core receipts.
