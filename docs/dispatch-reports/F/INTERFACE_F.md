# F native acceptance interface

The F helper is an opt-in fixed test controller. It does not expose arbitrary JavaScript or host RPC. `installNativeAgentAcceptance(access)` must be called only after `configureHeadlessAcceptance()` has installed the production offscreen, profile, pointer-lock, dialog, window and input guards. `access.enabled` is the resulting profile's presence. `CRAFTMINE_F_AGENT=1` and a parent IPC channel are also required.

Integrate `integration.patch` in the shared Electron main entry point. Its SHA256 is `35f5f589f8aa4f78f17a59471ab477368bb03e0c68beaa8d74bf21e280cbaaf5`. The tested temporary full `index.ts` overlay SHA256 was `98e166afdaf6eedafe420b1c5b04c4ea44064e05850284490d50a7ed723f8d14`.

Parent messages are exactly `{type:'craftmine-acceptance-f',id,method}`. Extra fields are rejected. Supported methods:

- `initialize`: creates a real PI host session and configures the authorized DeepSeek provider inside the isolated profile. Uses the actual selected blank world. Returns only session/world/model IDs.
- `prompt`: once only; sends a fixed task through the actual renderer `piDesktop.invoke(agentPrompt, request)`. The production handler creates and binds the durable turn, appends the user message, and launches the real pi Agent. No helper-authored draft or manually fabricated turn is used.
- `snapshot`: reads the real session transcript/checkpoints, active-turn status and world verification records.
- `apply`: previews the current passed check and waits for actual review acceptance; submits the real player's apply form with DOM `requestSubmit`. No mouse/keyboard/click simulation.
- `abort`: invokes the production renderer stop channel for the bound session.

The helper reads `CRAFTMINE_F_MODEL`, `CRAFTMINE_F_KEY`, `CRAFTMINE_F_THINKING` only inside the isolated child. The parent uses the existing authorized configuration loader; keys are never command arguments or report fields. `CRAFTMINE_F_COMPACTIONS` selects fixed `0` or `3` scenarios. The three-compaction task invokes PI's actual `new_context` between four durable edits, retaining one session/turn/task.

From the F worktree, prepare the plugin with `node desktop/prepare-client.mjs`, build `pnpm --dir vendor/pi-desktop build:js`, and provide explicit `CRAFTMINE_CORE_BIN`/`PI_DESKTOP_HOST_BIN` or copied binaries under `test-results/dispatch-f/bin/`. Run `node tests/dispatch/f/native-agent.mjs` with `CRAFTMINE_LIVE_CONFIG` pointing to the previously authorized local configuration. The runner checks compiled isolation markers before launch and creates its own strict `test-results/desktop-native-f-*` profile. It has a 20-minute deadline and an 80-request inspection cap; the production ledger also enforces its own limits. All processes are stopped in `finally`.

Run `node tests/dispatch/f/audit-native.mjs <evidence-directory>` after completion for an independent, read-only SQLite/transcript audit of final geometry, original requirements, task binding, real summary checkpoints, cumulative usage, intermediate revisions, receipts, application and zero-input exit audit. Its result is distinct from the runner result.

The first released helper does not claim cross-session library reuse, crash recovery, packaged delivery, visible-window composition, or clean-Windows installation. Those scenarios remain explicit matrix entries pending integrated dependencies.
