# Two fixed player world slots

The default entry offers Godot 3D and Web, backed by host-owned world slots.
It does not offer workbench mode, dialogue-only creation, base/template choices,
project directories or model selection. A fresh or previously saved workbench
profile sees the cards; an existing play profile can resume. Each card calls
`world.playerEnter({kind})`; listing slots must not create worlds or model turns.

`world.playerWorlds` returns two slots with kind, nullable worldId, title and
state (`empty`, `initializing`, `failed`, `ready`), plus activeKind/activeWorldId.
Optional numeric progress comes from the host. The renderer never classifies an
old project by title or coerces an incompatible base into a slot. A legacy active
world is explicitly identified as accessible through advanced save management.

An initializing entry receipt keeps the cards visible and polls the slot read.
After durable readiness, call enter again and await its navigation transaction;
only an exact matching ready receipt and selected slot may change presentation
to play. A failed entry leaves retry available and never invents a ready state.
Cancellation becomes available only after an initializing receipt. Await
`world.playerCancel({kind})` before unlocking the cards. Unconfirmed cancellation
keeps its retry control visible; cancellation preserves the registered world.

Switching slots is explicit conversation navigation. Capture the prior live
draft and navigation intent before entering. If typing or session navigation
changes meanwhile, retain it and keep the cards visible instead of silently
replacing that input. On a successful handoff, retain a current session only if
the authoritative world-conversation binding matches. Otherwise preserve its
draft and file context and move to target-world home, then restore only a real
bound target conversation. An existing home draft wins over automatic history
restoration. No session is created and no draft is submitted by entry itself.
The same rules apply to Web and Godot.

Pause offers Switch world, Settings, Resume and Save and exit. Switch world opens
the same two cards without switching to a workbench. F2/Shift+F2 remain the world
conversation controls. The default navigation hides generic world creation/copy
and technical tools behind advanced surfaces. Settings General retains Advanced
save management with old projects, failed drafts, their existing recovery actions
and copying. No archived source or save is deleted or converted by this UI change.

Validation uses the actual React entry, production session store and draft cache
with controlled host slot receipts: both directions, delayed preparation, second
entry confirmation, failures, cancellation, mismatched identity, typed-text races,
home attachments, old conversation isolation and legacy presentation. Separate
native package acceptance must prove both real renderers enter, save and reopen.
