# Budget receipt recovery after task-head advancement

This follow-up closes a P2 recovery gap: a player budget change can commit before its response is lost. If the player then resumes the task, its new task head previously caused the original uncertain operation to fail the current-task check forever.

The Main gateway now resolves `task.budget` through private `budget.findReceipt` before any active/current-head write checks. It supplies the original stored operation payload and operation ID together with the real Main project/session/world owner. A non-null authoritative receipt completes the existing journal record without configuring again. Only an authoritative null falls back to the existing current-head configure flow. Lookup failures are propagated; they do not authorize another write. No public channel, model tool or generic budget permission was added.

B owns the exact-scope receipt validator; G owns the real Rust/Main/PluginRuntime routes. This branch merged B `5e640f9` and G `759a095`, then built the production crate directly. Final validation uses **no router overlay**.

## Validation

- 9/9 Node host/domain tests passed: four real-filesystem journal tests, three gateway tests with explicit host fixtures, and two actual Rust process/domain integrations.
- The new real process regression reserves 150 tokens whose outcome becomes unknown, commits a player limit of 4000, drops the response, restarts Rust plus the Main journal, and resumes into a new task/generation. The old operation completes from its original receipt even while the resumed task is marked active. Configure executes exactly once; draft, binding, budget owner, reserved 150 tokens and one unknown request remain unchanged.
- Changed parameters for the same operation, foreign session/project/world, extra identity input and journal-owner conflicts are rejected. An unknown operation returns null, then its stale write is rejected by the original current-task gate.
- Desktop production TypeScript checking passed. The plugin was rebuilt against the integrated source. No UI/model/native-window/VM test was needed or claimed for this gateway-only follow-up.

Evidence: `evidence/desktop-budget-receipt-tests.txt`, `desktop-budget-receipt-typecheck.txt`, and `desktop-budget-receipt-hashes.json`. The earlier report's untested real budget endpoint and temporary recheck-router-overlay limits are superseded for these actual process integration cases. Full native/packaged desktop acceptance remains G's separate gate.
