# Explicit thinking off and complete summaries

Date: 2026-09-10. Status: accepted for the next candidate, native creation pending.

A real exact-model run configured off-only omitted the DeepSeek thinking field.
One HTTP 200 response consumed its entire 16384 output limit as reasoning with
no text/tool call. The pinned SDK emits the documented off field only when the
adapter-facing model still has its thinking capability; the user-level off-only
binding had erased it. Preserve that capability for the narrowly identified V4
transport without changing the user's allowed levels or model identity.

The same run produced summaries ending with length. The pinned compaction helper
rejects error and aborted but accepts length. Reject incomplete summaries at our
existing one-request boundary before checkpoint creation, keeping original
transcript and existing marked recovery behavior. Add concise Craftmine working
handoff instructions so old successful manifests/check reports do not grow into
cumulative inventories. Do not remove payload-budget protections or fabricate
successful authored content. Offline wire/compaction evidence cannot establish
that the new package completes the hammer or dog request.
