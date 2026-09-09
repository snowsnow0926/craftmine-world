# ADR 0307: Immutable desktop verification jobs

- Status: Accepted
- Date: 2026-09-09

## Context

PI can durably edit a world draft, but a successful patch proves only compiler
acceptance. Slow browser checks must not occupy a tool call, mutate the world, or
accept evidence about another revision. A stopped process must leave an honest
record rather than an indefinitely running or falsely successful task.

## Decision

Rust stores immutable job input, host identity, revision, receipt and evidence. A
trusted plugin broker claims work with a private token and runs the shared browser
verifier in a separate offscreen, unfocusable, sandboxed Electron renderer with an
ephemeral session, no network, no Node and no input. Only compiled artifact data
crosses this boundary; authored gameplay stays in bounded Workers. The verifier
checks behavior events and the real game renderer. No second Agent loop is added.

Pending work is cancelled by edits, aborted/error turns and newer turns. Completed
turns allow submitted work to finish. On service restart, queued/running work is
marked interrupted and can be resubmitted with a new tool call. Reads expose exact
evidence and hashes; they never manufacture a pass from model prose.

## Consequences

Machine checks can finish after a short submit call and remain reviewable after a
restart. Passing is deliberately distinct from candidate approval and publication.
A later application transaction must still require review and preserve current
progress. This interface exposes no apply operation, filesystem paths, runner
tokens or result-write API to models or plugin views.
