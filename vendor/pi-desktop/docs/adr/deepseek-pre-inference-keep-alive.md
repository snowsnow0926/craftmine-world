# Recognize documented pre-inference liveness before semantic output

Status: Accepted, 2026-09-15.

## Evidence

Two real preview27 Sword attempts ended with PROVIDER_IDLE_TIMEOUT after approximately two minutes, HTTP 200, no semantic generation start, no tool call and unknown usage. Their logs did not count raw SSE comments, so whether those requests received keep-alives remains unknown.

The existing boundary reset its inactivity timer only on advancing semantic PI events. The pinned PI 0.85.1/OpenAI parser intentionally discards SSE comments. A localhost HTTP fixture keeping the official model identity, 1M context, 384K output and max reasoning sent standard comments every fifty simulated seconds, then content at 150 seconds. Before the fix it produced PROVIDER_IDLE_TIMEOUT; after the fix the same single request completed and settled its actual reported usage once.

## Decision

Observe the documented keep-alive at the trusted official response-byte boundary and reset the existing watchdog before semantic generation starts. Do not manufacture a token event or loosen the request/body/ledger checks. Keep a bounded line parser, preserve bytes/cancellation and record only aggregate liveness metadata after completion.

## Consequences

Legitimate provider waiting can continue without being mislabeled as generation. A silent connection, malformed comments, replayed semantic output or stalled generation still expires. Cancellation stays immediate. The change introduces no retries, new model budget, task duration cap or provider capability. The next real package can distinguish observed heartbeat waiting from truly silent transport without retroactively reclassifying the two original failures.
