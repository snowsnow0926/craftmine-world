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

Validation includes the service's identity and asynchronous refusal cases, plus
a copied real AK47 profile through the actual PluginRuntime gate, private router,
workbench and Rust domain. The world record stays unchanged. Native replay of F2
after restart and ordinary follow-up submission remain distinct acceptance steps.
