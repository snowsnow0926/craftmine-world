# Append player feedback without rewriting original evidence

Date: 2026-09-10. Extends the local issue records ADR.

Keep original issue records immutable. Store bounded supplements and retest
state as a separately validated append-only array in the same atomic ledger.
Read legacy ledgers without writing; upgrade the container to v2 only when a
real mutation succeeds. Reuse existing private file handling and receipts, and
reserve deletion capacity when followups consume receipt slots.

Expose only finite prepare/append operations through the existing notebook
gateway. Preparation returns a digest of Main's current formal runtime context
and the issue revision. Append checks both before recording a separately
timestamped context. The digest is a stale-view guard, not authority to supply a
context. Check existing receipts first so a committed reply lost before a
restart can be resolved without rebinding to a newer world/build instance.

Player-resolved means a player's explicit retest statement. It does not alter
the original reproduction field, create a repair candidate, claim an automated
test, upload evidence, or affect world/content/progress. No general update,
filesystem, snapshot or model interface is added. Complete client acceptance
must separately prove live context binding; DOM fixtures alone cannot do so.
