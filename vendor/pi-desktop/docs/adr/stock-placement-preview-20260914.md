# ADR: Temporary stock object placement previews

Date: 2026-09-14
Status: Accepted for the scoped Craftmine extension

## Decision

Extend the existing PI Desktop direct-object editor with position and yaw controls
and a private temporary runtime operation. Source compilation, durable tasks,
undo records, checks and adoption remain the existing authorities. Extend actual
creation requirements with optional yaw rather than reporting success from the
submitted numeric value. Rotation comparison accepts the equivalent -180/180
representation and otherwise uses the same 0.005-degree tolerance in TS and Rust.

A preview is not a draft source revision. It is a temporary engine mesh tree:
stock placement invokes the same fixed generator on a detached holder; modification
copies actual selected mesh geometry. Main checks the formal stock source and
bridge pins, and the fixed runtime checks the actual loaded generator source.
No renderer-provided path, node ID, source hash, build or instance grants authority.
Opaque capture ownership plus live formal checks supply those values. No new
unrestricted engine command or database owner is introduced.

Preview requests are serial, owner-scoped and sequenced. Cancel retires an ID;
late replies cannot overwrite another preview. The runtime enforces lifecycle
clearing and bounded geometry. Keeping the original object unchanged makes cancel,
save, observation and undo independent of the temporary image. The app remains
paused after preview; it does not silently restore held player inputs.

The previous engine bridge remains an accepted exact cohort for existing worlds.
Its one-file upgrade uses normal source CAS and candidate adoption. Accepted
version-1 component packages keep their own exact source requirements; components
requiring the new bridge need independently versioned packages, not weakened pins.

## Consequences

Players can inspect placement before an expensive check and make small adjustments
without a model. Five stock objects are supported. Cyan/red ghosts convey placement
geometry and collision advice; they do not claim final material appearance. Custom
scripted components and arbitrary GLBs require a future explicit transform contract.
This does not claim isolation from hostile scripts executing in the same Godot
process, or replace the final source collision and progress-preservation checks.
