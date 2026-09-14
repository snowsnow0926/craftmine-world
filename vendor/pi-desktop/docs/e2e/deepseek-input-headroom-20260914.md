# DeepSeek input-headroom regression

## Deterministic boundary validation

Run in the isolated request worktree with its own workspace package bindings:

1. Build `packages/shared` with `node node_modules/typescript/bin/tsc -p tsconfig.json`.
2. In `packages/shared`, run `node node_modules/vitest/vitest.mjs run src/craftmine-request-budget.test.ts`.
3. In `packages/agent-runtime`, run `node node_modules/vitest/vitest.mjs run src/craftmine-context.test.ts`.
4. Type-check the runtime with `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`.

Observed: shared tests 3 passed; request-boundary tests 53 passed; shared build
and runtime type-check passed. Provider responses are deterministic fixtures;
the PI prompt, compaction, retention and request reservation loop is real.
The existing runtime suite filtered with `-t 'compact|context|summary|checkpoint'`
also passed 31 tests; the other 107 tests were not selected, not executed.

The 500000/384000 cases retain 384000 in the outgoing options and ledger. A
100000-character history, whose complete conservative input exceeds the former
38952 threshold, proceeds without compaction. A 200000-character history reaches
the corrected input threshold, compacts once and continues; both retain the old
visible transcript entry. Genuine input/output overflow is rejected before send.
OpenAI-style output cap increases, removal, nulls and negative values after
in-place transforms are refused. The pinned Google/Bedrock/PI parameter shapes
remain accepted. Oversized transformed input remains refused by existing tests.

## Real player acceptance (integration-owned)

Use the player's supplied provider/model and actual selected configuration in an
independent background profile. Do not add task token, call-count or duration
caps, change 500K to a larger window, or lower 384K output for the test. Preserve
raw failures and actual compaction records. Confirm request cap and provider
usage independently, continue the original creation scope through ordinary
checks/application, and verify the created world visually and after reopening.
Do not infer real-world success from the deterministic fixture results above.

## Composer labeling and configuration calculation

In `apps/desktop`, run:

```text
node --test test/player-context-budget.test.mjs test/context-usage.test.mjs test/latest-turn-context.test.mjs test/transcript-style.test.mjs
```

Observed: 48 tests passed. The added tests exercise pure selection/binding gates
and actual React server rendering in Chinese and English without a browser,
window focus, Pointer Lock or simulated player input. A 15000-token reported
request in a 500000 window keeps its 97% ring. The separate configuration section
renders output reserve 384k, input capacity approximately 114k, and compaction
threshold approximately 97k, with the explicit non-live-occupancy qualifier.
Different providers/models, Codex, non-world scope, unknown usage identity and
missing/invalid bindings hide the configuration section. Catalog output metadata
does not override the actual selected binding.

The i18n package builds successfully. After building this tree's shared, runtime,
plugin-sdk and plugin-devkit dependencies, desktop type-check reports only the
two existing missing declarations for `godot-artifact-worker-protocol.mjs` and
`godot-artifact-worker-host.mjs`; no new renderer errors were reported. These
checks do not claim full desktop type-check success or visual pixel acceptance.
