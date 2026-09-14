# Retry owned presentation intents after a candidate transaction

Status: Accepted, 2026-09-15.

## Evidence and decision

The released preview26 panel retained GODOT_CANDIDATE_ACTIVE after automatic adoption had already committed. A later ordinary world-tab operation failed on that banner, while independent observation, movement and save confirmed a healthy applied world. Readiness notification can precede candidate gate release; fire-and-forget surface/resume calls previously displayed the transient refusal permanently.

Keep a small renderer-local latest-intent queue for those two existing presentation RPCs. Drain each physical call before starting another, retry only the exact candidate-busy response, and discard callbacks whose world or page generation no longer owns the intent. A positive host acknowledgement clears only an error owned by that presentation path.

## Consequences

No new IPC, permissions, candidate transitions, hidden recovery, or persistence behavior is introduced. Real errors remain visible. Retries stop when the owning intent is superseded or invalidated; a manual preview cannot be closed by the queue. A bounded timer avoids busy-looping while the original host guard remains authoritative.
