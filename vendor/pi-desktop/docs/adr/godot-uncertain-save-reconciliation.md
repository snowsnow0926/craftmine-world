# Recover a later save after an uncertain committed snapshot

## Problem

A native runner can confirm a save at world revision 8, and Rust can commit it
as revision 9, while the transport loses the reply. The first reconciliation
read can also fail. The host correctly keeps revision 8 because it has no
durable receipt. After the player continues, however, every later save at
revision 8 receives `WORLD_REVISION_CONFLICT`; the old adapter rejected that
typed error without reconciling the earlier uncertain write. Checkpoint and
quit therefore remain blocked even after storage connectivity recovers.

The original reconciliation also depended on the complete runnable artifact
descriptor. A missing or corrupt rebuildable Web artifact could hide an otherwise
valid, already persisted world snapshot from save acknowledgement.

## Decision

The private runtime adapter retains at most eight uncertain save inputs in
memory, keyed by exact world, build and runner instance. Each record includes
the submitted revision and a separate copy of the complete snapshot. It creates
no scheduled write, persistent journal, permission or background retry.

An uncertain reply is reconciled using the real Core `world.read` record:
matching world/build, valid durable revision/content hash, complete snapshot
equality and the same current runner instance. It does not require a runnable
Web export. A recovered receipt acknowledges the actual current runner's
confirmed snapshot; it never substitutes a different snapshot or build.

If a later explicit save encounters `WORLD_REVISION_CONFLICT`, only a matching
earlier uncertain save from that same instance permits recovery. The adapter
reads the current durable state and requires exact equality with the remembered
earlier snapshot. If the new snapshot is already identical, it returns the
existing durable fact. Otherwise it makes one attempt to save the *new* snapshot
using the proven revision. Core's normal revision, build, application, archive
and snapshot checks remain unchanged. It never replays the old uncertain write
or retries a newly conflicting revision indefinitely.

## Refusal and lifecycle

A different saved value, foreign build, replaced runner, unavailable read,
unrelated typed error or absence of the earlier uncertain input cannot justify
a rebase. A new conflict still fails. Successful confirmation clears the pending
record. Restart naturally loads the current durable revision through the normal
world-opening path; this in-memory evidence is not imported across processes.

The reported durable save remains distinct from renderer acknowledgement and
from a successful engine restart. Existing load/artifact validation is retained.
This decision does not relax collision checks, discard authored content, or
claim that a merely compiled candidate is a playable saved world.
