# A new user message may continue its own interrupted world draft

The retained player fixture for session `d48a0d61-29f6-42ff-ab64-3cb22b47fc3e`
contains a cancelled head task and preserved recovery state. An independent copy
of its database, opened through the actual packaged Core with a fresh turn ID,
rejects ordinary `workspace.open` with `EXPLICIT_RECOVERY_REQUIRED`. A new player
message therefore cannot reach the model without the technical recovery UI.

The original fixture's separate `TURN_ENDED` IPC failure is retained as a distinct
observation: its attempted turn already had an ended marker and no domain task.
This change does not remove that marker or claim to explain its event ordering.
The main process must keep abort/end events bound to their actual turn identity.

The private `turn.begin` route accepts optional boolean `resumeInterrupted`.
Only the trusted main process handling a fresh user message supplies it. It is
not a model argument or public panel operation. Omission preserves the existing
explicit-recovery guard for all other callers.

On exactly `EXPLICIT_RECOVERY_REQUIRED`, a permitted caller reads the current
session head and its durable `task.context`. World, project, session and old
task binding must agree, the target world must equal the selected world, and
the old turn must differ from the new turn. Only recovery `interrupted` and its
exact generation qualify. The existing Core `task.resume` transaction checks
the current head, generation, budget owner, base and world lease before creating
the successor. No old model request or gameplay action is replayed.

The route verifies the successor's world/owner/new turn, generation increment
and preserved budget owner before recording the new user request. Original
requirements, source history, draft, progress and accounting remain intact.
The first request text is validated before any generation mutation. Concurrent
world ownership, stale head, cross-world selection and genuinely ended new turns
still fail. A repeated successful acknowledgement keeps the same successor.
