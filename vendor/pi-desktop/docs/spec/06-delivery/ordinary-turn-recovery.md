# Ordinary user continuation after a stopped creation

A player can stop creation and later send another message in the same world's
conversation without manipulating task IDs or recovery panels. Main-process
binding supplies `resumeInterrupted: true` on private `turn.begin` for this
explicit new-message intent. It must not supply a reused ended turn ID, bypass
selected-world identity, or treat unrelated caller retries as this authorization.

The router keeps normal `workspace.open` first. Only its exact
`EXPLICIT_RECOVERY_REQUIRED` failure permits the tightly scoped `task.resume`
fallback. A domain `TURN_ENDED`, `WORLD_BUSY`, or other failure is never caught
as permission to clear history or manufacture a replacement owner.

Required checks are implemented by `tests/ordinary-turn-recovery-core.mjs` using
the actual private router and Rust process:

- A caller without the new flag still receives the explicit-recovery refusal.
- Different selected world and another live world lease cannot be overridden.
- Fresh user continuation keeps complete draft/world state, original requirements
  and budget usage, creates one new generation, and records the new request.
- Replaying the same successful call keeps the same task and generation.
- The original ended turn remains permanently rejected.

The script accepts a read-only profile and session ID, copies only its domain
SQLite database using online backup, and changes that independent copy. Without
a source profile it builds an authored interrupted-task fixture. Neither mode
starts a model or native engine. Actual ordinary model continuation and application
exit interruption remain separate packaged acceptance, coordinated by main.
# Request preflight after recovery

The bounded `task.context.requirements` projection includes the earliest original
request and recent corrections; it is not an exhaustive journal. A new ordinary
message after recovery is durably recorded as a new `request`. Later preflight
must not infer `correction` merely because that new request is absent from the
projection. The private router reads `task.readRequirements` for the exact id
with a one-character page to recover its original kind, verifies the returned
binding and world, and leaves full-text replay validation to Rust. Only an
explicit `REQUIREMENT_NOT_FOUND` permits a newly recorded correction. All other
errors propagate. No budget, original requirement, or draft is reset.

This failure was reproduced in the sealed `5ca080a2` native protocol run
`D:/CMR/quit-protocol-EN1r1Y/test-results/desktop-native-a/report.json`:
shutdown and partial recovery passed, but the next preflight changed the inferred
kind and failed with `REPLAY_MISMATCH` before its first provider request. The
actual Core regression additionally exercises `task.context` after `turn.begin`,
including altered-text rejection and genuinely new correction insertion.
