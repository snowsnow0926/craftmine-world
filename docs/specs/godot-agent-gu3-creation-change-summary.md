# GU3 creation operation change summaries

## Existing capability and reproduced gap

The production compiler already supports bounded placement, transform/color/parameter changes, duplication, deletion, undo, environment defaults and sequence-door rules. It retains stable IDs, source/target pins, transaction identity, collision prechecks and durable receipt recovery. GU3 does not replace this working path with another authoring API.

Before this increment the returned receipt named affected IDs but gave no exact field delta, rule dependency information or explicit scope of save effects. Five tests first failed because `changeSummary` was missing. The new result explains the actual compiled change without changing any generated patch or durable receipt.

## Output contract

`creation_operation` includes `changeSummary` with format `craftmine.creation-change-summary/1`. The compiler derives it from validated before/after creation declarations. Its source identity is the input revision/manifest and runtime capture; the surrounding operation result still contains the committed output source revision. Summaries expose added/removed declarations and exact changed field values for stable entity IDs, and environment default changes.

Declared rule references identify affected entities and their rule script path. This covers only `creation.json` rule declarations; it cannot prove absence of arbitrary script references, shared material usage or runtime side effects. Runtime dependency behavior therefore stays `unknown`. The summary is advisory source evidence, never verification or permission.

The operation writes source only. It does not directly write saved progress; adoption compatibility is `not-assessed`, initialization still requires the formal application path, and formal candidate checks cannot be skipped. Recommended import/runtime/migration checks are guidance, not a second authority or cache key. This increment does not implement GU3 incremental execution caches or arbitrary exported-property editing.

## Replay and compatibility

No summary is added to the persisted receipt or operation journal. The existing 4 MiB journal capacity and exact replay payloads are preserved. On replay, validated original inverse declarations reconstruct entity changes; today's source is never used as the original before-state. Old non-invertible operations, missing or malformed inverse detail return `unknown / ORIGINAL_CHANGE_DETAILS_NOT_RECORDED` without changing successful receipt recovery. Rule dependencies were not recorded in the inverse and remain unknown on that path.

The journal is authored source. Structural checks and source hashes do not convert its content into an independent audit log; `journal-inverse` explicitly identifies this provenance. Formal identity, checks and application remain owned by their existing host/core paths.

## Verification

Tests cover exact property deltas, declared behavior dependencies, independent duplicate IDs, deletion scope, stale-source replay, unknown non-invertible replay, no-op fields, malformed optional history, service reply-loss recovery and packaged dependency loading. The existing operation, source-service, rule, guidance and plugin-loading suites remain in the regression set. No engine or model is needed to validate this source-only change, and no physical input is used.
