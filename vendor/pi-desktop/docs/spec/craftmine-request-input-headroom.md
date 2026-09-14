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
