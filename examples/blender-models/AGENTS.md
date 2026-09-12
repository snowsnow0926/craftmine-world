# Modeling session scope

This request already has its own branch/worktree, created from the integrated
Blender implementation. Keep this worktree and do not merge or remove it.
The user explicitly requests Codex CLI gpt-6-astra with xhigh reasoning.
Do modeling in this CLI session, without delegation or changing model settings.

Model scripts belong here. Generated artifacts and previews belong under
`test-results/codex-models/artifacts/`. Use the existing packaged modeling tools:

```powershell
node scripts/blender-model-demo.mjs generate pomeranian examples/blender-models/pomeranian.py
node scripts/blender-model-demo.mjs render pomeranian hero
node scripts/blender-model-demo.mjs render pomeranian side
```

Generation uses the packaged Rust core, plugin tools and restricted Blender
broker with an isolated test profile. The adapter automatically exports `.blend`,
GLB, the executed script and receipts. Do not save or render inside the modeling
script: the fixed driver owns its output set. Do not modify the adapter, native
broker, product runtime or validation policies. The normal existing model-file
import limit is reported by the actual tool; it is not an imposed model budget.

The separate trusted render command imports the actual generated GLB into bundled
Blender and renders PNGs without executing the modeling script. It uses Blender
Z-up and looks toward +Y: create the animal's face or aircraft nose toward -Y.
Supported views: hero, front, side, back, top. Inspect previews and revise geometry
as needed. No AI image generation, flat image stand-ins or downloaded finished
models. No mouse/keyboard simulation, GUI launch, Pointer Lock or user browser.

Keep code/comments English. The coordinator owns setup scripts and final commits;
do not commit unrelated files or edit outside this request worktree.
