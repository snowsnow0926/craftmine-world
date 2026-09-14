# Exact-prefix calibration validation

Run in the isolated agent-runtime worktree, with no model or GPU:

```text
node node_modules/vitest/vitest.mjs run src/craftmine-prompt-prefix.test.ts src/craftmine-prefix-transport.test.ts src/craftmine-context.test.ts src/agent-errors.test.ts src/runtime.test.ts src/stream-publication.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

The verifier checks byte-exact native/wire prefix changes; model, task generation,
system, tools, output, effort, payload and header changes; multilingual tail JSON;
missing/inconsistent/cache usage; media and unrelated endpoints; and lost receipts.

The real pinned SDK runs against controlled fetch responses with a fake key. The
native PI loop receives a 896000-character source history, invokes an ordinary
registered tool, consumes a large tool result and finishes without ToolSearch or
compaction. Every fetch observes a completed durable reservation first. With fixed
synthetic prompt usage of 3000 uncached + 1000 cached tokens, complete input estimates
are 454412 then 556632; reservations including the 2048 tool reserve are 456460 then
109678. The second full estimate exceeds the 521859 threshold, while the proven
prefix/tail estimate fits. Both physical requests retain `max_tokens=384000` and
`reasoning_effort=max` in a 1M configured window. This is a regression fixture,
not a claim that real creation needs those exact tokens.

Change effort, final payload or headers after tentative preflight: require the
original larger reservation before fetch. Inject an oversized final payload or
mutate SDK body after onPayload: require no additional reservation/network call.
Refuse durable reserve, omit successful usage, fail a request, clear its lifecycle
epoch or cancel before delayed finalization: no usable receipt may remain and no
late request may escape. The PI-loop recovery test proves final fallback overflow
uses ordinary compaction once, with a second failure ending normally as an error.

Optional `CRAFTMINE_PREFIX_REPORT` writes the bounded synthetic native-loop report.
It excludes prompts, bodies, header values and credentials. Real-player integration
must retain actual 1M/384K/max settings and compare physical reservation records,
provider prompt usage and captured compaction trigger method, without adding task
limits or replacing interactive gameplay with a static display.

For packaged calibration attribution, filter existing timing logs for
`kind=craftmine_request_budget`. Join `requestId` to the durable reservation and
inspect `method`; `estimatedInputTokens` excludes the separately logged tool
reserve. Verify one line per successful reservation, no lines for read-only
inspection or a refused reserve, and an allowlist containing metadata/numbers
only. A reserved line does not prove a request reached the provider.
