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
The raw world index is read first; only the two chosen records are enriched
with initialization status. This read disables automatic initialization resume,
so opening the cards does not build unrelated archived worlds. Explicit entry
uses the normal lifecycle to select and resume an initializing world.
This also applies when the unfinished world was already selected at shutdown;
selection alone never proves that its initializer is running after restart.
The legacy sidebar/archive list uses passive status enrichment as well. Opening
or polling a list does not resume archived initialization; explicit world open
and the selected world's runtime status retain their existing recovery path.

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
Cancel holds the same mutation lock as entry. After asynchronous cancellation,
it rechecks selection before restoring the origin; outside navigation wins.

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
