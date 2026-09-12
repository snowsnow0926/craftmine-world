# Codex CLI modeling with bundled Blender

User request: create a white Pomeranian first, then a J-20 visual model, using
Codex CLI with `gpt-6-astra` and `xhigh` reasoning. No additional model-call,
token, or whole-turn limit is configured for these runs.

The coordinator prepares only the invocation and rendering adapters. The CLI
session writes and revises the actual modeling Python. Its scripts are executed
by the previously built Craftmine package's world tools and restricted Blender
broker, with an independent Rust world/profile for each attempt. This is a CLI
modeling demonstration, not a claim about the player's normal application session.

The adapter preserves the real generated GLB, editable `.blend`, executed Python,
job receipts, and preview PNGs in `test-results/codex-models/artifacts/<name>/`.
Previews render the actual GLB through the bundled Blender executable, so they
show geometry/materials that survive export. The trusted renderer uses no model
script, user files, real input, or visible application window.

The selected CLI model and effort are recorded in both invocation metadata and
the CLI's actual `turn_context` events. Logs and prompts are retained under
`test-results/codex-models/cli/` and `test-results/codex-models/prompts/`.

```powershell
node scripts/run-blender-codex.mjs pomeranian test-results/codex-models/prompts/pomeranian.txt
node scripts/run-blender-codex.mjs j20 test-results/codex-models/prompts/j20.txt
```

The second command is run only after the first model has been made and reviewed.
These commands reuse the current Codex ChatGPT login without copying credentials.
They explicitly override the configured default reasoning effort to `xhigh`.

The first real preview exposed a Windows Python import path of exactly 260
characters inside the deeply nested release directory. The coordinator prepared
`desktop/build/preview-runtime` as a shorter, fully hash-verified copy of that
same packaged Blender runtime. The fixed preview tool uses this copy; generation
continues through the product broker. Preview Python uses a minimal environment
with bytecode writing disabled, keeping the original package bytes unchanged.

The inherited product GLB import ceiling is 4 MiB per file. Generation failures,
import failures and visual limitations must be reported from actual outputs;
they must not be hidden by substituting a different model or a flat image.
