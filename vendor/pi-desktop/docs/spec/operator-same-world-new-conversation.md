# Same-world new-conversation operator action

This is a private acceptance-driver capability, not a new product API or user
control. `new-conversation` takes no arguments and invokes the existing visible,
enabled PI ConversationTopbar New Task React handler exactly once in the owned
offscreen renderer. That handler reaches `App.runMenuCommand("newTask")`,
`app-store.newSession` and the ordinary session-creation/navigation path. No
synthetic mouse/keyboard events, Pointer Lock, window activation, direct
`session.create`, prompt submission, world copy, restore or model-setting write
is added. Existing headless ownership and no-focus constraints remain required.

Before dispatch the current model must be idle, the composer empty, and the
selected UI session and world must match the operator report. An input segment
must have finished. Capture the old session's message IDs and message digest,
formal world/build/instance identity and saved world content hash. The hash
covers the durable world document including its saved snapshot. Keep the world's
title and content unchanged; record revision changes without treating a
same-content periodic save as data loss. No save, pause or resume is performed
by this command. Operators may first use the existing ordinary save/freeze
action to make a stable saved-state comparison.

Wait for a different active session, assert an empty transcript and unchanged
project scope, and retain the old transcript and prior turn-to-session/world
attribution. The existing UI can reuse a genuinely empty conversation; the
driver never rewrites its ownership or treats UI selection as durable binding.
Check the actual PI provider/default model and session-effective configuration
again: the authorized `deepseek-flash`, 1,000,000 context, 384,000 output, maximum
thinking and automatic permission settings. Do not reduce these settings or
substitute another model. New sessions resolve ordinary defaults, so an old
session's local override is not sufficient evidence.

Configuration or preservation failure leaves the actual selected new session
in the report with `failed-unsent`, the original error and partial evidence.
It neither sends nor creates another session to conceal the failure. The
no-argument `recheck-conversation` only rereads state/configuration after any
ordinary player correction. It preserves the original failure. `prompt`,
`draft-composer` and `send-composer` repeat that preflight while a handoff is
pending. Read-only status/inspection remains available.

Successful navigation is `ready-unsent`, with `bindingStatus: not-established`.
Only after the first ordinary `prompt` or Composer send is accepted does the
driver verify `world.conversation` and `task.current` against the actual
world/session/project/task/turn. The task project identity follows the existing
host algorithm. A navigation-only association or stale/foreign task cannot pass.
A readback failure records `accepted-binding-unconfirmed`: the prompt may be
running, so it is never resent. `recheck-conversation` may reread the same
accepted identity without another model request. Resumed reports retain these
transition records rather than flattening runs into one session.

This dimension tests reuse of the same saved world with a fresh conversation.
It does not claim continuation of the old chat history or a six-step success in
one session. The operator must preserve the original player goal in an ordinary
subsequent request and label the session boundary in reported results. No model
request, token or task-duration limit is introduced.
