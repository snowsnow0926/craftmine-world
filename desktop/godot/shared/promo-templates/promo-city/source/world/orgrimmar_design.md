# 奥格瑞玛：参考图驱动的可步行城市

Original player request: 复刻奥格瑞玛, with the attached red-canyon city reference. This is a stylized, original modeled reconstruction of that composition, not an imported official game map or a claim of 1:1 canonical district scale.

## Preserved editable Blender sources
- Whole pre-split architecture source: f23f934a-89b0-47ee-84c8-89f8da898907 (preserved, initial GLB exceeded the per-file ceiling).
- assets/blender/orgrimmar-city.glb: sourceJobId 62355201-b396-4fcb-9128-3ef771d17492.
- assets/blender/orgrimmar-wards.glb: sourceJobId 77e63fa0-5940-4883-999d-73cb3dc6a97d.
- assets/blender/durotar-canyon.glb: sourceJobId 8838394c-c032-4f27-9c22-0d90320de6fa.
- assets/blender/orgrimmar-grunt.glb: sourceJobId a605ea72-8f1e-4f66-bbfd-17864a695034.

Blender meters: +Y north, Z up. Godot +Y up, -Z north. Player starting pose is retained (0,0.9,6), outside the new gate. Existing base entities, progression, runtime bridge, controller and base world script are preserved. The new world script subclasses the old one and extends only environmental construction, ordinary city gameplay and the allowable player-position extent.

22 enterable roofed ward buildings; twin gate; keep with accessible throne hall; 6 named discovery regions; 2 upper wards; 2 canyon outposts; 5 bridge spans; central bonfire; 6 guards, including 2 actual CharacterBody3D patrols. HiddenSolid meshes provide continuous stair slopes and bridge rails. Model material names drive the authored stone/wood/cloth/metal/fire/water shader. Imported hidden meshes are hidden at runtime, not removed. Collision surfaces are generated from actual model triangles.

M: map with actual player position and persisted region visits. V: fixed overview camera without relocating the player; V again restores first-person. E near a guard: local dialogue. Falls below -20 return to the approach. Discovery flags use the existing validated inventory ledger; all previous inventory values are preserved.

The curated Godot digest covers GDScript lifecycle, scene instancing and CharacterBody3D, but does not contain the mesh/shader API details used here. Those details require actual engine compilation. Route surface samples are observations of support at chosen anchors, not proof of complete player route traversal. No model/source receipt asserts gameplay or application.
