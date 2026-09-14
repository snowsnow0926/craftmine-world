# Keep the original Codex RPC failure as bounded diagnostic data

An actual long-running world session was interrupted and then reopened. The
connection verified the pinned CLI and Astra/xhigh configuration; the adapter
created a new thread for canonical transcript restoration. Before any tool or
assistant delta it failed with `CODEX_BACKEND_FAILED`. The app-server adapter
already retained the RPC code and redacted message on its rejected promise, but
the desktop adapter discarded these fields when choosing a stable user error
code. Raw stderr is intentionally not retained because it may contain secrets.

Add fixed stage plus selected RPC metadata to the existing error details. Preserve
the stable error code and the original failure lifecycle. Do not retry, trim
history or change model based on an unknown cause. Only a later normal request
can produce new evidence; the old failed turn remains unchanged.

Official protocol reference: [Codex App Server](https://learn.chatgpt.com/zh-Hans/docs/app-server).
The observed project failure remains distinct from a failed Godot job; no Godot
check ran during this backend failure.
