extends Node
var checks := []
func check(value: bool, label: String) -> void:
	checks.append({"passed": value, "label": label})
func _ready() -> void:
	run.call_deferred()
func run() -> void:
	var runtime := get_node("/root/CraftmineRuntime")
	while not runtime.loaded: await get_tree().process_frame
	for tick in range(8): await get_tree().physics_frame
	var world := get_tree().current_scene
	world.player.input_enabled = false
	world.player.capture_mouse_on_click = false
	var first: StaticBody3D
	for module in get_tree().get_nodes_in_group("kenney_city_modules"):
		if module.MODULE_KIND == "building": first = module
	check(first != null, "formally installed building found")
	first.position = Vector3(0,0,-4)
	var original_id: String = first.entity_id
	var original_state: Dictionary = first.module_state()
	var packed: PackedScene = load("res://addons/kenney-city-building/module.tscn")
	var second := packed.instantiate()
	second.entity_id = "audit-peer"
	world.add_child(second)
	second.position = Vector3(5,0,-4)
	var peer_before: Dictionary = second.module_state()
	var mesh_first: Mesh = first.get_node("Visual/building-small-a").mesh
	var mesh_second: Mesh = second.get_node("Visual/building-small-a").mesh
	var configured: Dictionary = first.configure({"model_scale_percent":250,"quarter_turns":1,"solid":false,"label":"runtime-only-audit"})
	check(mesh_first == mesh_second and first.get_node("Visual/building-small-a").mesh == mesh_first and second.get_node("Visual/building-small-a").mesh == mesh_second, "instances share imported Mesh and configure preserves resource identity")
	check(configured.ok, "ordinary configure changes only the selected runtime instance")
	check(second.module_state() == peer_before, "peer instance parameters remain unchanged")
	for tick in range(3): await get_tree().physics_frame
	var disabled := true
	for child in first.get_children():
		if child is CollisionShape3D: disabled = disabled and child.disabled
	check(disabled and first.collision_count > 0, "selected instance has real disabled collision shapes")
	var snapshot: Dictionary = runtime.adapter.capture()
	check(not JSON.stringify(snapshot).contains("runtime-only-audit") and not snapshot.has("modules"), "normal base snapshot does not contain module configuration")
	var restored: String = runtime.adapter.restore(snapshot)
	check(restored.is_empty(), "ordinary same-instance snapshot restore succeeds")
	check(first.model_scale_percent == 250 and first.label == "runtime-only-audit", "same-instance restore leaves unsaved module configuration in memory")
	var old_object := str(first.get_instance_id())
	world.remove_child(first)
	first.free()
	var fresh := packed.instantiate()
	fresh.entity_id = original_id
	world.add_child(fresh)
	fresh.position = Vector3(0,0,-4)
	var fresh_state: Dictionary = fresh.module_state()
	check(fresh_state == original_state, "fresh instance from unchanged scene returns to authored defaults")
	check(str(fresh.get_instance_id()) != old_object, "fresh node has new runtime identity with the same explicit entity_id")
	check(runtime.adapter.restore(snapshot).is_empty(), "normal snapshot can restore after replacing the module")
	check(fresh.model_scale_percent == 100 and fresh.quarter_turns == 0 and fresh.solid and fresh.label == "building", "saved snapshot does not recover previous runtime-only module values")
	var camera := Camera3D.new()
	world.add_child(camera)
	camera.position = Vector3(0,0.5,0)
	camera.current = true
	var result := {"passed":true,"checks":checks,"before":original_state,"configured":configured.state,"peer":peer_before,"fresh":fresh_state,"snapshotKeys":snapshot.keys(),"scope":"derivative LPAC runtime reconstruction diagnostic, not a cold app reopen or player acceptance"}
	for item in checks: result.passed = result.passed and item.passed
	print("MODULE_PERSISTENCE_AUDIT=" + JSON.stringify(result))
	JavaScriptBridge.eval("globalThis.__MODULE_PERSISTENCE_AUDIT = " + JSON.stringify(result))
