# Godot client initialization and application

Creating a delivered base registers a durable world and resumes its authored
source through project creation, atomic text/binary installation, managed build,
independent check and a real first-load application. A world is playable only
after the core confirms the application. Retries retain the operation identity
and reconcile durable state; a lost response never deletes a registered world.

Starting snapshots are captured from the six authored scenes with the pinned
Godot engine in isolated headless profiles. Materialization rebinds the world
identity without inventing gameplay fields. The captured native snapshot takes
precedence over authoring configuration such as playerPosition or sceneId.
The refresh tool retains engine-run evidence and the source manifest digest.

Git-backed candidate application prepares and advances the exact candidate
branch's content operation, commits the independently confirmed deployment and
confirms the content operation with its durable application identity. Lost
replies reconcile the original operation; a committed deployment is never
rolled back as though it had failed. Uncertain state remains paused.

The managed package installer binds selected world and authoring context in the
trusted plugin process. It installs exact archive bodies, scene references,
instance identities and canonical lock in one source revision, then submits a
real check. Source installation does not claim player application.

Validation includes actual pinned-engine initial-state capture, creation and
candidate fault regression tests, TypeScript checks, and a separate full-client
headless harness. The harness uses the real Electron entry and plugin/core with
private data, no input simulation, no focus and Pointer Lock disabled. Initial
unit and source-build results are not real-model or packaged-release acceptance.
