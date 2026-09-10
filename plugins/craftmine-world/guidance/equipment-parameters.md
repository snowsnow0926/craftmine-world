# Tune an existing first-person equipment item

Skill: `first-person.equipment-parameters`, version `1.0.0`.

Use for changing damage, cooldown or range on an existing equipment resource in
the shipped first-person base `0.1.0`, engine `4.7.2-stable`. The catalog checks
the exact shipped equipment definition, catalog and state script hashes. This
is a parameter edit recipe, not an installer or a new gameplay executor.

Do not use for adding or removing equipment IDs, changing ammunition capacity,
new attack modes, custom equipment scripts, other bases, state migration or a
shop. An unsupported base or changed interface needs fresh source inspection;
do not silently apply this version's recipe.

Required capabilities: `godot_project_facts`, `godot_project_query`,
`godot_file_read`, `godot_project_patch`, `godot_build_start`, `godot_build_read`
and `godot_runtime_state`, as actually reported by `godot_capability_report`.
Missing build/check/live capabilities are explicit remaining work, not success.

1. Read the bound project facts and capability report. Call `godot_guidance`
   mode `catalog`, then read this exact ID/version/hash at the returned source
   revision and manifest hash. Read referenced source with exact reference
   paths, and follow `nextOffset` until the needed text is complete. Guidance
   snapshots describe the shipped interface; they do not replace reads of the
   player's actual source.
2. Locate the requested equipment in the current scene and catalog through
   `godot_project_query` and pinned `godot_file_read`. The shipped catalog is
   `data/equipment/equipment_catalog.tres`; it lists pistol, practice_sword and
   inspection_tool. These are starting examples, not a claim that a customized
   world still uses them. Confirm the selected item's ID and resource path;
   use a matching live sample when the request means the currently held item.
3. Read the entire current target `.tres` and retain its exact hash. Change only
   the requested fields. `EquipmentDefinition.damage` and `cooldown_seconds`
   are finite non-negative floats; `range_meters` is finite and positive.
   Preserve the equipment ID, script/resource references, catalog membership,
   ammunition, state and unrelated visuals. Example only: the shipped pistol
   resource has `damage = 12.0`; a request for damage 18 changes that property
   to `damage = 18.0` in the current resource, not by replacing it with the
   shipped example or setting a second value on the player script.
4. Patch the bound draft with `godot_project_patch`, using the read revision,
   manifestHash and expectedHash. A put contains the complete current file with
   the local edit. On a hash conflict, read the current source again and retain
   unrelated edits. Re-catalog guidance if continuing at a new source revision.
5. Start the available managed check on the new source identity and inspect the
   actual job output. Fix concrete import or validation failures within the
   existing task budget. Do not modify frozen check assertions. Report blocked
   execution and retain the draft if the host cannot check it.
6. Success requires the requested local source change and real check evidence.
   The equipment state's active definition drives attacks; damage, cooldown
   and range are source parameters, while saved magazines/reserves are progress.
   After the player's existing candidate/application flow, verify the matching
   live item and requested attack behavior, plus retained progress across a
   restart. An absent observation is unknown; a source receipt or passing import
   alone does not prove behavior, persistence or application.

Known failures: a missing target requires locating the actual catalog; a changed
interface is `GUIDANCE_INTERFACE_UNSUPPORTED` and needs source-level reasoning;
an unsupported version requires compatible guidance, not an engine guess.
Invalid damage/cooldown/range is rejected by `EquipmentDefinition.validate()`.
Cooldown and reload already live in `EquipmentState`; do not bypass those
checks to demonstrate an attack. No guidance text grants filesystem, shell,
network, publication, application or verification authority.

Evidence and references are the catalog's pinned source snapshots:
`scripts/core/equipment_definition.gd`, `scripts/core/equipment_catalog.gd`,
`scripts/core/equipment_state.gd`, `data/equipment/pistol.tres`,
`data/equipment/equipment_catalog.tres`, `docs/BASE_SPEC.md` and
`docs/STATE_FORMAT.md`, from `desktop/godot/bases/first-person` at source commit
`9469aaa487b31ea41b839c7cd4214c2c7f3f293b`. This is source-derived guidance.
No real model comparison or new gameplay acceptance is established by loading it.
