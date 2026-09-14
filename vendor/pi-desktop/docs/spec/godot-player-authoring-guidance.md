# Godot player authoring request guidance

The prompt and public tool descriptions must distinguish the Godot
`creation-sandbox` base-generator editor from the legacy voxel editor.
`creation_operation` edits supported structured entities in
`world/creation.json` through the existing Godot source transaction. It does not
edit arbitrary addon nodes or reuse a same-named library asset. The host's
captured target, source pins and supported request schema remain mandatory.

The available implementation choices remain base generators, compatible
reusable scenes, ordinary Godot source edits and Blender authoring. Choose based
on requested appearance/behavior and actual contracts. No prompt should force a
single implementation for every object or substitute a simpler outcome for the
player's request.

`machineFacts.godotFacts` is a projection of journaled source facts. Its current
implementation can return null when there is no projected Godot section or
source receipt, including for an existing Godot world. Null is not proof that
the project is absent and does not change `world.runtimeKind`. Rebuild missing,
changed or uncertain facts through the actual Godot tools; compaction and model
switches still require durable fact reconstruction. Reuse still-current results
already in context. Inspect unresolved dependencies, placement, interfaces and
behavior when relevant rather than habitually reading unrelated setup, initial
saves and controller internals before every supported edit.

Progress and final prose address the player in their language: the next visible
action, actual change, where it can be found, and any remaining check or blocker.
Routine raw revisions, hashes, job IDs and tool implementation details stay in
the existing tool/details record unless requested or needed for troubleshooting.
Real errors and uncertainty remain visible. A passed check does not establish
that an unknown diagnostic is harmless or that gameplay was exercised.

Only host-confirmed full-auto consent delegates checked-candidate application to
the host after the author turn. Pending application remains pending until actual
host evidence proves otherwise. The host updates the running world; do not add
a routine instruction to refresh/reload/reopen after a source receipt or passed
check. Recommend a recovery action when a real failure or host result requires
it. Manual permission and the actual player controls remain authoritative.

This is a text/description correction. No tool schema, runtime action, source
guard, permission, model selection, thinking setting, context/output allowance,
task limit, transcript or error record is changed.
