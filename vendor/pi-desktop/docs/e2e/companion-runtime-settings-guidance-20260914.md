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

A broader exploratory run also exposed an already-stale
`observation-semantics.test.mjs` assertion expecting skill 1.7.1 and older literal
wording; the pre-change HEAD already had skill 1.8.1 without that wording. That
test is left unchanged and its failure logs retained. Do not report the whole
guidance directory as passing based on the targeted commands above.
