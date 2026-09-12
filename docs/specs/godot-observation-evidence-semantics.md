# Limited observation and image evidence semantics

Guidance `creation-sandbox.authoring` 1.7.1 and the existing runtime/check tool
descriptions clarify three source-observed boundaries, without adding a tool,
protocol, runtime assertion, or write permission:

1. In the complete supported v1/v2 source groups, disabled physical collision
   does not imply disabled visual selection. Inspect one valid sample's
   `sceneObjectSelection`, actual target, refs and ancestors together. Physics
   priority can leave a usable body target even when the mesh-selection status
   is blocked. A supported mesh hit establishes only that sample's bounded base
   triangle result; it does not prove pixel/LOD accuracy or other viewpoints.
2. `runtime.frame` detail `distinct` counts the distinct PNG hashes among that
   particular probe's captures. The verifier sets it from `render.captures` and
   accepts the frame assertion based on captured frame count, allowing a static
   scene. Comparing two jobs' distinct counts is not a cross-build image
   comparison, nor evidence that the requested object appearance changed.
3. A scale parameter, root position or single ray-hit point does not provide
   object world bounds. Cross-axis reach and overlap stay unknown without actual
   geometry bounds and composed transforms. `playerBounds` describes the player.

The facts block now summarizes an available creation sample's reported selection
status/class/path and keeps the stale marker. Separate semantic notes explain
these limits. It does not manufacture bounds, set selection status, override the
sample, or turn explanatory text into runtime evidence.

## Archived counterexample

`docs/evidence/observation-semantics-20260912/adoption-report.json` is the exact
unaltered 28,247-byte original adoption/cold report for the `863622e9` player
experiment. `source-check-excerpt.json` contains only selected original model
tool arguments and receipt fields, with hashes and original report locations;
the original 3.8 MB player report, including its inaccurate final prose, was not
changed. The excerpt contains no assistant thinking transcript.

The original ordinary source patch sets instance A to `250/1/false` and leaves B
at `100/0/true`. Patch revision/manifest, passed check candidate/build, and adopted
cold build align. The after and cold observations both have a MeshInstance3D hit
whose refs/ancestors lead to A, despite its non-solid source parameter. A new cold
instance establishes that this is not only a retained transient target.

The archive itself labels visuals UNVERIFIED. It does not establish world-space
extents, cross-axis reach, physical passage, every view's selectability or a
cross-version image comparison. Physical passage is a separate integration test.
Regression tests replay the archived sample through normalization at its own
recorded timestamp solely to verify presentation; this is not a fresh live sample.
No model, engine, input or existing player profile is run by this slice.

Validation: 25 observation/guidance/archive tests and 8 cohort/packaging tests
passed. The packaging test additionally executes the 7-case cohort suite against
its fresh built plugin and asserts that all 7 ran and passed.
