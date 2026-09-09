# Final bounded release review

Reviewed freeze: `5dca75be2067f70dd768dac169c93605dc1d9c82`.
Reviewer worktree: `D:/Craftmine World-worktrees/batch07-desktop-20260909`.
Scope: cumulative-token unlimited policy, prior failed-task recovery, request facts moved to the tail. This was a read-only product review. No production changes, live provider calls, UI/input control or additional package tests were performed.

## Conclusion

No new release-blocking defect was established within this bounded review. The implemented token policy, host-owned budget receipts, real error-ending recovery and stable request-prefix change are internally consistent with their declared contracts. This conclusion does not establish complete product correctness or replace the parent's native/same-package acceptance.

Two boundaries below must remain visible in release guidance. The first has an isolated actual Rust reproduction; the second is a conclusive source trace, not a newly executed end-to-end test.

## Verified scope

- New task owners default to `maxTokens: null`; existing finite owners retain their limits until an explicit player configuration. Actual, reserved and unknown charges survive configuration and recovery. The host-only configure/receipt methods are outside the model budget proxy. A committed old-head budget receipt is read-only and cannot configure a newer task.
- Unlimited cumulative tokens do not remove model context capacity, per-response output limits, request/compaction counts or the absolute task deadline. Both the initial request estimate and final serialized payload still enforce the real model window. Budget-limit errors are non-retryable and do not use the generic automatic-provider retry path.
- The actual error/abort lifecycle marks an eligible running current head interrupted in the same transaction, preserves draft/account ownership and releases authority. Startup legacy repair requires a matching persisted failed end record for the current session/world/project head. Completed/discarded/noncurrent tasks and records without that proof are excluded. Startup never replays a model request.
- Dynamic facts are appended to a copied request's final user/tool-result text content. The persistent conversation is not mutated; native tool-result IDs and reasoning turns remain intact. Stable policy remains in the system prompt. The final host snapshot supplies current facts, with earlier snapshots treated as historical data.
- Targeted existing cache/context tests ran successfully: **19/19** across `craftmine-cache.test.ts` and `craftmine-context.test.ts`. They use a local transport/model fixture and establish serialization/prefix/accounting behavior, not a real provider cache-hit rate. Parent-reported final Rust 57/57 and integrated Node 30/30 results were not represented as new reviewer runs.

## Known limit: expired deadline and generic recovery presentation

The host normally starts an absolute **30-minute deadline** at the first physical request. Removing a cumulative token cap does not extend that clock. Preserving this separate limit is the declared policy, not an unlimited-token defect.

An isolated production Rust protocol reproduction used an accelerated two-second deadline, no model calls, then error-ended the task, waited for expiry and explicitly resumed. Result:

```json
{"deadlineExpired":true,"maxTokens":null,"resumeAccepted":true,"nextRequestError":"TASK_DEADLINE_EXCEEDED","budgetOwnerPreserved":true,"absoluteDeadlinePreserved":true,"modelCalls":0}
```

The task workbench currently still shows “可恢复的创作” / “继续创作” whenever the interrupted task is inactive; it does not distinguish an expired deadline in that control. Resume can therefore report “草稿已恢复，正在继续创作” before the next request fails against the preserved clock. The subsequent localized error correctly says “本地任务运行时限已到。请在世界工作台查看已保存的任务。” This is a known presentation limitation, not a billing/data-integrity blocker. The same general distinction applies to preserved request/compaction limits. No policy change was made during freeze.

Source: `plugins/craftmine-world/host-requests.cjs` deadline initialization; `workbench-ui.mjs` recovery actions; Rust `durable.rs` reservation enforcement; `zh-CN/index.ts` deadline error. Reproduction record remains in the isolated `test-results/final-review-deadline-Kji6wi/result.json` directory.

## Important: ending a draft task does not carry its unpublished edits forward

Source inspection establishes this sequence:

1. `task_discard` keeps the historical task/draft records, but deletes the matching `craftmine_session_worlds` current-head row.
2. `workspace_open` then has no prior head and initializes the new task from the currently applied world's scene.
3. This also applies to a new turn in the same PI conversation. A newly created conversation is not a route to inherit the unpublished draft either.

Therefore `preservedDraft: true` means retained historical data; it does **not** mean a subsequent task automatically inherits that draft. The current ordinary workbench has no explicit “reattach this historical discarded draft” control. Existing tests establish historical draft retention and that a new workspace can open; they do not establish automatic inheritance, and the source explicitly selects the applied scene. No further runtime test was added after the parent's review-stop instruction.

Safe user guidance:

- If the task is still within its independent limits, adjust the token allowance if needed and use **继续创作** to resume the same owner/draft.
- If its absolute deadline has expired, do not promise that removing the token cap will make it continue.
- If unpublished edits matter, use **备份与诊断 → 导出全部世界和作品** before choosing **结束此草稿任务**. Domain backup includes task/workspace records. Wait for a completed export receipt; this preserves an archive, not an automatic way around the task deadline.
- After ending the task, explain that subsequent creation starts from the **already applied world**, and historical unpublished draft recovery is not currently exposed as a normal one-click flow. Do not tell users that ending and starting a task continues the same unpublished work.

This is a release-documentation boundary. No user data, expired production task, active conversation, credential, live browser or published artifact was accessed during the review.
