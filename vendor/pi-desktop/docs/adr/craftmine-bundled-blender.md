# Bundled Blender as a separate restricted modeling process

Date: 2026-09-13
Status: accepted for this implementation

Craftmine needs editable model generation inside its existing creation workflow.
The application ships the official portable Blender runtime and a separately
licensed GPL Python bridge. A private, host-configured native broker executes
modeling scripts using the existing Windows process isolation primitives.
Blender is not linked into the host and its UI is not embedded or automated.

The main process exposes fixed Blender paths only to the trusted Craftmine world
plugin. The model never chooses paths, executable files, boundary policy, or
execution attestations. The plugin records source-bound jobs and imports verified
GLB output through the existing Rust source transaction. Preserved `.blend` and
Python source are generation artifacts, not automatically executable Godot
project imports. Scene placement and gameplay remain in the existing Godot
build/check/application pipeline.

Missing components, incompatible platforms, isolation failures, stale source
revisions, cancellation and restart are explicit outcomes. None enables an
unrestricted fallback or claims an applied world. The feature preserves player
model settings and introduces no token/model-call/whole-turn limits.

See the repository-level `docs/specs/blender-integration-plan.md` for the layout,
delivery sequence, license boundary, and validation requirements.
