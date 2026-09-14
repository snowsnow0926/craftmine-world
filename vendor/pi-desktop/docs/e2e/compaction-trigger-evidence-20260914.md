# Compaction trigger evidence validation

Real source case: independent city profile `desktop-native-product-UNfo0G`, A2
turn `c02c7371-07b8-4339-99d4-5a15d091089f`, pre-fix package `c5203e3b`.
The actual binding is context 1000000, output 384000, max-only. Checkpoint:
`d989fee7-b468-4eba-bc81-c8b2ee2256e1`.

| Measurement | Tokens |
| --- | ---: |
| First provider-reported input including cache | 199435 |
| First physical reservation minus output/tool reserve | 485402 |
| Reconstructed history before that request | 462461 |
| Reconstructed history at compaction | 539046 |
| Boundary plus preceding request's observed overhead | 561987 |
| Configured complete-input threshold | 521859 |
| Separate PI tokensBefore | 235561 |

561987 carries prior request overhead forward; the next host snapshot was not
recorded. History alone already exceeds the threshold. Original logs and audit
files remain under ignored `test-results/a2-compaction-audit.json` and
`audit-a2-compaction.mjs`; no player profile was changed.

Build shared, then run in `packages/agent-runtime`:

```text
node node_modules/vitest/vitest.mjs run src/craftmine-context.test.ts src/runtime.test.ts src/stream-publication.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

Observed: 208 tests passed and runtime type-check passed. New native-PI-loop
fixtures reproduce complete input above 521859 while history stays below it.
Success/failure events retain the same trigger; installed checkpoint details
retain it too; a later manual event cannot inherit it. Model-requested compaction
is labeled separately even below the threshold. No real model, engine, GPU or
player input is used by these tests. Existing generic and publication tests remain.
