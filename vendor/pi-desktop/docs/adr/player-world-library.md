# Player-authored templates in the existing asset catalog

Date: 2026-09-13
Status: Accepted for the authorized player workflow continuation

Player worlds previously could only reuse the four immutable published starters.
Arbitrary saved worlds need a self-service reusable representation without
restoring a whole profile or replacing another world.

Use the existing Rust-owned asset catalog for immutable whole-world ZIPs and
the existing native world initialization pipeline for creation. Add a narrow
plugin service that verifies formal source and metadata, and a host-only
materialization adapter with a fixed staging namespace. No renderer filesystem
access, general RPC route, parallel database, or direct SQLite code is added.

For this increment, the author explicitly selects saved progress as the starting
state. Fresh authored-default extraction would require running the untrusted
world in a separate broker-owned capture job; it must not be simulated by editing
known counters. Templates and their previews visibly declare their actual scope.

Catalog `kind: world` is not an installable component. Existing agent source
retrieval recognizes this distinction and refuses installation proposals. The
immutable reference can instead create an independent world; ordinary checks
and first-load confirmation remain authoritative.
