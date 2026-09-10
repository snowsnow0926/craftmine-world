# DeepSeek V4 thinking and complete compaction summaries

For OpenAI Chat Completions, a configured DeepSeek vendor or the exact
api.deepseek.com hostname and a DeepSeek V4 flash/pro family model require the
native thinking transport capability. A user binding allowing only off must
still send thinking.type=disabled. It must not turn this explicit choice into
an absent field: the service defaults to thinking enabled. Use the pinned SDK
DeepSeek adapter, retain the exact configured model ID and endpoint, and preserve
allowed UI levels, context window, output budget, authentication and usage identity.
Do not select a response alias as another model. Other providers/protocols/models
keep their existing behavior. This is a narrow documented transport compatibility
rule, not permission to infer arbitrary custom-model capabilities.

Primary references read 2026-09-10:
- https://api-docs.deepseek.com/guides/thinking_mode/
- https://api-docs.deepseek.com/api/create-chat-completion/

These docs describe the V4 protocol family. They do not independently certify
that the temporary v4.1 model identifier is an official catalogue entry. That
exact user-configured identifier remains unchanged and requires actual response
verification after the next candidate build.

Compaction must reject length-terminated, tool-call or empty successful summaries
before creating a summary checkpoint. Provider error/abort semantics and recorded
usage stay intact. Failure can use the existing explicitly marked retained-tail
recovery, or fail closed if safe recovery is unavailable; the truncated summary
itself is never persisted as the replacement. The original durable transcript
is not rewritten.

Craftmine summary instructions focus on a concise working handoff (6000-character
target): current requirements, corrections, identity, changed/read paths, learned
behavior, unresolved errors and the next authoring step. They prohibit cumulative
copies of successful historical build artifact lists, hashes, raw logs, inventories
or snapshots. This is model guidance, not silent data truncation: original tool
outputs and identity-bound read APIs remain available. Actual error evidence and
current requirements must remain represented. Existing final payload/context gates
are unchanged; no model-request or token-total cap is introduced here.
