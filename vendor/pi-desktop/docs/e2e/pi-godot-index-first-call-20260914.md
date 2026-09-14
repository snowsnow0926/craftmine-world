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
