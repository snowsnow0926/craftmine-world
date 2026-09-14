# Cross-turn DeepSeek prompt measurement

Keep request authorization and measurement reuse distinct. Every reservation and settlement retains the complete current task binding, including turnId/taskId/baseBuild and generation. The host gateway, ledger, lease, tool permissions and final output allowance checks are unchanged.

Only the existing trusted official DeepSeek Flash text path may reuse its in-memory measured prefix across author turns. The measurement key binds project, player session, world, runtime kind, base and generation, and requires a currently host-revalidated full-auto creation capture with autoApply=true, a running owned task and no superseded/observer-only capture. Missing or changed permission returns to a task-bound key containing its permission facts. A new runtime or restart has no inherited receipt.

This key is not sufficient by itself. Retain the original exact native and final wire prefix verification, including provider/API/model, system, tool definitions, output allowance, body options and hashed transport headers. Any old-message change, media, differing tool/system/options or unknown prefix uses the complete conservative estimate. All remaining current messages and host data are estimated anew; the old entire measured prompt count remains an upper allowance and is never discounted for removals or edits. Authorization data in the current request is not removed from its payload.

The new measurement key is held privately against the prepared request and is not serialized to the ledger or model. A delayed, cancelled or failed request cannot install a reusable receipt. Final serialized body proof and the new task's successful reservation remain prerequisites for sending the request.

The configured 1M window, 384K output allowance, 613952 input capacity and 521859 compaction threshold are unchanged. The existing 48000-byte host-data guard is also unchanged. No model/task/request-count limit or automatic retry is added.
