# ADR fragment (task A / godot-remaining-20260910): durable Godot job lifecycle

Status: accepted for the core contract; worker delivery still requires real
native execution and runtime validation. This is a fragment for the main task to
number and merge into the ADR index.

## Context

Build and check jobs are the only path from authored source to an appliable
candidate. Before this change a dead worker lease left a job `claimed` until some
later call happened to expire it, the reason for an ended job was not recorded,
interrupted jobs had no recorded origin when a saved draft was retried, and no
per-execution accounting existed. Revocation of one worker could also leave a
capable worker masked by an earlier, less capable registration.

## Decision

1. Every path that ends a job records `interruptReason` (`GODOT_LEASE_EXPIRED`,
   `GODOT_QUEUE_TIMEOUT`, `GODOT_EXECUTOR_REVOKED`, `GODOT_HOST_RESTART`,
   `GODOT_CANCELLED_BY_USER` or a validated caller reason). Cancellation is
   terminal and idempotent; a late result is refused, never applied.
2. Capability is resolved per requested kind across all live executors, so a
   capable worker is never hidden by an incapable registration.
3. A saved draft is continued by creating a new execution bound to the current
   task that records `originJobId` and reuses the origin's immutable build copy.
   A moved source head or a formal world that no longer descends from the draft's
   base is a conflict, never a silent rebase.
4. Each terminal execution is accounted exactly once from durable rows.
   Model-side counters are not observable in the core and stay `unknown` rather
   than being reported as zero.

## Consequences

- The UI can explain why a job ended and no longer offers a "resume" that fails
  immediately; recovery is an explicit new execution.
- Cumulative usage spans a continuation chain without inventing token or request
  numbers the core cannot measure.
- Accounting, reasons and origin links are additive columns/tables; existing
  applied builds and their artifact identities are unchanged.
- The host still owns real isolation evidence, and application remains a separate
  player-driven transaction with a verified new-instance launch.
