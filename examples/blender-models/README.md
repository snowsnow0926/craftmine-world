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
node scripts/run-blender-codex.mjs pomeranian-cute test-results/codex-models/prompts/pomeranian-cute.txt new examples/blender-models/references/pomeranian-cute-reference.png
node scripts/run-blender-codex.mjs j20 test-results/codex-models/prompts/j20.txt new examples/blender-models/references/j20-reference.png
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

## User correction: image reference before modeling

The user rejected the initial procedural dog as scary and requested an
AI-image-first workflow. Its script and review history remain available as an
honest record; stopping that refinement was a user-directed change of visual
target, not a token/time limit or a model capability failure.

`references/pomeranian-cute-reference.png` is a generated design target, explicitly
separate from actual model renders. A new Codex CLI invocation receives that image
via `--image`, still using `gpt-6-astra` and `xhigh`, and writes
`pomeranian-cute.py`/`pomeranian-cute` artifacts without overwriting the old model.
Reference provenance and hashes are recorded beside the image. The subsequent
J-20 session completed the same image-reference-first workflow.

## Completed results, 2026-09-13

Both CLI sessions completed with `gpt-6-astra`, `xhigh`, and one real input image
each, confirmed by their actual session events. The bundled broker generated
the assets, the normal Rust transaction imported them into isolated projects,
and the shipped Godot engine successfully read both final GLBs headlessly.

| Model | GLB bytes | Triangles | Materials | Actual model previews |
| --- | ---: | ---: | ---: | --- |
| Cute white Pomeranian | 3,753,144 | 104,101 | 11 | hero, front, side, back |
| J-20 exterior | 1,130,080 | 41,884 | 25 | hero, top, side, back, front |

The Pomeranian now has a compact body, rounded face, recessed eyes, short muzzle
and legs, and softer fur. It remains a stylized plush interpretation with a
relatively high triangle count; it is not an optimized animated game character.
The J-20 is an exterior interpretation with simplified dark cockpit, ducts and
nozzles. Neither model includes rigging, animation or gameplay systems. Project
import is verified; placement in the player's world is not claimed.

The coordinator calibrated preview lights and fitted framing during the J-20
work. Its final previews use studio-v2. The delivered Pomeranian previews retain
the brighter lighting of its completed visual review; both sets render actual
GLB geometry. Reference PNGs are kept separately and are not model renders.

Final source scripts and model-specific notes are in this directory. The local
delivery ZIP is `test-results/codex-models/blender-ai-models-20260913.zip`, containing
both GLBs, editable Blender sources, executed Python, references, final previews,
and verification records. Tracked evidence is in
`docs/evidence/blender-models-20260913/summary.json`. The original rejected dog and
intermediate revisions remain in the local artifact history, outside the ZIP.
The original packaged release seal was verified unchanged after the final runs.
