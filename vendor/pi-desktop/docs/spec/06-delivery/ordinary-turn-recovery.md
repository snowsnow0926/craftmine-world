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

## Finite request windows

Trusted ordinary-message recovery passes the private boolean
`renewRequestWindow` to Core. For a new interrupted-task successor only, the
head/lease transaction retains all accounting and limits and advances a finite
deadline to at least now plus 30 minutes. Null deadlines remain null; replay,
generic resume, and failed recovery cannot renew it. The previous and new limits
are recorded in a durable successor receipt. No caller-supplied timestamp is
accepted, and exhausted request/token budgets remain exhausted.

`recovery::tests` covers finite expired recovery, ownership-failure rollback,
generation checks, replay, exhausted request count, null policy, and rejected
raw intent/timestamp values. `tests/ordinary-turn-recovery-core.mjs` additionally
uses the actual private host router and standalone Core binary to prove the
ordinary message path admits a new reservation after expiry without changing
the prior count, tokens, budget owner, or limits.


## Explicit execution-limit recovery (2026-09-14)

New ordinary tasks no longer acquire cumulative request/compaction limits or a
whole-turn deadline. Existing owner policies and failure records are not silently
rewritten. The player may explicitly release exhausted local execution limits on
an interrupted current task using the bound private
`budget.releaseExecutionLimits` action. This records the previous/new limits and
exhaustion reasons, clears requests/compactions/deadline only, and preserves the
player token budget, accounting, owner, draft, and original failure. The action
does not resume or call the model; the existing continuation path follows it.

`budget.findExecutionReleaseReceipt` resolves an exact historical action after
head advancement or restart without granting new write authority. Both routes
are absent from model tools and the model budget dispatcher. See
[the policy](../player-task-execution-policy.md).
