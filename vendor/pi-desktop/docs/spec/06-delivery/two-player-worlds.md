# Two player worlds

The default player entry offers exactly two slots: Godot 3D (`creation-sandbox`)
and Web (`craftmine-web/5`, the existing legacy runtime). Other bases remain
available only through advanced archive management. Their stored identity,
content and progress are not converted or deleted.

`world.playerWorlds` is a main-frame-only read returning slots, active kind and
active world ID. It never creates a world or starts a model. A slot contains
kind, title, nullable worldId, state (empty/initializing/ready/failed), and real
progress or failure details when available. Ready means durable playability;
the UI still awaits `world.playerEnter({kind})` before completing navigation.

Slot preferences and stable creation-operation IDs live in `player-worlds.json`
within the selected application data directory. This is an index of Core-owned
worlds, not another content/progress database. An explicit current compatible
world is preferred, or a sole compatible old world. Ambiguous old collections
are not ranked by edit time. Successful explicit advanced navigation updates
the compatible slot; unsupported old Godot bases do not change either slot.

Entry persists an operation before dispatching creation through the retained
view's normal save/create/switch lifecycle. Concurrent same-slot entry joins
that action; a different simultaneous slot is refused. Godot preparation returns
initializing and is observed until ready; retry uses that world's existing
initializer, never another world. Cancel ends only owned initialization, retains
the slot/draft and returns to the recorded original world when possible. Missing
pinned worlds and corrupt indexes require recovery, never silent replacement.

Web creation with an operationId now journals its chosen world ID before the
Core create. An identical request recovers the same durable record after a lost
reply or restart. Changed request identity, corrupt journal or unknown Core
read failures do not create another world. Legacy calls without operationId
keep their existing behavior. The helper must be present in sealed plugin
payloads. No model tool or authored game gains a slot-management method.

Targeted regressions cover two independent slots, no-write reads, old-world
selection, lost replies, cancellation/retry, save refusal, corrupted references
and concurrent entry. Final native testing must use both actual engines and
save/reopen their progress, with no OS input or player-profile mutation.
