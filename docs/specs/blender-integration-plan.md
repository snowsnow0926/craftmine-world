# Bundled Blender integration

Date: 2026-09-13
Request branch: `codex/blender-integration-20260913`
Base: `5dd84194`
Status: implemented; component and authored integration validation passed

## Intended player experience

A player describes a model in the existing creation conversation. The selected
agent can inspect Blender availability, submit Python modeling work, read its
progress, cancel it, and import the resulting GLB into the current managed Godot
source revision. The normal scene authoring, build, check, and application flow
then places the model in the world and connects the requested gameplay.
Generation is not itself proof of visual quality, gameplay, or application.

Blender is an offline bundled component. The player does not install Blender,
choose an executable, use its interface, or grant it the mouse. The existing
model/provider/thinking configuration is retained. This feature introduces no
model-call, token, or whole-turn duration limits.

## Architecture and ownership

1. Pin the official Windows x64 Blender 5.2.1 LTS portable archive, its size and
   SHA-256. Preserve the full runtime, third-party notices, GPL text, and source
   availability information. Add it to normal resource staging and package
   integrity verification; do not discover a player's PATH installation.
2. Supply the trusted world plugin with fixed toolchain paths through a private
   main-process service. Neither model arguments nor renderer messages select a
   broker, runtime root, source root, or purported execution receipt.
3. Run Python only in the native Blender broker, using the established Windows
   restricted process, private noninteractive desktop, network preflight, Job
   containment, minimal environment, and cancellation primitives. There is no
   unrestricted fallback when the platform or runtime fails this boundary.
4. Use a GPL-3.0-or-later Python bridge with fixed export paths. Preserve the
   submitted script and editable `.blend`; export `model.glb` and a structural
   report. An optional previous result is accepted only through a verified
   same-world job reference, never an arbitrary filesystem path.
5. Keep generation jobs separate from world transactions. The trusted host
   validates the broker identity, binding, OS receipts, output paths and hashes.
   It imports GLB bytes through the existing Rust-owned source transaction with
   expected revision, manifest hash, and destination hash. A stale source leaves
   generated artifacts available and does not overwrite newer work.
6. Let the existing Godot tools author scene instances, materials, collision,
   animation hookups and behavior, and perform build/check/application. Preserve
   the distinction between generation, source import, candidate verification,
   and a changed playable world.

## Resource layout

```text
resources/blender/
  toolchain.lock.json
  runtime/blender.exe             # complete portable runtime alongside it
  broker/blender-host-broker.exe
  broker/broker-identity.json
  bridge/driver.py
resources/licenses/blender/       # notices and source availability
```

Development caches and test profiles live under ignored build/test directories.
They are not committed. Every release records the actual bundled bytes.

## Tool contract

- `blender_status`: actual component availability and explicit missing/invalid
  dependency reasons, with name-filtered and paginated same-world source jobs.
  Global runtime status contains no world job history.
- `blender_generate`: source-bound asynchronous generation using Python, a
  managed destination, and optional verified previous job for editing.
- `blender_job_read`: job state, bounded diagnostics, generated model facts,
  import result and source identity; historical jobs cannot impersonate current
  execution or application.
- `blender_cancel`: cancellation scoped to the bound job and world. Turn
  cancellation, unload and restart must leave terminal or interrupted records,
  never silently replay arbitrary scripts.

## Licensing boundary

Blender binary distribution is GPL-3.0-or-later; the `bpy` bridge is distributed
with compatible source and notices. Blender remains a separate program, called
using data files and a process protocol. Our host does not link Blender's APIs.
Generated artwork does not inherit Blender's GPL solely by being generated;
third-party assets retain their own terms. Source availability records must
identify the corresponding release and build/dependency sources, rather than
implying that an unrelated latest-source URL fulfills every obligation.

## Delivery and validation

Work proceeds in isolated Codex agent worktrees for packaging, native execution,
and plugin tools. The coordinator integrates their commits into this request
worktree and reviews the combined behavior. The primary checkout is preserved
for this explicitly isolated request; no remote publication is requested.

Required validation:

- toolchain checksum, archive paths, package inclusion and tamper rejection;
- native parser/boundary tests and real background Blender generation;
- scoped jobs, cancellation, stale source and malformed broker/artifact tests;
- real generated GLB import and headless Godot loading, including geometry and
  authored collision/animation where represented by the fixture;
- host/plugin build checks and existing relevant Godot regression tests;
- source preservation and a second generation editing a previous model.

All browser verification, if needed, uses a separate headless process/profile,
with Pointer Lock disabled before scripts and no mouse/keyboard input simulation.
No test activates the player's application. Synthetic integration fixtures are
reported as such, not as ordinary-player AI quality acceptance.

## Implementation acceptance

The implementation is retained on the requested independent branch/worktree.
The primary checkout has not received these commits and nothing was pushed.
The final real-component test at implementation commit `07123daa` passed 14
assertions, using the complete pinned Blender runtime, freshly built native
broker and Rust core, the built plugin, and Godot 4.7.2. It covers original
generation, discoverable editable source, an actual source edit, runtime GLB and
editor PackedScene import, door animation, collision, Python error diagnostics,
live Python cancellation, historical source reads and unchanged formal progress.

Targeted checks passed: 45 Node tests, 44 native tests and 34 agent context tests.
Agent and desktop builds, strict desktop typechecking, built-in plugin preparation,
and complete runtime resource staging/hash verification passed. Runtime resources
include the full Blender distribution, the pinned upstream source archive, the
GPL bridge source and third-party notices.

Machine-readable results: [acceptance summary](../evidence/blender-integration-20260913/summary.json).
The raw local report is retained at `test-results/bi-Ik3SXH/report.json`.
The ordinary-player model's visual quality, visible interaction, signed installer
and clean-machine installation have not been evaluated by these fixture tests.
Generated GLBs use the existing 4 MiB Godot source-file policy; larger outputs
remain available as generation artifacts with an explicit import failure.

Reproduce the real integration after preparing the bundled runtime and plugin:

```powershell
$env:CRAFTMINE_CORE_BIN = '<absolute freshly built craftmine-core.exe>'
$env:CRAFTMINE_BLENDER_TEST_ROOT = '<absolute desktop/build/runtime-resources/blender>'
$env:CRAFTMINE_GODOT_CACHE_DIR = '<absolute pinned Godot cache>'
node tests/blender/integration.mjs
```

## Primary references

- https://download.blender.org/release/Blender5.2/
- https://www.blender.org/about/license/
- https://www.blender.org/support/faq/
- https://docs.blender.org/manual/en/5.1/advanced/command_line/arguments.html
- https://docs.godotengine.org/en/stable/tutorials/io/runtime_file_loading_and_saving.html
- https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation
