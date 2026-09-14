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
