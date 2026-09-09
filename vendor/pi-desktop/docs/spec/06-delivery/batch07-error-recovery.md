# Host error lifecycle and explicit task recovery

A running current Craftmine task ended by the host with `error` or `aborted` must atomically become cancelled and interrupted, relinquish its writer lease and revoke its pending checks/reviews/applications. The first durable host end result wins repeated delivery. Completion does not become an interruption through a later error callback.

The ended draft, requirements and budget owner remain intact. Pending reservations can still receive a legitimate host settlement. Broker startup marks any unanswered reservations unknown, retaining their charge. New ordinary turns cannot bypass interrupted task recovery; only explicit player resume/discard resolves it. No provider request is replayed automatically.

Legacy repair at startup requires a cancelled current head, recovery none and a matching persisted error/aborted end row for that exact session/turn. Old heads, discarded/completed tasks and rows without ended-turn proof must not become recoverable. Repair itself never launches the model and is idempotent.

Acceptance: finite budget exhaustion followed by the real endTurn error endpoint, process restart, player removal of the cumulative limit, then gateway resume retains actual/unknown accounting and the draft/goal on the same budget owner. Tests must not prepare this state using manual task.interrupt. Include legacy positive and negative rows and first-end-result replay tests.
