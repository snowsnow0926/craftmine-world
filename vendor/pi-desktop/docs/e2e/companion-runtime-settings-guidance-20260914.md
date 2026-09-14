# Companion runtime settings guidance regression

The real A1 world persisted `settings.following=false` after F, while its generated
HUD read the exported `following=true` default. Repeated F could therefore keep
calling `set_following(false)`. This guidance correction does not repair that
world; the integration test uses ordinary player feedback for the Agent's repair.

Validation uses no model, Blender/Godot process, GPU or live player input:

```text
node --test tests/approved-pomeranian-package.test.mjs tests/creation-guidance/guidance.test.mjs
node --test tests/creation-guidance/current-cohorts.test.mjs tests/creation-guidance/engine-cohorts.test.mjs tests/creation-guidance/retained-monitor.test.mjs tests/creation-guidance/packaging.test.mjs
```

Observed: 13 tests in the first command and 20 in the second passed. The added
lightweight contract case rebuilds the released v2 ZIP in memory and matches its
existing composition-pin archive SHA-256
`2c9c38faca756f6be9cdd787f8565243571ca736308706405710a5aa7225068a`
and root content hash. It reads the actual package's `companion.gd`, checks its
export/default initialization, setter and snapshot fields, and checks that the
new guidance anchor/example uses those public methods instead of the export.
The example is source-contract checked; it is not claimed as a newly executed
Godot gameplay test.

The broker/pagination, source-cohort, retained-monitor and packaged-guidance cases
confirm the new guidance text/hash is delivered without changing reviewed source
interface or archived-reference hashes. Catalog 1.8.4 / skill 1.8.2 text hash is
`df5c0dc2fd94a1c2727232c3dff6ff3ac48e505816b94f8e6330e94e715031aa`.

A broader initial exploratory run also exposed an already-stale
`observation-semantics.test.mjs` assertion expecting skill 1.7.1 and older literal
wording; the pre-change HEAD already had skill 1.8.1 without that wording. That
test was left unchanged in the companion-guidance-only change and its failure
logs are retained.

## Follow-up: align the observation contract assertions

The subsequent test-only follow-up aligns the last observation test with the
actual 1.8.2 guide and current advertised tools. The four preceding archived
source/adoption, visual-selection, live-presentation and one-probe verifier tests
are unchanged. They still check sceneObjectRefs, collision-disabled versus
visually selectable, player versus object bounds, and within-probe frame counts
without claiming cross-build visual proof.

The guidance check now requires the current separate statements about rendering
versus picker coverage, fallback not implying invisibility, rejecting collision
boxes as exact visible geometry, and generic checks not proving arbitrary player
requirements. It also checks capsule-center versus foot-position wording and the
actual read-only build/live scope schema, host-owned sample identity, freshness,
no saved-progress substitution and candidate-only check evidence. No assertion
of a runtime evidence boundary is removed to make a failure pass.

The unchanged pre-fix test was run and recorded as 4 passed / 1 failed in
`test-results/observation-semantics-before.log`; the aligned test passed all 5 in
`observation-semantics-after.log`. All six non-engine guidance test files plus
the approved-pomeranian package contract passed 38 tests in
`observation-semantics-guidance-suite.log`. The engine-running
`rule-headless.test.mjs` was intentionally not run: this follow-up changes only
test expectations/documentation, and starts no model, engine, GPU or player
profile. Existing guideline and published component bytes remain unchanged.
