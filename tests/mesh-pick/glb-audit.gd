extends Node
const Legacy = preload("res://craftmine_shared/scene_mesh_picker.gd")
var checks: Array = []
func check(value: bool, label: String) -> void:
	checks.append({"passed": value, "label": label})
func info(node: MeshInstance3D, world: Node3D) -> Dictionary:
	var mesh := node.mesh
	var result := {"nodePath": str(world.get_path_to(node)), "meshClass": mesh.get_class(), "meshPath": mesh.resource_path, "skin": node.skin != null}
	if mesh is ArrayMesh:
		result["blendShapes"] = mesh.get_blend_shape_count()
		result["customAabb"] = str(mesh.custom_aabb)
		var surfaces: Array = []
		for i in mesh.get_surface_count():
			var material: Material = node.material_override
			if material == null: material = node.get_surface_override_material(i)
			if material == null: material = mesh.surface_get_material(i)
			surfaces.append({"surface": i, "primitive": mesh.surface_get_primitive_type(i), "vertices": mesh.surface_get_array_len(i), "indices": mesh.surface_get_array_index_len(i), "format": str(mesh.surface_get_format(i)), "materialClass": material.get_class() if material else "none", "transparency": material.transparency if material is StandardMaterial3D else -1})
		result["surfaces"] = surfaces
		# Fixed audited 39 KB source only: forensic metadata introspection is not
		# the general picker's bounded API and is never used by the picker.
		var serialized: Array = mesh.get("_surfaces")
		result["serializedSurfaceKeys"] = []
		for item in serialized:
			var lods: Variant = item.get("lods")
			result.serializedSurfaceKeys.append({"keys": item.keys(), "lodType": type_string(typeof(lods)), "lodCount": lods.size() if lods is Array or lods is Dictionary else -1})
	return result
func clean(result: Dictionary, world: Node3D) -> Dictionary:
	var copy := result.duplicate()
	if copy.has("node"):
		copy["nodePath"] = str(world.get_path_to(copy.node))
		copy.erase("node")
	if copy.has("position"): copy.position = str(copy.position)
	if copy.has("normal"): copy.normal = str(copy.normal)
	return copy
func _ready() -> void:
	run.call_deferred()
func run() -> void:
	for tick in range(8): await get_tree().process_frame
	var world := get_tree().current_scene as Node3D
	var player := world.get_node("Player")
	player.input_enabled = false
	player.capture_mouse_on_click = false
	var runtime := get_node("/root/CraftmineRuntime")
	var adapter: RefCounted = runtime.adapter
	var all: Array = []
	var building: StaticBody3D
	var road: StaticBody3D
	for module in get_tree().get_nodes_in_group("kenney_city_modules"):
		if module.MODULE_KIND == "building": building = module
		else: road = module
		for node in module.find_children("*", "MeshInstance3D", true, false): all.append(info(node, world))
	check(building != null and road != null, "formal installed module instances found")
	var original := clean(adapter.mesh_picker.pick(world, world.get_viewport().get_camera_3d(), adapter._helper_exclusions(player, {}), {}), world)
	road.position = Vector3(20, 0, -4)
	road.visible = false
	building.position = Vector3(0, 0, -4)
	var camera := Camera3D.new()
	world.add_child(camera)
	camera.position = Vector3(0, 0.5, 0)
	camera.look_at(Vector3(0, 0.5, -4))
	camera.current = true
	for tick in range(3): await get_tree().physics_frame
	var physics: Dictionary = adapter._ray_hit(camera, player, 4294967295)
	check(not physics.is_empty() and physics.collider == building, "independent building has real center physics hit")
	var alone := clean(adapter.mesh_picker.pick(world, camera, adapter._helper_exclusions(player, {}), physics), world)
	check(alone.status == "fallback" and alone.reason == "unsupported-mesh-type", "legacy fails with road hidden and independent building")
	var primitive := MeshInstance3D.new()
	primitive.mesh = BoxMesh.new()
	primitive.material_override = StandardMaterial3D.new()
	primitive.position = Vector3(0, 0.5, -2)
	world.add_child(primitive)
	building.visible = false
	var box_only := clean(adapter.mesh_picker.pick(world, camera, adapter._helper_exclusions(player, {}), {}), world)
	check(box_only.status == "hit", "same ray and legacy picker can pick the ordinary BoxMesh")
	building.position.x = 20
	building.visible = true
	var off_ray := clean(adapter.mesh_picker.pick(world, camera, adapter._helper_exclusions(player, {}), {}), world)
	check(off_ray.status == "fallback" and off_ray.reason == "unsupported-mesh-type", "off-ray ArrayMesh still globally blocks legacy BoxMesh selection")
	primitive.visible = false
	building.position.x = 0
	var result := {"meshes": all, "original": original, "independentBuilding": alone, "boxControl": box_only, "offRayArrayMesh": off_ray, "checks": checks, "passed": true}
	for item in checks: result.passed = result.passed and item.passed
	print("GLB_PICK_AUDIT=" + JSON.stringify(result))
	JavaScriptBridge.eval("globalThis.__GLB_PICK_AUDIT = " + JSON.stringify(result))
