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
After a cancellation failure, a fresh slot read may show that the target has
stopped initializing or is no longer selected. In that case unlock the cards
while retaining the failure explanation; do not call that proof of successful
cancellation or restoration. If the read fails or the same initialization is
still selected, retain the explicit cancellation retry. Return-to-world is only
offered for a host-reported ready active slot, never an unfinished placeholder.

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

The prepared `tests/two-player-worlds-normal-native.mjs EXTRACTED_APP_DIR` driver
creates an independent short-path profile under `D:/CMR`, uses the actual cards
and pause callbacks, and runs Web then Godot followed by save/restart and return
to Web. Web requires an attached normal plugin view and a positive-size actual
iframe canvas; Godot requires the exact formal runtime identity attached with
nonzero native bounds. Each launch permits only one initial hidden prepaint.
F2/Shift+F2 are exercised with the main animation-frame callback stalled.

Because the profile has no account and issues no model request, conversation
checks require empty target home and an authoritative null binding; they do not
manufacture a task or claim restored generated conversation history. Existing
bound-conversation and real-model acceptance remain separate. Commit and syntax
checking of this harness do not imply it has run against a final package.

When a hidden normal Windows capture cannot provide pixels, the same driver can
run `--web-visual-only` in a separate fresh offscreen profile. This mode enters
only Web, verifies the original iframe/canvas and attached view, saves a PNG and
quits. It does not run or claim normal-renderer shortcut/transition acceptance.
Its report explicitly separates offscreen visual observation from the strict
normal interaction run. No model call, physical input or window activation is
permitted in either mode.

The normal fresh-profile chain also attempts cancellation when the real Godot
preparation control becomes available. It verifies return to Web, a retained
cancelled draft and retry through the same Godot card/world identity before
continuing attachment and save/restart checks. If initialization naturally
finishes before cancellation is possible, the report records this scenario as
uncovered rather than inventing a failure or slowing product initialization.
