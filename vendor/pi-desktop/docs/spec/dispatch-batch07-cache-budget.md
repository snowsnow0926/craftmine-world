# Craftmine cache-aware request context and local limits

Request policy version 2 keeps the system policy stable across creation and
retry attempts. Fresh authoritative task facts are appended to the final user
or completed tool-result text block in a request-only copy. Native tool call /
result adjacency, assistant reasoning, player attachments and persisted history
are preserved. Summary and review use their own stable purpose policies. No
snapshot is journaled as a new player request. Context reminders also stay at
the tail in Craftmine scope. Tool discovery and actual compaction may still
change cache prefixes; correctness takes precedence over cache reuse.

The host still reads authoritative identity, requirements, leases and budget on
every physical request, measures the whole outgoing context and checks the final
serialized payload. Moving facts never removes scope checks or token accounting.
The prompt cache is a provider optimization, not local memory or proof of a
successful task. Cached input remains in the provider total; reasoning is not
added to completion tokens twice. The pinned PI transport already maps DeepSeek
prompt cache hits to cacheRead and subtracts them from uncached input.
The usage inspector names that input portion explicitly as uncached input;
cache-read tokens remain separately visible and the hit-rate denominator uses both.

Local cumulative token, request, compaction and deadline limits are terminal
task errors, not transient provider errors. Retry wrappers cannot spend another
provider attempt on them, even with stale HTTP 429 metadata. The transcript
directs the player to the current task workbench instead of starting a new turn
through its generic Continue action. Model context / output reservation overflow
has a separate error. Configuring cumulative limits is a player-only operation;
it does not increase the provider context window or reset charged/unknown usage.

Validation: 56 targeted runtime tests include a loopback server exercising the
actual PI serializer, native tool/reasoning continuity, DeepSeek usage parsing,
three actual PI compactions, automatic threshold compaction and terminal retries.
Loopback cache numbers are explicit fixtures. The separately gated six-request
live experiment records actual provider usage without claiming game acceptance.

Sources: [DeepSeek cache semantics](https://api-docs.deepseek.com/guides/kv_cache/)
and [usage fields](https://api-docs.deepseek.com/api/create-chat-completion/).
Caching is automatic, prefix-based and best effort; no 100% claim or unsupported
cache-control switch is introduced.
