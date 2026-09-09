# ADR 0316: Bind the Godot native world host to Rust formal artifacts and receipts

Status: Accepted for Cycle 5 formal runtime integration
Date: 2026-09-09

## Context

The previous native host could render a real Web export but its persistence and
artifact resolution callbacks were acceptance fixtures. A game confirmation did
not prove durable progress, and source-authored engine paths could not authorize
serving. Managed bases now expose complete versioned state and exact snapshot
text receipts; Rust owns formal applied artifacts and full-state transactions.

## Decision

Keep the native host as the lifecycle owner and add a private adapter around
Rust `godotRuntime.describe` and `godotRuntime.saveProgress`. Accept only formal
applied descriptors and instance-bound durable receipts. Pin the declared
artifacts on every HTTP response, serve the verified bytes, and carry complete
state with separate state/wire limits. Integrate this adapter into Electron main
and authenticated panel actions; no model tool gains a path or execution API.

Suspend selection polling through explicit world-open coordination. Checkpoint
before leaving, resume the old instance on save/start failure, and restore from
its real durable state on selection failure after replacement. If that recovery
also fails or selection is uncertain, hide/pause the view and expose a combined
failure. Preserve this limitation rather than claiming atomic selection/native
view replacement. A future two-phase native switch can retain the old instance
until selection commit if a broader transaction proves necessary.

## Consequences

An unchanged state may return the same revision. Uncertain writes are recovered
only from an exact Rust state read, never replayed or guessed. Startup and save
can now fail explicitly when a formal artifact or receipt is invalid. Runtime
state remains independent of the UI's selected world. Existing legacy world
persistence and candidate application are separate contracts.

Tests distinguish pure lifecycle seams, actual Rust, actual fixed-base Web
execution and actual product wiring. Environment-variable separation and Electron
Web isolation do not authorize untrusted native Godot import/export; OS sandbox
and redistribution gates remain outstanding. See
`docs/spec/godot-formal-runtime-host.md` for the full contract and test entries.
