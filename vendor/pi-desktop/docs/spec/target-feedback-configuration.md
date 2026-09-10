# Restricted target feedback configuration

This document specifies the pure CP configuration declaration and source patch
planner. The private host integration is in `target-feedback-service.md` and
uses the existing source transaction, check, candidate and application lifecycle.

## CP declaration

`content.interfaces.configuration` in the existing `craftmine.resource/1`
manifest may carry `targetFeedbackConfiguration()`. Its format is
`craftmine.interfaces.configuration/1`, contract `fp.target.feedback/1`, base
`first-person` version `0.1.0`, scope `instance`, identity field `target_id`.
The only parameter is `hitFlashMilliseconds`: integer 1 through 1000 inclusive,
default 120, Chinese label `受击闪光时长`, unit `毫秒`. Integer milliseconds keep
the existing CP integer-only canonical content hash. The adapter maps them to
the target instance's `hit_flash_seconds` numeric TSCN literal.

Zero is deliberately refused for base 0.1.0: its target script swaps
the hit material but skips restoration when the remaining duration starts at
zero. The separate explicit-override compatibility fix does not change this
zero-duration behavior.
Existing zero overrides are reported unsupported rather than described as a
working parameter. New overrides are appended after script binding in the node
block; a target ID or override serialized before `script` is refused because
Godot resets exported values when it attaches the script.

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
`1ffc6e5419aaf8bc9d901a9671942472fdee86f97bdca069d6c33afb199d5ff3`
after CRLF-to-LF conversion; the binding still hashes original bytes. Any
script edit, subclass, inherited main/template scene, root target, instance
script override, child override, nested target, expression identity, duplicate
identity/resource/property/node path, or ambiguous supported syntax is refused.
There is no fallback from missing target ID to display name or node name.

An explicit numeric override may use 0.001 through 1 with at most three decimal
places. Expressions, exponent notation, trailing comments on that property,
indented relevant property assignments, and sub-millisecond values are not
interpreted. Effective value precedence is: explicit instance override, explicit
PackedScene root override, selected BaseWorld balance-profile value, then the
known 120 ms script default. Malformed input fails before any patch is produced.

The scene root must be an unscripted `Node3D` with no `balance_profile` property,
or use exact known `scripts/core/base_world.gd` (LF SHA256
`2782fcffd844a78b1e59e74a0e2234f8f1b649a089c93dc68c87610a498182f1`).
For that BaseWorld only, absent/null `balance_profile` means 120 ms. A selected
profile must be a unique external `.tres` resource using exact known
`scripts/core/balance_profile.gd` (LF SHA256
`9179b102a43800bb23a60cf401e7a02fed55f4762e0d0a7b9e0942fa09cbc5f3`).
Only its fixed Resource/BalanceProfile structure and literal numeric properties
are supported. Duplicate resources/properties, reordered script assignment,
subresources/inheritance and expressions are refused. Consulted root/profile
scripts and profile resource bytes join the existing binding dependencies.

A non-null profile is only considered applicable when the known BaseWorld can
bind its PlayerController: `player_path` must be absent or exactly `^"Player"`,
and its unique direct `Player` child must instantiate the unchanged known
`scenes/actors/player.tscn` with no script/child overrides. The actor and known
`scripts/core/player_controller.gd` bytes are additional binding dependencies.
Missing/renamed players, custom paths or unknown player implementations are
unsupported rather than described using a profile that would return early.
This finite source check does not replace native build/runtime verification of
the whole authored project, including unrelated custom gameplay scripts.

Legacy target/profile scripts are deliberately unsupported for editing because
they overwrite instance values during initialization; merely having the same
file path or base version does not authorize them. Read-only runtime observation
continues to work on legacy scenes. Unsupported source must be explicitly
upgraded through ordinary checked source adoption before this editor is enabled.

For a changed value, the planner replaces only the selected instance's property
value or appends one line at the end of its node block, after script binding. Unrelated bytes,
line endings, existing property spacing, other targets, and shared scripts and
templates are preserved. A no-op returns identical text without adding an
override. Caller maps/files are never mutated. Setting 120 ms when a profile
supplies 250 ms writes an explicit 120 ms instance override. Setting the already
effective value may remain a no-op; this operation does not remove an override
or switch back to profile inheritance, and it never resets gameplay state.

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
