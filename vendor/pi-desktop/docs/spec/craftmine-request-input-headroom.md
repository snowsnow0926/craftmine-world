# Craftmine PI request input headroom

The world request boundary keeps the player's configured context window and
actual per-request output allowance unchanged. It reserves the output allowance
because input and generated output must fit the configured window. This is a
reservation, not a claim that the output has already been consumed.

For context window `W`, actual request output allowance `O`, and prospective
tool-result reserve `R`:

- Input capacity is `max(0, W - O - R)`.
- Automatic compaction begins at `floor(input capacity * 0.85)` estimated input.
- Input includes system text, model-facing messages, selected tool schemas,
  attachments, fresh host facts and serialization framing.
- Creation/retry use `R = 2048`; summary/review use zero prospective tool output.
- The shared `craftmineRequestBudget` helper is the arithmetic source of truth.

The reported `W = 500000`, `O = 384000` configuration therefore has input
capacity `113952` and a compaction threshold of `96859`, rather than the former
`38952`. The 15% margin applies to input capacity; it does not also discount a
reserved output allowance. This does not promise 400K input together with 384K
output in a 500K window. Neither the model nor the player's settings are changed.

The PI history guard is no larger than this request threshold. Its existing
summary output reserve remains separate: tightening the creation threshold must
not inflate the summary output allowance. Full host-enriched preflight remains
authoritative, including after checkpoint creation. The complete visible
transcript and durable checkpoint behavior remain unchanged.

Immediately before every physical attempt, refresh host context and measure
again. Refuse input beyond capacity before ledger reservation or provider send.
Reserve the actual output allowance in the task ledger and pass that same value
to PI's transport. After provider serialization and payload transforms, refuse
unexpected input growth or input plus reserved output beyond the model window.
For the pinned adapters' output parameter paths, refuse a removed, invalid or
increased allowance beyond the reservation, including in-place transforms.
Do not silently rely on a provider default after a transform removes its cap.

The UI's provider-reported usage and the runtime's conservative request estimate
are distinct measures. A UI explanation may use the shared capacity/threshold
arithmetic; it must not relabel the last response's reported usage as the complete
current preflight estimate. Cumulative task token consumption is not occupied
context space.

## Composer presentation

Keep the existing last-reported-request usage/window ring calculation. Its
accessible label, hover title and expanded heading identify it as last-request
window remaining; the expanded note says it is not space remaining before
compaction. Do not change the ring denominator to the input threshold.

Only the PI world-creation Agent composer may add a Current configuration
section, showing the selected model binding's per-request output reserve,
available input capacity and estimated input compaction threshold. Reuse the
shared budget helper. Show approximate rounded input values and state that these
are configuration calculations, not live occupancy; input includes system
instructions, tools and world information. Do not use cumulative tool/task usage
or an unrelated catalog output default.

Hide this section for Codex, non-world chat, Plan, missing/invalid bindings, or
when the latest usage-bearing message's provider/model differs from the currently
selected provider/model. This prevents a model change or an old Codex usage row
from attaching current PI configuration facts to unrelated usage. All shipped
locales include the `playerBudget` namespace; English and Simplified Chinese have
dedicated strings, with the existing shared-English fallback pattern elsewhere.

## Compaction trigger evidence

Craftmine PI automatic compaction events carry a bounded `trigger` diagnostic:
request-input limit, history limit, or explicit model request. History estimates
are separate from the inspected complete-request estimate, method, provider/model,
window, output/tool reserve, input capacity and compaction threshold. No prompt,
tool body or credential is included. `observedAt` is host decision time.

The same values appear on start/end events and in an installed checkpoint's
existing opaque `details`. `tokensBefore` retains its separate PI history meaning.
If history already short-circuited inspection, request measurements stay absent.
Manual/overflow operations without captured evidence cannot inherit an older
automatic trigger. Guards, physical reservations and usage accounting are unchanged.

## Exact-prefix measured input (official DeepSeek text requests)

The verified official DeepSeek completions path may use a successful physical
request's measured prompt as a conservative prefix allowance. Eligibility requires
the pinned completions adapter, an official HTTPS endpoint and the verified
`deepseek-flash` alias. Runtime callers with external fetch/payload hooks do not opt in;
summary, review, other providers, Codex and media keep the existing estimate.

Both native history and final wire messages must match every retained prefix
message by SHA-256 of its JSON. Bind the complete model configuration, task
binding/generation, output allowance, system and tool definitions. At the final
send boundary also bind every non-message payload field, target URL, HTTP method
and header digest. Differences, missing receipts, malformed usage or media revert
to the original conservative calculation. Receipts contain hashes and counts,
are in-memory only, and are cleared by cancellation, errors, compaction and stop.

The final message carries volatile host data, so exclude it from the retained
prefix. Keep the **entire** previous measured prompt count as that prefix's upper
allowance, then add the current remaining tail's conservative UTF-8/2 JSON estimate
and framing. This deliberately counts the previous host tail twice rather than
guessing its token cost. Prompt usage is uncached input + cache read + cache write
exactly once; reasoning is part of output and is not added again. All counts must
be finite nonnegative integers and sum consistently with total usage.

Preflight prediction is tentative. For eligible physical requests, prepare fresh
facts first; validate SDK output allowance and the final serialized fetch body;
then select the proven calibrated estimate or conservative fallback, check capacity,
and reserve that amount before network dispatch. Never send using a smaller earlier
reservation. If fallback exceeds capacity, clear the receipt and use PI's existing
single overflow-compaction recovery. Preserve local guard errors even when the SDK
wraps fetch exceptions as connection failures. Failed settlement releases no success
or tool-call terminal message. The configured window/output remain 1M/384K when
selected; the UI ring continues to describe last-request provider usage.

After successful durable reserve and the cancellation check, emit one existing
timing-log line with `kind=craftmine_request_budget`, `outcome=reserved`, request,
provider/model IDs, purpose, final estimate method, estimated input, output/tool
reserves, window, input capacity and threshold. This is reservation evidence,
not confirmation of provider execution or billing. Inspection, failed reserve and
pre-send cancellation emit no success line. No body, header value, credential or
host snapshot is included; the existing timing opt-out remains effective.
