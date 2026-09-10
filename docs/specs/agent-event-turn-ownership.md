# Agent event turn ownership

Root sidecar terminal events and usage affect a live desktop turn only when the
envelope has its exact current turn ID and no parent tool-call ID. Missing or old
IDs never borrow the current turn. Delegate model-call facts remain separately
attributed by their original root turn ID; this rule does not exclude them from
the task metrics recorder.

Assistant rows retain the envelope's original turn ID, including late rows.
Only the current root reply may replace the session's inflight checkpoint.
`finishTurn` verifies an event's expected turn before joining an existing
finalization. Its normal desktop stop and maintenance callers retain their
existing behavior when no expected identity is supplied.

The existing regenerate-revision archive runs before releasing the completed
turn and its finalization gate. Its bounded outbox flush and existing error
handling remain unchanged. A following prompt cannot enter while this
session-scoped archive is pending; duplicate terminal events join the same
finalization and do not start a second archive.

Validation: `tests/player-feedback/agent-event-turn-ownership.mjs` transpiles and
executes the actual Main functions with finite dependency doubles. It checks late
errors/end events, delegate terminal events, original row identity, inflight and
usage isolation, valid root completion/error, expected-ID revalidation, and a
blocked archive followed by the next turn. These are Main lifecycle regressions,
not real model, Electron, or native Godot acceptance.
