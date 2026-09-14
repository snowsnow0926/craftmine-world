# Apply early compaction headroom to available input space

Date: 2026-09-14

Status: Accepted for the Craftmine PI request boundary.

The prior world preflight compared estimated input plus the complete output
allowance and prospective tool output against 85% of the model window. With a
500K window and 384K output allowance, this left only 38952 estimated input
tokens before compaction. The generic PI history guard separately capped its
output reserve at 25% of the window, giving contradictory thresholds.

Keep the player's configured limits and per-request output allowance. Apply the
15% early-compaction margin to the input space remaining after actual output and
tool-result reservations. Use a pure shared helper for runtime arithmetic and
frontend explanations; keep the measured, freshly enriched request in the
runtime. Preserve the existing summary generation reserve rather than increasing
it when the creation history threshold becomes smaller.

The physical reservation and final serialized-payload checks remain mandatory.
Validate output parameter paths as well as input size after prior transforms,
so a transformed request cannot silently increase or remove a reserved cap.
The pinned PI adapters use top-level OpenAI/Anthropic output fields, Google
`config.maxOutputTokens`, Bedrock `inferenceConfig.maxTokens`, and PI nested
`options.maxTokens`; do not inspect similarly named fields inside tool schemas.

This is a scoped amendment to the inline compaction budget in ADR 0064. It adds
no provider fallback, dynamic output throttling, task-wide model budget, database
schema, host authority or renderer storage ownership. Separate work addresses
task-wide request/compaction limits and UI labeling. Mocked provider tests prove
the arithmetic and PI lifecycle; only real player acceptance can establish actual
provider behavior and world outcomes.
