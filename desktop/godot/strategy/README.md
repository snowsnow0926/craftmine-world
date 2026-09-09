# L4 creation-strategy experiments (Godot path)

Base/version-keyed retrieval, tool selection and an A/B runner for L4 strategy
comparisons. The layer is pure metadata and pure functions: it never calls a
model, never runs a world, and never grades itself.

## Why it exists

`GD8` requires "the same task set, two strategies, one honest comparison". That
needs three things that did not exist yet:

1. a retrieval index that refuses entries which are incompatible with the
   running engine/base/state format, or that only exist as a pointer;
2. a tool-selection function with an explicit *old* arm and a *new* arm that
   differ only in strategy, not in inputs;
3. a runner that blocks instead of inventing numbers when the task set is not
   frozen or no real attempt adapter is attached.

## Modules

| File | Purpose |
| --- | --- |
| `formats.mjs` | Record formats, evidence classes, median/p95 helpers |
| `retrieval.mjs` | `createRetrievalIndex` + `query({baseId, baseVersion, stateFormat, engineVersion, tags})`, returns items **and** the reason every other entry was excluded |
| `tool-selection.mjs` | `selectTools({task, catalog, context, memory, arm})`, arms `baseline` and `candidate`, plus `compareArms` for a same-input diff |
| `experiment.mjs` | `validateTaskSet`, `runExperiment`, `writeRunRecord`, `compareRuns` |
| `index.mjs` | Public surface |

## Retrieval contract (shared with the version-management and asset-library plans)

An entry carries a content reference with `contentId`, `contentVersion`,
`contentHash`, `baseId`, `baseVersion`, `stateFormat`, `engineVersion`
(`desktop/godot/extensions/content-ref.mjs`). A query returns an entry only when
the reference resolves to that exact hash right now. Otherwise the entry is
reported under `excluded` with `unresolved-content`, `engine-mismatch`,
`base-mismatch`, `state-format-mismatch`, `base-version-incompatible` or
`tag-miss`.

`query({ allowUnverified: true })` is the single documented escape hatch: with no
resolver attached it returns entries marked `verified: false` instead of
excluding them. It exists for offline index preparation only and must not be used
when feeding a real creation task.

## Experiment contract

```js
const run = await runExperiment({
  taskSet,                       // frozen by the acceptance owner, with scoringContract
  evidence: 'real-model',        // or 'engine-headless' / 'fixture' / 'logic-only'
  runAttempt: async ({ task, arm, attempt }) => ({ success, repairs, humanInterventions, tokens, cacheHits, durationMs }),
});
```

* No `runAttempt` → `status: 'blocked'`, `reason: 'no-attempt-adapter'`.
* `frozen !== true` → `status: 'blocked'`, `reason: 'evaluation-set-not-frozen'`.
* Failures stay in the denominator; a rate is only reported when every task was
  actually attempted, otherwise `rateStatus: 'unknown'` and `completionRate: null`.
* `compareRuns` refuses across different task-set digests, refuses across
  different evidence classes, and will not call a sample smaller than
  `MIN_FROZEN_TASKS` (10) an improvement.
* A verdict of `improved` requires no task-level regression, no regression flag
  and at least one strict improvement.

## What this layer deliberately does not do

* It does not change prompts, permissions, pass conditions or the frozen set.
* It does not implement its own model loop or world database; the attempt
  adapter is injected by the tool/context owner.
* It does not treat a cache hit as proof that a later call will also be cheap;
  cached tokens are reported separately from input/output tokens.
