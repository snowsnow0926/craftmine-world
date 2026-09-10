# Restricted target feedback configuration

Status: pure CP configuration declaration and source patch planner only. There
is no renderer route, model tool, live runtime mutation, or persistence service
in this change. Host integration must still use the existing source transaction,
check, candidate and application lifecycle.

## CP declaration

`content.interfaces.configuration` in the existing `craftmine.resource/1`
manifest may carry `targetFeedbackConfiguration()`. Its format is
`craftmine.interfaces.configuration/1`, contract `fp.target.feedback/1`, base
`first-person` version `0.1.0`, scope `instance`, identity field `target_id`.
The only parameter is `hitFlashMilliseconds`: integer 0 through 1000 inclusive,
default 120, Chinese label `受击闪光时长`, unit `毫秒`. Integer milliseconds keep
the existing CP integer-only canonical content hash. The adapter maps them to
the target instance's `hit_flash_seconds` numeric TSCN literal.

`validateTargetFeedbackConfiguration` accepts the exact platform declaration;
a package cannot add properties, widen bounds, change scope, or authorize an
adapter by inventing a declaration. The existing CP validator accepts the
configuration as a section object, and its ordinary resource hash covers it.
The host must additionally use this configuration validator before enabling
adjustment. No resource format or arbitrary property-write RPC is introduced.

## Pure adapter API

Module: `desktop/godot/shared/target-feedback-configuration.mjs`.

```js
const description = describeTargetFeedback({
  sceneText, scenePath, targetId,
  files, // Map<project-relative path, Buffer or UTF-8 string>; trusted source read
});
// { configuration, binding, values: { hitFlashMilliseconds } }

const patch = patchTargetFeedback({
  sceneText, scenePath, targetId, files,
  binding: description.binding,
  values: { hitFlashMilliseconds: 300 },
});
// { text, changed, previousHash, sha256, binding, values }
```

Bindings include the scene byte hash, explicit stable target ID, unique node
path, contract ID, and all consulted scene/script byte hashes. A stale or
modified binding is refused. `patch.binding` describes the resulting text.
Files are input values only: this module never reads or writes a filesystem.
The host binds world ID, formal build, source revision/manifestHash and branch
outside this pure adapter, reads the files through existing managed-source
APIs, and keeps context, source bytes and operation ownership private.

Supported targets are non-root `StaticBody3D` nodes using the exact known
TargetDummy script, or explicit instances of a non-inherited PackedScene whose
root directly uses that script. This includes the official training scene's
TargetA/B/C instances. The source script must match SHA256
`7e5edd7ccc2836472fe672b03ea47646cc1479326784e81b6398435c50771fbe`
after CRLF-to-LF conversion; the binding still hashes original bytes. Any
script edit, subclass, inherited main/template scene, root target, instance
script override, child override, nested target, expression identity, duplicate
identity/resource/property/node path, or ambiguous supported syntax is refused.
There is no fallback from missing target ID to display name or node name.

An explicit numeric override may use 0 through 1 with at most three decimal
places. Expressions, exponent notation, trailing comments on that property,
indented relevant property assignments, and sub-millisecond values are not
interpreted. The default is the known script's 120 ms, or a valid explicit
template override. Malformed input fails before any output patch is produced.

For a changed value, the planner replaces only the selected instance's property
value or inserts one line immediately after its node header. Unrelated bytes,
line endings, existing property spacing, other targets, and shared scripts and
templates are preserved. A no-op returns identical text without adding an
override. Caller maps/files are never mutated. Reset to default means passing
the declared integer 120; it does not delete identity or reset gameplay state.

## Required integration and acceptance boundary

The host must present instance scope, debounce edits, submit one source change
for one preview request, and use `godotProject.applyFiles` with existing source
CAS plus the expected original file hash. When there is an unrelated newer
draft, fail explicitly or use a separately implemented safe branch workflow;
do not silently include it in parameter application. Check jobs must finish
their owned turn before another operation starts. Candidate preview/apply,
latest formal progress preservation and cancel/restart reuse the current
coordinator. A preview never directly writes formal progress.

No max health, reward, inventory, enabled/claimed flag, input capture, script
path or other exported property is adjustable. The required checks listed in
the declaration are capabilities to implement and verify in the host; the pure
module does not claim they ran. Actual Godot hit feedback, full native progress
round trip, candidate cancellation and final restart remain integration work.

Run the offline fixture tests with:

```text
node --test tests/player-product/target-feedback-configuration.test.mjs
```

Tests cover CP canonical compatibility, official PackedScene resolution, two
same-name targets with distinct IDs, defaults/no-op, explicit overrides, bounds,
CRLF and unrelated-byte preservation, script/dependency changes, stale bindings,
expressions, duplicates and malicious unknown fields. These are pure fixture
tests and do not represent a real model, visible UI or engine run.
