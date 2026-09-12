# Keep module parameter authoring in existing source transactions

Date: 2026-09-12. Status: accepted for the two audited Kenney wrappers.

Runtime `configure()` changed an imported building temporarily, but the existing
progress snapshot did not carry those fields. Reconstructing the scene restored
its source defaults. Editing the shared module script would also affect every
instance. The existing parent scene can already persist per-instance overrides.

Expose source capture and patch preview through `godot_project_query`, bound to
the host's frozen scene-object capture and an immutable Core source index.
Compile a patch only for the unique owning parent-scene node. Keep all source
writes, checks, adoption and saves in the existing transaction/lifecycle.

This adds no generic property setter, progress schema, package registry, implicit
script execution or installation authority. Pinned known wrappers provide the
finite interpretation contract. Unknown wrappers continue to use normal source
inspection and development. Preserved CP0 declarations are descriptive input,
not executable setter authority. Runtime safety is independently checked; a
source proposal alone cannot certify the resulting player's physical clearance.

The cost is a deliberately limited typed interface and strict recapture after
source or runtime identity changes. Broader inheritance, module types, rendering
properties and migrations require their own evidence before extending it.
