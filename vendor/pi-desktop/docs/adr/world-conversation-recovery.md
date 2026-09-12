# Recover conversations from durable world bindings

Status: accepted for the FB03 player repair.

The desktop intentionally boots without selecting a global last conversation.
That leaves a restarted immersive world's F2 surface on a fresh draft even when
a prior world conversation exists. Reusing a global last-session preference
would risk opening a conversation belonging to another world.

Add a main-frame-only `world.conversation` read using the existing real session
index and `craftmine_session_worlds` task binding through the private workbench
service. A renderer preference cannot override the durable binding. No new data
table or write authority is introduced. Existing plugin/project enablement and
normal session-selection validation remain in force.

The renderer owns whether to restore after this read and must defer to explicit
navigation and new drafts. This separates discovery from selection and allows
old profiles, including the tested preview.18 AK47 profile, to recover without
inventing a renderer index retroactively.

The observed continuation failure also exposed a navigation race: a sidebar may
highlight a pending selection before its transcript arrives. Entering play used
to call `setPage("chat")` even on chat, invalidating that pending selection. Only
actual page changes now create that navigation intent; presentation changes keep
the selection alive. A late selection preserves the world surface while using
the destination conversation's own file context.

Automatic recovery uses the same selection path with an additional asynchronous
binding guard and no optimistic transcript commit. It checks current navigation,
world, layout and the live home draft before and after host reads. New player
input or explicit navigation always takes precedence. This avoids hiding a
player's in-progress draft behind an automatically restored conversation.
