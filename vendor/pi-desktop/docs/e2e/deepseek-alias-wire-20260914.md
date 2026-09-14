# Official DeepSeek Flash alias wire check

This is a localhost transport contract test, not a real model acceptance run.
Use `node node_modules/vitest/vitest.mjs run src/deepseek-alias-wire.test.ts
src/provider-binding.test.ts src/craftmine-cache.test.ts` in `packages/agent-runtime`.
The pinned PI 0.85.1 SDK sees the official base URL and a provider UUID; a custom
fetch redirects every physical request to a loopback HTTP fixture with a fake
key. No real API secret, remote model, player profile or GPU is used.

With the same fixture before the fix, both new tests failed. Captured payloads
showed:

| Binding / selection | Before | After |
| --- | --- | --- |
| Reasoning enabled / max, no catalog map | thinking enabled, effort high | thinking enabled, effort max |
| Reasoning enabled / off | thinking disabled | thinking disabled |
| Off-only binding / off | no thinking toggle; no required empty assistant reasoning field | thinking disabled; required assistant reasoning field present |

All cases retained model ID `deepseek-flash` and max output 384000. The localhost
capture establishes that the SDK already recognizes the official URL; it does
not establish that a separate real player turn with an explicit max mapping was
downgraded. Check that turn's actual model configuration independently.

After the fix, 18 tests across the three files passed; runtime type-check passed.
The existing cache transport case also preserves actual non-empty assistant
reasoning text. Pure cases constrain the matcher to the known alias/family and
endpoint/vendor, retain explicit catalog mappings, and do not add max for a
binding that has not enabled it.

Optional `CRAFTMINE_ALIAS_WIRE_REPORT` writes only selected configuration and
captured model/thinking/output/reasoning-field facts, never request headers or
credentials. Local before/after reports were retained under this request tree's
`test-results/deepseek-alias-wire-before.json` and
`test-results/deepseek-alias-wire-after.json` for integration archival.
