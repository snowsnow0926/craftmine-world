# Bound world conversation recovery

The main renderer may request `world.conversation` with `worldId` and an optional
preferred `sessionId`. This additive private navigation read never creates a
session, starts a turn, replays a message, or patches a world. Only the current
main frame can call it. Every asynchronous boundary rechecks the selected world.

The preferred session is only a hint. Read real desktop sessions, prioritize the
hint and then update time, and query the existing workbench `task.current` for
each enabled project. The durable session-world head task must agree on world,
project and session. Initializer and maintenance synthetic sessions are not
desktop conversations. Deleted, unbound, disabled or reassigned sessions cannot
restore; a stale hint may resolve to a newer valid conversation for this world.
Return only `worldId`, `sessionId` (or null), and the validated task identity.
No transcript or draft is included in this lookup.

Restoring the returned session is a separate normal renderer navigation. It must
respect a newer selection, a world change, and any new user input. A pure layout
switch while already on chat must not invalidate an in-flight session selection.

Opening F2 in an idle immersive home looks up that world's existing conversation.
The composer stays usable while the lookup and transcript load are pending. A
new text draft, attachment, New Task action, explicit history selection, page
navigation or world change wins over the delayed recovery. Warm transcript
caches cannot optimistically commit a recovered session before those checks.
The binding is revalidated after loading and workspace alignment, before the
normal selection commits. No new session or model prompt is submitted.

A bounded local world-to-session preference is written only after the host
verifies the binding; it is never a global last-session fallback. Returning from
history to play preserves the selection navigation intent. If that selection
finishes after the mode transition, retain the shared world tab alongside the
destination conversation's own files, without inheriting the previous session's
file tabs or file request. Existing drafts are not cleared or moved by recovery.

Validation includes the service's identity and asynchronous refusal cases, plus
a copied real AK47 profile through the actual PluginRuntime gate, private router,
workbench and Rust domain. The world record stays unchanged. Native replay of F2
after restart and ordinary follow-up submission remain distinct acceptance steps.

Renderer regressions use the actual React layout controls, selection store and
recovery hook with delayed API receipts. They reproduce the old same-chat
navigation cancellation and cover cross-page cancellation, destination file
isolation, cached transcripts, live DOM draft text, attachments and explicit
navigation while recovery is pending. They do not prove a physical F2 press or
new-package model continuation; those require separate final artifact evidence.
