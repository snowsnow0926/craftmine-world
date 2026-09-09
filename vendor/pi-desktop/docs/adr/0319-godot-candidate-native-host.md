# ADR 0318: Retain the formal native instance until candidate commit confirmation

Status: Accepted for Cycle 6 candidate coordination
Date: 2026-09-10

## Context

The formal host can read trusted Rust artifacts and persist complete native
state. Applying a candidate by replacing the old native instance before core
commit would lose its in-memory state on failure. Reusing a played preview as
the applied instance would also leak preview modifications into formal progress.

## Decision

Stage one separate candidate within the existing host, with its own transport,
origin/session and detached native view. Keep the old formal instance paused and
alive. Preview confirms a durable-state copy but never invokes formal storage.
Apply discards that preview, saves the latest formal state, prepares a new core
transaction, loads a fresh paused candidate and validates an exact runner
receipt before committing. Promote only after reading matching applied evidence
and the new formal descriptor. Preserve the existing Rust application token and
record protocol; expose only candidate ids/actions to the panel.

Treat a lost commit response as an uncertain result, not a reason to repeat the
mutation. Retain both instances and ownership until a read proves applied or
aborted. Readback verifies original input and full observed output/instance.
Unknown or foreign outcomes cannot authorize promotion. Abort and restart use
the existing core recovery rules.

A pending startup must be abortable and diagnosable: a main-frame load failure or
a renderer crash rejects the readiness wait immediately, and the host retains a
bounded renderer-console/fault/request tail as evidence instead of reporting a
bare timeout. The first instance of a world that has no formal build is staged and
promoted through the same pending-instance path with an explicit first-load
confirmation, so creation never depends on a formal world it cannot yet have.

## Consequences

The same-instance old world survives candidate startup and pre-commit failures.
Preview changes are discarded; only current formal play progress carries across.
A prepared preview temporarily locks formal writes and is bounded by the core
application lifetime. The first Godot world still requires its separate bootstrap
path. Valid native confirmation and a valid production executor attestation are
different claims; the host never fabricates the latter. Post-commit renderer
failure cannot pretend that Rust rolled the build back.

See `docs/spec/godot-candidate-native-host.md` and CRAFTMINE-GODOT-REMAINING-D-01
for the contract and verification boundaries.
