# ADR 0306: Durable world drafts bound to PI sessions

Status: Accepted for downstream W2 implementation.

## Problem

The World panel's selected ID is a presentation preference. Reading that setting
for every tool could redirect an ongoing conversation into another world. A
single-instance desktop lock also does not serialize competing conversations.

## Decision

Rust owns session-to-world bindings, one write lease per world, task snapshots,
immutable draft revisions, resource-read provenance, and tool-call receipts in
the existing domain SQLite database. The first world inspection binds an unbound
session to the selected world. Subsequent inspection ignores panel selection.
PI supplies project, session and turn identity; authored arguments supply none.

A subsequent host turn forks the previous draft into a new task and records its
source. Its predecessor cannot write again. The previous task, revisions and
receipts remain available for recovery and future evidence UI. A changed formal
build rejects automatic continuation of an edited draft. Progress saves can
continue because they cannot change the build. No draft operation publishes a
formal world or replaces its progress.

The host ends turns through a private acknowledged lifecycle call. Rust records
the end even if no world tool has started yet. That tombstone rejects a late
first tool; ending a task releases its world lease without deleting its code.
Another session may then acquire the world. Failed or interrupted tasks retain
their draft for the next authorized turn. Same-call retries recover the stored
receipt; altered inputs and stale revisions fail.

The compatibility compiler remains JavaScript pure transformation code. Rust
conditionally commits its checked result. It does not construct the old writable
ProjectStore. Large immutable assets remain attached to the formal world; task
drafts retain the existing 2,000,000-byte bound and resource references.

## Scope

This slice adds draft tools, not candidate publication. World/session selection
UI, immutable verification jobs, candidate preview/apply, explicit discard,
cross-session creation reuse and crash-time lease recovery continue in W2/W3.
Visible model text is never treated as evidence of compilation or verification.
