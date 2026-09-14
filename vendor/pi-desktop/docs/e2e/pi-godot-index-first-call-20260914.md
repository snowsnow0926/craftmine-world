# PI Godot project index on the first request

The real DeepSeek runs called `godot_project_index` before it was activated,
receiving Tool not found despite source guidance requiring the tool's pins.
The source manifest already defines the correct limit of 1–32; the missing
initial schema also left the model guessing unsupported pagination sizes.

In `packages/agent-runtime`, run:

```text
node node_modules/vitest/vitest.mjs run src/craftmine-context.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

The Godot profile regression loads the production manifest's index schema,
passes it through a host-provided definition, and runs the real native PI loop
with a deterministic provider response. The first offered request must contain
that exact schema, including minimum 1, maximum 32 and default 32. A first
native index call with offset 0 / limit 32 reaches the ordinary `tools.execute`
host route before source reads, patches and checks, without ToolSearch or a
deferred activation. Existing permission and world boundaries remain in effect.

The same profile cases confirm index availability across fresh runtimes and
world/task switches, absence in legacy/unknown worlds, and absence when the
host has not registered the definition. Summary, review and finished-task
closeout expose no tools. No Codex adapter files or tool catalogs are modified.

Before the one-line profile amendment, two Godot profile cases failed: the
initial schema was absent and Godot re-selection still omitted the index. The
same tests then passed; the complete request-boundary file passed 53 tests and
runtime type-check passed. This is a native-loop contract test with a mocked
provider and host response, not proof of a subsequent real provider run.

## Embedded Blender continuation regression

The later real 1M/max continuation no longer failed on the index, but its initial
`blender_generate` still produced Tool not found until ToolSearch activation.
Include only that existing tool and `blender_job_read` in the initial Godot
profile; keep `blender_cancel` deferred.

Two added native-loop cases independently make generation or job reading the
first provider tool call. They load the complete production manifest schemas and
assert the first offered definition equals those bytes structurally. The request
reaches the normal `tools.execute` host route with the exact original arguments,
without ToolSearch or deferred activation. No actual Blender process is launched;
the host response and provider are contract fixtures. World-switch and
unregistered-definition cases now cover both Blender names as well, while
summary/review/finished-tool exclusion remains covered.

Before the one-line profile extension, the two new first-call cases and the
profile-switch assertion failed. Afterward all 55 request-boundary tests passed,
and runtime type-check passed. This does not certify a generated artifact;
subsequent actual model/Blender/check/application acceptance remains separate.

## Engine documentation and strict-prefix continuity

Real package `7aa4fb70`, A6 turn `92b37c4a-54e2-47aa-8f99-7a903bf29fbc`,
confirmed successful calibrated requests before ToolSearch activated only
`plugin_craftmine_world_godot_docs` (`call_01_eIQg1pKsXqyCFVhEB7gG6307`).
The next trigger recorded `history.estimatedTokens=294923`, complete estimated
input 654738 using the conservative UTF-8/2 method, and threshold 521859 with
window 1M/output 384000. Adding the tool necessarily changed the strict toolset
key; this was an intentional fallback, not permission to weaken prefix proof.
The summary succeeded and subsequent requests used calibration again. These
are observations during an unfinished turn, not a final zero-compaction claim.

Add the existing registered `godot_docs` read tool to the initial Godot profile.
Its manifest parameter schema is 384 bytes. The native first-call regression
uses `mode=info`, checks the full real schema and 1..16000 read limit, and
requires the normal `tools.execute` route without deferred activation. Extend
world-switch, missing-registration, summary/review and finished-task checks to
this name. Keep live sampling, library and unrelated controls deferred; do not
modify Codex, engine documentation contents or any exact-prefix verifier rule.
