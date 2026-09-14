# Restore complete canonical history through native history insertion

A real interrupted world-authoring session failed before its first model reply.
The retained protocol diagnostic was `turn/start`, RPC `-32602`, `Input exceeds
the maximum length of 1048576 characters.` The adapter had copied all historical
messages into a single new user input. Connection verification and the selected
`gpt-6-astra` / `xhigh` configuration were valid; this was not a quota or Godot
source failure.

The actual pinned `codex-cli 0.154.0-alpha.6.2` generated schema exposes
`thread/inject_items` with `{threadId,items}` and an empty response. Both ordinary
and experimental schema generation expose it. The official [App Server
documentation](https://learn.chatgpt.com/zh-Hans/docs/app-server) states that it
appends Responses API items to model-visible, durable history without starting a
user turn. `thread/resume.history` explicitly says it is unstable and for Codex
Cloud only, so we do not use it. No schema-level idempotency or unlimited runtime
capacity is inferred from an unconstrained JSON items array.

Choose ordered, acknowledged native insertion of the entire Rust transcript.
Old records are labeled historical-data messages with original source IDs, role,
status, time and exact chunk hashes. Never synthesize executable function calls or
claim old tool results describe the current world. Preserve images as image
blocks. Only after insertion succeeds, refresh current host facts and start the
actual current user turn. This changes transport framing, not model behavior,
permissions, current source/save data or the visible PI conversation.

If injection is interrupted or its acknowledgement is uncertain, do not retry
that batch into the same thread. Existing unsynchronized-checkpoint recovery
rebuilds a fresh opaque thread from canonical history on the next user request.
This avoids duplicate or partial history without a second history store. No
automatic retry, model substitution, manual PI compaction or history truncation
is introduced. Codex owns its normal context management after history insertion.

Mock protocol tests cover large real-shaped history, exact reassembly, source
hashes, original requests, Unicode boundaries, actual image blocks, cancellation,
injection refusal and an unchanged exact model/tool boundary. A separate read-only
projection of the original 207-message session confirms full retention; only the
coordinator's next ordinary restoration can establish live CLI acceptance.
