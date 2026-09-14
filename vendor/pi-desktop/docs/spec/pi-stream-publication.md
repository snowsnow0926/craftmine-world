# PI streamed assistant publication

PI provider tokens continue to flow through the native agent loop without a
token, request-count or turn-duration limit. Only the publication of accumulated
assistant UI snapshots is coalesced: publish the first partial immediately, then
at most once per 100ms while only partials arrive. Keep one latest pending update
per runtime, before `assistantContent` flattening, prefix/delta comparison and
sidecar JSON serialization.

PI partial message arrays and blocks are mutable. Snapshot their current string
references with shallow block copies when accepting an update. Do not retain all
prior partials, serialize accumulated strings at enqueue time, or replace the
agent's own model-facing message/history. Published deltas include all text and
thinking added since the last published snapshot, with the existing replacement
behavior when the provider rewrites a prefix.

Every non-partial agent event is an ordering boundary. Synchronously flush the
latest partial before publishing tool, error, status, model-call or terminal
events. Message end still publishes the complete authoritative message, usage,
error and status to the existing main-process/Rust persistence path. Coalescing
must never omit tool calls, terminal failures, usage accounting or transcript
content. New messages and turns flush/reset the old pending update before
changing ownership. Abort and disposal flush already accepted text, cancel the
timer, and ignore later provider partials; disposal closes the publisher.

The renderer already coalesces by session/message at animation-frame boundaries
and replaces the latest message row. This production optimization acts earlier,
reducing full-message flattening, sidecar/main NDJSON work and Electron IPC before
renderer batching can help. Main's in-flight checkpoint mechanism is unchanged.
Codex has a separate runtime and is unaffected.

A test observer retaining every raw growing snapshot adds its own unbounded
history cost. Its cumulative log bytes are not a measurement of live production
renderer memory. Diagnose and validate that test collector separately.
