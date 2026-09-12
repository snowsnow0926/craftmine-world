extends "res://glb_audit.gd"
const V2 = preload("res://craftmine_shared/scene_mesh_picker_v2.gd")
var picker := V2.new()
var cases := {}
var fixture: Node3D
var view: Camera3D
func sample(label: String, physics: Dictionary = {}) -> Dictionary:
	var result := picker.pick(fixture, view, [], physics)
	cases[label] = clean(result, fixture)
	return result
func material(cull: int = BaseMaterial3D.CULL_BACK) -> StandardMaterial3D:
	var value := StandardMaterial3D.new()
	value.cull_mode = cull
	return value
func add_surface(mesh: ArrayMesh, z: float = -3, indexed: bool = true) -> void:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-1, -1, z), Vector3(0, 1, z), Vector3(1, -1, z)])
	if indexed: arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0, 1, 2])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(mesh.get_surface_count() - 1, material())
func object(mesh: Mesh) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	fixture.add_child(node)
	return node
func reset() -> void:
	for node in fixture.get_children():
		if node != view:
			fixture.remove_child(node)
			node.free()
	view.position = Vector3.ZERO
	view.rotation = Vector3.ZERO
func run() -> void:
	for tick in range(8): await get_tree().process_frame
	var world := get_tree().current_scene as Node3D
	var player := world.get_node("Player")
	player.input_enabled = false
	player.capture_mouse_on_click = false
	var adapter: RefCounted = get_node("/root/CraftmineRuntime").adapter
	var building: StaticBody3D
	var road: StaticBody3D
	for module in get_tree().get_nodes_in_group("kenney_city_modules"):
		if module.MODULE_KIND == "building": building = module
		else: road = module
	road.visible = false
	building.position = Vector3(0, 0, -4)
	var camera := Camera3D.new()
	world.add_child(camera)
	camera.position = Vector3(0, 0.5, 0)
	camera.current = true
	for tick in range(3): await get_tree().physics_frame
	var exclusions: Array[Node] = adapter._helper_exclusions(player, {})
	var physics: Dictionary = adapter._ray_hit(camera, player, 4294967295)
	var old := Legacy.new().pick(world, camera, exclusions, physics)
	check(old.status == "fallback" and old.reason == "unsupported-mesh-type", "legacy independent building negative is preserved")
	var hit := picker.pick(world, camera, exclusions, {})
	cases["buildingBaseTriangles"] = clean(hit, world)
	check(hit.status == "hit" and building.is_ancestor_of(hit.get("node")), "V2 hits independently placed real installed GLB building triangles")
	var blocked := picker.pick(world, camera, exclusions, physics)
	cases["buildingPhysics"] = clean(blocked, world)
	check(physics.get("collider") == building and blocked.status == "blocked" and blocked.reason == "nearer-or-tied-physics-hit", "V2 preserves ordinary actual building physics tie")
	# The fixture installs only the new picker into the existing ordinary adapter.
	# Optional full cohort overlay in the host runner replaces this with the real
	# wrapper before import; no project source or observer response is fabricated.
	if FileAccess.file_exists("res://craftmine_shared/controller_evidence.gd"):
		check(adapter.mesh_picker.get_script() == V2, "full controller cohort actually installed V2 before test observer calls")
	else:
		adapter.mesh_picker = picker
	var observed: Dictionary = adapter.observe()
	cases["adapterBuildingObservation"] = observed.creation
	var body_id := str(building.get_instance_id())
	check(observed.creation.sceneObjectTarget is Dictionary and observed.creation.sceneObjectTarget.objectId == body_id and observed.creation.sceneObjectTarget.nodePath == str(world.get_path_to(building)), "ordinary adapter observe exposes imported building physics body as exact scene target")
	var retained := false
	for reference in observed.creation.sceneObjectRefs:
		retained = retained or reference.objectId == body_id
	check(retained, "ordinary adapter sceneObjectRefs retains exact imported building reference")
	for tick in range(3): await get_tree().physics_frame
	var repeated: Dictionary = adapter.observe()
	check(repeated.creation.sceneObjectTarget.objectId == body_id, "repeated ordinary observe keeps stable live building identity")
	check(observed.creation.physicsTick > 0 and repeated.creation.physicsTick > observed.creation.physicsTick, "ordinary adapter physics tick remains connected and increases")
	var second: Node3D = load("res://addons/kenney-city-building/module.tscn").instantiate()
	world.add_child(second)
	second.position = Vector3(4, 0, -4)
	camera.position.x = 4
	for tick in range(3): await get_tree().physics_frame
	var second_hit := picker.pick(world, camera, exclusions, {})
	cases["secondBuilding"] = clean(second_hit, world)
	check(second_hit.status == "hit" and second.is_ancestor_of(second_hit.get("node")) and second_hit.objectId != hit.objectId, "second independent instance has its own actual hit identity")
	var observed_second: Dictionary = adapter.observe()
	cases["adapterSecondObservation"] = observed_second.creation
	check(observed_second.creation.sceneObjectTarget is Dictionary and observed_second.creation.sceneObjectTarget.objectId == str(second.get_instance_id()) and observed_second.creation.sceneObjectTarget.objectId != body_id, "ordinary adapter targets second independent module without reusing first identity")
	var box := MeshInstance3D.new()
	box.mesh = BoxMesh.new()
	box.position = Vector3(0, 0.5, -2)
	world.add_child(box)
	camera.position.x = 0
	building.position.x = 20
	var off_ray := picker.pick(world, camera, exclusions, {})
	cases["offRayBuilding"] = clean(off_ray, world)
	check(off_ray.status == "hit" and off_ray.node == box, "off-ray static GLB does not globally block ordinary BoxMesh")
	box.visible = false
	second.visible = false
	building.position.x = 0
	JavaScriptBridge.eval("globalThis.__GLB_PICK_V2_SCREENSHOT_READY = true")
	for tick in range(3): await get_tree().process_frame
	world.visible = false
	fixture = Node3D.new()
	get_tree().root.add_child(fixture)
	view = Camera3D.new()
	fixture.add_child(view)
	view.current = true
	var mesh := ArrayMesh.new()
	add_surface(mesh)
	var node := object(mesh)
	hit = sample("indexedTriangle")
	check(hit.status == "hit" and hit.node == node and hit.surfaceIndex == 0 and hit.counts.facesRead == 1, "indexed native ArrayMesh exact triangle hit")
	check(not hit.pixelAccurate and not hit.renderLodVerified and hit.geometryBasis == "base-surface-arrays", "base geometry evidence explicitly does not certify rendered LOD or pixels")
	var nohit := sample("aabbMiss")
	view.position = Vector3(0.9, 0.9, 0)
	nohit = sample("aabbOnlyMustMiss")
	check(nohit.status == "none" and nohit.counts.candidates == 1, "AABB intersection outside triangle is not a hit")
	view.position = Vector3.ZERO
	mesh.surface_set_material(0, material(BaseMaterial3D.CULL_FRONT))
	check(sample("frontCulled").status == "none", "surface front culling is honored")
	add_surface(mesh, -4, false)
	hit = sample("secondSurface")
	check(hit.status == "hit" and hit.surfaceIndex == 1 and hit.surfaceTriangleIndex == 0, "second surface indexed-independent material and nonindexed triangles")
	node.set_surface_override_material(1, material(BaseMaterial3D.CULL_FRONT))
	check(sample("surfaceOverride").status == "none", "surface override takes precedence over mesh material")
	node.material_override = material(BaseMaterial3D.CULL_DISABLED)
	check(sample("globalOverride").surfaceIndex == 0, "global material override takes precedence on every surface")
	node.material_override = null
	node.set_surface_override_material(1, null)
	var transparent := material()
	transparent.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mesh.surface_set_material(0, transparent)
	check(sample("unknownNearSurface").status == "fallback", "transparent foreground surface cannot select opaque geometry behind")
	reset()
	mesh = ArrayMesh.new()
	add_surface(mesh)
	node = object(mesh)
	node.position = Vector3(0, 0, -1)
	node.scale = Vector3(2, 0.5, 2)
	hit = sample("scaledTriangle")
	check(hit.status == "hit" and absf(hit.position.z + 7) < 0.0001 and hit.normal.is_normalized(), "nonuniform positive transform uses actual triangle and normal")
	node.scale.x = -2
	check(sample("negativeScale").status == "fallback", "negative scale remains uncertainty blocker")
	reset()
	mesh = ArrayMesh.new()
	add_surface(mesh)
	node = object(mesh)
	var shader := ShaderMaterial.new()
	shader.shader = Shader.new()
	shader.shader.code = "shader_type spatial; void vertex() { VERTEX.x += 1.0; }"
	node.material_override = shader
	node.position.x = 20
	check(sample("offRayShader").reason == "custom-material", "unbounded shader rejected even off base AABB")
	node.material_override = null
	mesh.custom_aabb = AABB(Vector3(-1, -1, -1), Vector3.ONE)
	check(sample("customBounds").reason == "custom-array-bounds", "custom bounds cannot masquerade as exact static geometry")
	mesh.custom_aabb = AABB()
	node.position.x = 0
	node.skin = Skin.new()
	check(sample("skin").reason == "deformed-array-mesh", "skinned meshes rejected before array reads")
	reset()
	mesh = ArrayMesh.new()
	mesh.add_blend_shape("altered")
	node = object(mesh)
	check(sample("blendShape").reason == "deformed-array-mesh", "blend shape resources rejected before array reads")
	reset()
	mesh = ArrayMesh.new()
	for index in range(17): add_surface(mesh)
	node = object(mesh)
	var budget := sample("surfaceBudget")
	check(budget.reason == "surface-budget" and budget.counts.facesRead == 0, "surface budget enforced before array reads")
	reset()
	mesh = ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	var vertices := PackedVector3Array()
	vertices.resize(12291)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	node = object(mesh)
	budget = sample("vertexBudget")
	check(budget.reason == "mesh-vertex-budget" and budget.counts.facesRead == 0, "vertex budget enforced before array reads")
	reset()
	mesh = ArrayMesh.new()
	arrays = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-1,-1,-3), Vector3(0,1,-3), Vector3(1,-1,-3)])
	var indices := PackedInt32Array()
	indices.resize(12291)
	arrays[Mesh.ARRAY_INDEX] = indices
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	node = object(mesh)
	budget = sample("triangleBudget")
	check(budget.reason == "mesh-triangle-budget" and budget.counts.facesRead == 0, "index triangle budget enforced before array reads")
	reset()
	mesh = ArrayMesh.new()
	add_surface(mesh)
	node = object(mesh)
	var duplicate := object(mesh)
	check(sample("coincidentInstances").reason == "ambiguous-coincident-meshes", "coincident independent native instances remain ambiguous")
	duplicate.position.z = -2
	node.transparency = 0.5
	check(sample("transparentForeground").status == "fallback", "unknown foreground cannot select second instance behind")
	node.position.z = -5
	check(sample("transparentBehind").status == "hit", "bounded unknown behind nearest triangle does not block")
	reset()
	mesh = ArrayMesh.new()
	add_surface(mesh)
	var custom := GDScript.new()
	custom.source_code = "extends ArrayMesh"
	check(custom.reload() == OK, "scripted native resource fixture compiles")
	mesh.set_script(custom)
	node = object(mesh)
	budget = sample("scriptedResource")
	check(budget.reason == "scripted-mesh-resource" and budget.counts.facesRead == 0, "script-attached mesh never enters virtual array reads")
	reset()
	mesh = ArrayMesh.new()
	arrays = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-1,-1,-3), Vector3(0,1,-3), Vector3(1,-1,-3)])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, Mesh.ARRAY_FLAG_USE_DYNAMIC_UPDATE)
	node = object(mesh)
	check(sample("dynamicUpdate").reason == "unsupported-array-format", "dynamic update arrays cannot use stale static bounds")
	reset()
	mesh = ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_POINTS, arrays)
	node = object(mesh)
	var rear := object(BoxMesh.new())
	rear.position.z = -5
	check(sample("unknownPoints").status == "fallback", "unsupported foreground primitive cannot expose object behind")
	reset()
	mesh = ArrayMesh.new()
	arrays[Mesh.ARRAY_BONES] = PackedInt32Array([0,0,0,0,0,0,0,0,0,0,0,0])
	arrays[Mesh.ARRAY_WEIGHTS] = PackedFloat32Array([1,0,0,0,1,0,0,0,1,0,0,0])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	node = object(mesh)
	check(sample("boneWeights").reason == "unsupported-array-format", "bone and weight arrays rejected even without a Skin resource")
	reset()
	node = object(BoxMesh.new())
	node.position.z = -3
	node.transparency = 0.5
	check(sample("defaultMaterialTransparency").status == "fallback", "null material does not hide per-instance primitive transparency")
	reset()
	mesh = ArrayMesh.new()
	arrays = []
	arrays.resize(Mesh.ARRAY_MAX)
	vertices = PackedVector3Array()
	for index in range(4096):
		vertices.append_array(PackedVector3Array([Vector3(-1,-1,-3), Vector3(0,1,-3), Vector3(1,-1,-3)]))
	arrays[Mesh.ARRAY_VERTEX] = vertices
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	for index in range(5): object(mesh)
	budget = sample("aggregateVertexBudget")
	check(budget.reason == "vertex-budget" and budget.counts.facesRead == 0, "aggregate budget completes before any surface data read")
	reset()
	fixture.visible = false
	world.visible = true
	camera.current = true
	var result := {"cases": cases, "checks": checks, "passed": true}
	for item in checks: result.passed = result.passed and item.passed
	print("GLB_PICK_V2=" + JSON.stringify(result))
	JavaScriptBridge.eval("globalThis.__GLB_PICK_AUDIT = " + JSON.stringify(result))
