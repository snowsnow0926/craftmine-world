extends Node
var checks: Array = []
func check(value: bool, name: String) -> void:
	checks.append({"name": name, "passed": value})
func _ready() -> void:
	call_deferred("run_probe")
func run_probe() -> void:
	for tick in range(6):
		await get_tree().process_frame
	var world := get_tree().current_scene
	var player := world.get_node("Player")
	player.input_enabled = false
	player.capture_mouse_on_click = false
	var modules := get_tree().get_nodes_in_group("kenney_city_modules")
	check(modules.size() == __EXPECTED_COUNT__, "expected package instances exist")
	var ids := {}
	var buildings: Array = []
	var roads: Array = []
	for module in modules:
		check(not module.entity_id.is_empty() and not ids.has(module.entity_id), "unique remapped entity ID")
		ids[module.entity_id] = true
		if module.MODULE_KIND == "building":
			buildings.append(module)
		else:
			roads.append(module)
	for index in range(buildings.size()):
		var module = buildings[index]
		module.position = Vector3(-3 + index * 6, 1, 0)
		check(module.configure({"model_scale_percent": 300, "quarter_turns": index % 4}).ok, "configure building")
	for index in range(roads.size()):
		var module = roads[index]
		module.position = Vector3(index * 4, 1, 4)
		check(module.configure({"model_scale_percent": 300}).ok, "configure road")
	check(not buildings.is_empty() and not roads.is_empty(), "building and road both installed")
	if buildings.size() > 1:
		buildings[0].configure({"model_scale_percent": 400, "quarter_turns": 2})
		check(buildings[1].model_scale_percent == 300 and buildings[1].quarter_turns == 1, "second instance parameters remain independent")
	var original_id: String = modules[0].entity_id
	check(not modules[0].configure({"entity_id": "forged"}).ok and modules[0].entity_id == original_id, "parameters cannot rewrite installed identity")
	for tick in range(3):
		await get_tree().physics_frame
	var states: Array = []
	for module in modules:
		check(module.collision_count > 0, "real mesh collision created")
		var ray := PhysicsRayQueryParameters3D.create(module.global_position + Vector3(0.12, 8, 0.1), module.global_position + Vector3(0.12, -0.2, 0.1), 2)
		var hit: Dictionary = world.get_world_3d().direct_space_state.intersect_ray(ray)
		check(not hit.is_empty() and hit.collider == module, "physics ray hits installed module")
		states.append(module.module_state())
	var first = modules[0]
	first.configure({"solid": false})
	await get_tree().physics_frame
	await get_tree().physics_frame
	var disabled_ray := PhysicsRayQueryParameters3D.create(first.global_position + Vector3(0.12, 8, 0.1), first.global_position + Vector3(0.12, -0.2, 0.1), 2)
	var disabled_hit: Dictionary = world.get_world_3d().direct_space_state.intersect_ray(disabled_ray)
	check(disabled_hit.is_empty() or disabled_hit.collider != first, "solid=false changes actual physics")
	first.configure({"solid": true})
	var camera := Camera3D.new()
	world.add_child(camera)
	camera.position = Vector3(12, 10, 16)
	camera.look_at(Vector3(0, 1, 1))
	camera.current = true
	var passed := true
	for item in checks:
		passed = passed and item.passed
	var report := {"passed": passed, "checks": checks, "states": states, "scope": "host-authored fixture semantics; not player acceptance"}
	print("KENNEY_REUSE=" + JSON.stringify(report))
	if OS.has_feature("web"):
		JavaScriptBridge.eval("globalThis.__KENNEY_REUSE = " + JSON.stringify(report))
