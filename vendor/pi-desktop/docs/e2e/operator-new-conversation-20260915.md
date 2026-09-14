# Same-world new conversation: CPU acceptance and native checklist

Implementation base: root integration `589b6692`; isolated owner branch
`codex/operator-new-conversation-20260915`. Scope is private driver/helpers and
documentation. No active profile, native application or model is operated by
this change.

CPU verification (`node --test tests/operator-new-conversation.test.mjs`):

- An owned visible New Task control invokes its installed React callback once.
  Foreign ownership/session, hidden/inert/disabled/ambiguous controls, missing
  handlers and nonempty drafts reject before dispatch.
- Same-world navigation preserves formal identity, saved content and old
  message IDs/content digest, attributes old turns and remains unsent/unbound.
- An active model or argument override rejects without selection changes.
  Changed history with unchanged IDs, saved state, build or nonempty reused
  session is a real failure, not preservation success.
- Configuration failure and lost selection acknowledgement retain the actual
  new selected session. Read-only recheck after ordinary correction invokes no
  further callback and retains the initial error.
- First-prompt binding requires an accepted message/turn and matching canonical
  world/project/session/task/turn; navigation-only and foreign receipts fail.
  An uncertain binding read can be retried without sending again.
- The existing real provider validator rejects changed model, provider,
  context/output, thinking and automatic-permission settings.

Native follow-up is intentionally not yet executed. Parent-owned acceptance:

1. Finish or explicitly cancel the old request through ordinary controls and
   retain its actual outcome. Do not impose a new task time/token/call ceiling.
2. Optionally use existing `save` with `freeze:true` for a stable saved snapshot.
   Record current world and original chat/turn IDs.
3. Send `new-conversation` with `{}`. Review the actual new empty session,
   preserved identities/hash/history and exact PI configuration. No model has
   been sent by this command. If failed, inspect the recorded reason; correct
   only via ordinary controls and call `recheck-conversation`.
4. Submit the still-original player goal via ordinary `prompt` or separately
   `draft-composer` and `send-composer`. Check the recorded canonical binding.
   A binding-read error after acceptance does not justify resending; inspect
   and use the read-only recheck.
5. Record this as a same-world, different-conversation comparison. Retain all
   prior failures and do not call it a clean same-session six-step completion.

CPU tests cannot establish native navigation behavior or model performance.

Validation completed: 24 tests across the new conversation, provider, world-tab
and template-world helpers passed. The driver passes `node --check` and
`git diff --check`; evidence is retained in `test-results/new-conversation-cpu.log`.
