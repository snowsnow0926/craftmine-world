# Dispatch D ADR: instance-owned startup and extension state

Status: proposed for integration review, 2026-09-09.

## Context

The prior runtime reran `start` on restored behaviors, discarded extension state when Workers were recreated, and reset weapon cooldown on every load. An authored startup inventory award therefore repeated on reopen without an engine-enforced guard. Portable behavior binding converted object patches but not target damage or extension target arguments.

## Decision

Keep the existing engine and save formats, extending module records with optional host-managed initialization and per-instance fixed-version extension state. Recognize legacy saved modules as initialized. Preserve the marker during code/state migration and archive restore. Do not infer a new startup from a changed code hash. Persist cooldown alongside existing gameplay state.

Run fixed extension source in the behavior's authored coordinate/identity space, then translate recognized kernel effects through the explicit binding. Reject effects outside that binding and incompatible saved extension versions. Item IDs remain explicit shared dependencies rather than arbitrary source rewriting.

## Consequences

Newly authored startup effects occur once per committed instance lifetime. Updated code should use normal events for subsequent behavior; the runtime will not reissue startup rewards merely because code changed. Legacy saves cannot distinguish a never-activated module from one that already started, so preserving progress takes precedence over replaying a potentially destructive startup. Pure migrated new records explicitly retain `initialized:false` until activation.

A single behavior's ordinary command batch retains existing validation. Extension commands are still resolved sequentially; this change does not promise rollback of an earlier successfully applied extension command if a later command in the same event fails. The module stops and records its error. Fully transactional multi-extension effects require a future staging boundary coordinated with the formal world transaction.
