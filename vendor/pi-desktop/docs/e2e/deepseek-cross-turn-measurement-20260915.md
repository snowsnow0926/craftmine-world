# Cross-turn measured-prefix validation

Run the pinned-SDK transport tests across two successive actual native PI prompt calls. The second prompt uses a new turn/task/baseBuild but the same authorized session/world and exact request prefix. Require no spurious compaction, a measured-prefix reservation, and the new complete task binding on reserve and settle. Refuse delayed cancellation without a second fetch. Existing output/window, media, changed-body, unknown-usage, scope and lifecycle tests remain required.

Cross-turn negative cases include a different project/session/world/base/generation, revoked/missing/superseded capture, world-policy authorization, legacy runtime, changed system/tool definitions, modified old message, media and final effort/options. They must use the complete fallback or reject before dispatch; no old task authorization can be reused.

Optional offline reconstruction:

    node tests/replay-cross-turn-prefix.mjs <archived-NUWiAc-output> <report-path>

Build this worktree's shared and agent-runtime TypeScript first. The script reads the retained transcript, historical task bindings and capture metadata, uses a fake-key adapter with no network, and outputs only counts/hashes. The original final provider body and per-request host data were not recorded. Minimal host metadata placeholders are therefore explicitly used in the same request for both estimates. It also uses the current Craftmine system prompt and core manifest schemas, not a recorded original complete base prompt/tool catalog. This is not a byte-identical original replay or API acceptance claim.

Observed reconstruction: 76→78 native messages; previous actual prompt 299425; the same reconstructed next request estimates 551029 before and 316842 after. The original production trigger was separately 557257. All three remain labeled estimates where appropriate. Output remains 384000 in a 1M configuration.

Next real-package acceptance needs only two ordinary short tasks in one world with unchanged selected model, effort and permission. Inspect the first new-turn request's existing craftmine_request_budget method and join its requestId to its own current task reservation. Do not send a giant request just to claim the original estimated token count was accepted; preserve real task outcomes and any actual fallback.
