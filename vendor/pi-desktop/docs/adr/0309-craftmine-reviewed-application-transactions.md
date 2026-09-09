# ADR 0309: Reviewed world application transactions

Status: Accepted for downstream implementation. Date: 2026-09-09.

## Context

Desktop verification previously retained immutable builds but could only preview
them. Publishing from an old check snapshot would reset player progress, and
the next PI turn would reject its own newly applied base as a draft conflict.

## Decision

Rust owns separate review, sealed review-plan and application journals. A check
captures its host-derived request and executor model in its immutable input.
The trusted broker asks PI's existing one-shot completion service for an advisory
review and data-only assertions, seals the exact response before executing those
assertions, and stores the actual results and usage. The reviewer's design
verdict is never a hard gate. Machine assertion failures remain explicit; the
player sees both the request interpretation and advisory limitations.

Only a player panel action may request publication. The broker computes progress
migration from the latest Rust world, checks player collision against migrated
geometry, and prepares a durable application bound to its world revision, content
hash, verification and review hashes. While prepared, progress and draft writes
cannot race the transaction. A disposable native renderer must load the prepared
world, retain the player position and produce a nonblack frame before commit.
Its startup effects are discarded; only the prepared migration is published, so
the preflight cannot award items twice. Formal activation starts from that state.

One SQLite transaction updates the world, seals the application evidence, records
the consumed draft, and releases its writer lease. Original world bytes and their
hash remain in the application journal for recovery/history. Lost commit replies
are resolved through the same receipt; an applied receipt cannot publish again.
Only an exactly consumed draft permits its next turn to advance to the current
formal base. Other unfinished drafts remain intact and report base conflicts.

Startup interrupts unfinished reviews and applications. Lost reviews expire after
180 seconds, applications after 60 seconds. No automatic model replay occurs.
Private tokens, compiler artifacts, review plans and renderer evidence cannot be
supplied through the model or public panel channels.

## Implementation and validation

The first slice adds Rust journals and private RPCs. Its tests use explicit journal
fixtures and prove atomicity, replay, progress retention, stale/foreign evidence
rejection, exclusive preparation, abort/restart/timeout and consumed-base behavior.
PI completion, executable request acceptance and panel/native integration require
separate tests; these Rust fixtures do not establish those integration claims.

## Consequences

The PI Agent loop and Rust data ownership remain unchanged. Advisory usage is
recorded per review; global cross-compaction task accounting remains W3 work.
Application receipts preserve rollback inputs but do not yet expose user history
restore or the W5 backup/restore workflow.
