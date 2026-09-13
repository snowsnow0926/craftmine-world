# Persist player world goals outside individual authoring turns

## Context

The existing task journal preserves exact current requirements and recovery
history. Subsequent independent turns did not project a small player-owned world
brief. Model summaries and successful build checks cannot establish that every
original gameplay goal remains complete after later changes.

## Decision

Rust owns additive world brief, idempotent operation and advisory proposal
tables. The main-window product route is the only writer of accepted player
goals/reviews. A model can read the current world's original requests or propose
new goals through the registered domain tool, but cannot approve its own work.
Human reviews bind a goal to a formal build ID and become historical on version
changes. Job status is shown separately with its actual build identity.

The existing request context includes bounded world-specific excerpts and
full-text read locators. The ordinary Agent continues to interpret the user's
wish and execute source tools. No keyword interpreter, new turn budget or
automatic background authoring is introduced. The current player's explicit
correction supersedes historical preference data.

## Consequences

Goal continuity and source/progress mutation remain separate. Side-panel edits
use optimistic revision checking and original operation receipts. Native checks,
model statements and human acceptance have distinct meanings. Future sharing
of authoring notes would need an explicit product choice; current world-template
export carries no private goals or historical conversations by default.
