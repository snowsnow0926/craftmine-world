# Reusable fragments from the approved canyon city

Date: 2026-09-13. Status: accepted for the isolated player workflow continuation.

The approved city world is retained as a whole-world template. It also supplies
three smaller reusable components: a ward building, a twin-tower gate with wall
ends, and a two-house street. Reuse goes through the existing immutable source
package catalog and managed source installer. No new player/world storage or
model tools are added.

The original city and ward GLBs batch objects by material, so whole-node copying
would bring unrelated districts into a new world. A deterministic static GLB
extractor instead retains triangles, normals and material declarations in fixed
source bounds, then translates them to ground anchors. Complete ward buildings
have no excluded boundary triangles. Gate wall ends and the street's original
flat ground are clipped to explicit rectangles. The original source bytes are
never modified; each derivative records its original SHA-256, bounds and method.
The extractor accepts only the inspected embedded, unskinned, unanimated static
GLB subset; it does not execute authored code or call a model.

Each package has one root identity and static child geometry. Its local wrapper
constructs collision from the original solid meshes and reuses the original city
material shader. It changes no player, input, HUD, weather or receiving-world
objects. There are no external runtime source dependencies. Engine headless
physics uses original imported materials because Godot's dummy renderer has no
shader-material instance data; actual Web rendering uses the retained shader.

Original source contains an MIT declaration, which is preserved. The generated
reference-derived geometry's rights are marked unverified; package hashes and
visual inspection are not legal verification. Actual isolated Godot Web PNGs
are pinned to the geometry, wrapper and shader hashes and exposed as component
views. They are separate from a receiving-world runtime/application receipt.
# Receiving-floor correction

The included street sand is an instance-local surface layer 20 mm above the
normal Y=0 receiving ground, with its collider at the same offset. Other mesh
nodes and approved/derived GLB bytes remain unchanged. Publish measured approach
and interior/passage waypoints as optional package navigation metadata. Adoption
still validates the saved player capsule; move and save outside the new raised
footprint through normal gameplay instead of adjusting native penetration guards.
