# Coalesce PI partial UI snapshots before serialization

Date: 2026-09-14

Status: Accepted.

The DeepSeek test observer recorded 34173 message updates with repeated full
thinking snapshots. Its retained history amplified memory use and the renderer
reported OOM. That log volume does not establish an equivalent production memory
footprint: the production React store already keeps only the latest pending
frame update. Nevertheless, the production runtime flattened each accumulated
message, computed its prefix delta, serialized the full envelope on stdio, and
sent it over Electron IPC before that renderer batching.

Keep the current full-snapshot event protocol but introduce a 100ms latest-only
publisher at the PI runtime's assistant-update entry, before flattening. Emit the
first partial immediately and flush before every control/terminal boundary.
Shallow-copy provider blocks because the native SDK reuses mutable partials.
Preserve cumulative delta semantics, full terminal messages and existing Rust
transcript ownership. Abort, dispose, new message and new turn boundaries cannot
leave a pending update attributed to a later owner.

This avoids a larger delta-only protocol migration and requires no database or
IPC schema change. It is a UI refresh cadence, not an evaluation or model budget.
Provider requests, thinking effort, context windows, usage and task completion
remain unchanged. Codex and the independent test collector are separate concerns.

The deterministic comparison and its memory/latency measurement limits are in
[the validation record](../e2e/pi-stream-publication-20260914.md).
