# Batch 07 context boundary checks

Automatic Craftmine compaction uses the complete estimated request before a new
provider call. The acceptance fixture supplies a large completed transcript and
never emits new_context. The actual PI prompt loop must request one metered
summary, persist it, and send the new request with authoritative task facts.
The old user request remains transcript history and does not reappear as a bare
new task. A failed summary keeps the original transcript, installs no checkpoint
and sends no creation request. Provider and Rust ledger are explicit fixtures
in this test; existing real three-summary native runs remain separate evidence.

An explicit native resume adds only the player's continue action to the visible
transcript and requirement journal. It must not reverse, concatenate or
re-journal projected/truncated historical requirements as a new correction.
Original requirements and chronological corrections continue to arrive through
the authoritative request hooks and requirements_read tool.

## Model-visible input accounting (2026-09-10)

The UTF-8/2 conservative estimator projects model messages to role, content (including thinking/signature and image blocks), and tool-result call identity/error flag. UI/runtime-only mirrors such as tool result details, billing usage, timestamps and transport bookkeeping are excluded. The projection only affects estimation; it does not mutate stored messages or provider input. Output allowance, image accounting, tool schemas, framing, the 85 percent compaction threshold and the final serialized-wire reservation/context gate remain enforced. Unknown wire growth fails closed before forwarding. Estimator method: utf8-half-model-content-json-framing/3.

Run `node tests/player-feedback/P8/visible-budget.mjs`: actual pinned PI conversion and OpenAI-compatible SDK, synthetic loopback relay; no external model call. A large details mirror must neither change the physical request nor exhaust context. Equally large actual content must still be rejected, and unexpected onPayload expansion must fail the final gate.
