# Two fixed player entries over retained world records

Status: accepted, 2026-09-13, following explicit player approval of the two-world
simplification plan.

The multi-base creation and mode selectors made ordinary world entry depend on
technical choices. Keep two fixed player entries while preserving existing
Core world records and archive access. Main owns slot navigation; the retained
world view continues owning live save/switch ordering, and each engine keeps
its current artifact and progress validator. The slot index contains references
and idempotent operation identities only. An unavailable reference cannot be
treated as an empty/new world.

Web and Godot share the same entry request. Web gains durable idempotent create
receipts, matching Godot's existing operation-based creation behavior. Old base
readers and asset dependencies remain until migration and usage are verified.
This avoids a destructive schema rewrite or a new parallel persistence store.
