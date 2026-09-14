extends SceneTree

const Pom = preload("res://pom-v3.gd")
const Pet = preload("res://pet-v3.gd")
const OldPom = preload("res://pom-v2.gd")
const OldPet = preload("res://pet-v2.gd")
var checks: Array[String] = []
var failed := false
var stage: Node3D

func verify(ok: bool, label: String) -> void:
	if ok:
		checks.append(label)
	else:
		failed = true
		push_error(label)

func _initialize() -> void:
	_run.call_deferred()

func pet(script: Script, identity: String, x: float) -> CharacterBody3D:
	var node := CharacterBody3D.new()
	node.set_script(script)
	node.entity_id = identity
	node.companion_name = "Snow"
	node.position = Vector3(x, 0, -20)
	stage.add_child(node)
	node.set_physics_process(false)
	return node

func city_bounds(node: Node) -> void:
	node.saved_position_min = Vector3(-240, -20, -300)
	node.saved_position_max = Vector3(240, 160, 80)

func _run() -> void:
	stage = Node3D.new()
	root.add_child(stage)
	current_scene = stage
	var floor_body := StaticBody3D.new()
	var floor_shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(800, 1, 800)
	floor_shape.shape = box
	floor_body.position = Vector3(0, -0.5, -120)
	floor_body.add_child(floor_shape)
	stage.add_child(floor_body)
	var player := Node3D.new()
	player.name = "Player"
	stage.add_child(player)
	await physics_frame
	var nodes := [pet(Pom, "snow-pom", -10), pet(Pet, "snow-pet", 10)]
	var writing := OS.get_cmdline_user_args().has("write")
	var saved: Dictionary = {}
	if not writing:
		saved = JSON.parse_string(FileAccess.get_file_as_string("user://companion-state.json"))
	for index in nodes.size():
		var node: CharacterBody3D = nodes[index]
		city_bounds(node)
		var identity: String = node.entity_id
		if writing:
			node.global_position = Vector3(-10 if index == 0 else 10, -0.0001868, -200)
			node.set_following(false)
			node._interaction_count = 7
			var state: Dictionary = node.snapshot()
			verify(node.validate_state(state) == "", identity + ": city position beyond old -80 remains valid")
			var collision_result: String = node.validate_restored_state()
			verify(collision_result == "", identity + ": 0.1868mm ground contact retains own shape validation: " + collision_result)
			saved[identity] = state
		else:
			verify(node.restore(saved[identity]) == "", identity + ": cold process restores same-format city state")
			verify(node.snapshot() == saved[identity], identity + ": all identity settings position yaw and counters survive exactly")
			verify(node.validate_restored_state() == "", identity + ": cold process own collider validation passes")
		var before: Dictionary = node.snapshot()
		for bad in [NAN, INF, -INF, "0", null]:
			var state: Dictionary = before.duplicate(true)
			state.position[2] = bad
			verify(node.validate_state(state) == "PET_STATE_POSITION_INVALID", identity + ": rejects nonfinite or nonnumeric coordinate " + str(bad))
		for point in [[241, 0, -200], [0, -21, -200], [0, 161, -200], [0, 0, -301], [0, 0, 81]]:
			var state: Dictionary = before.duplicate(true)
			state.position = point
			verify(node.validate_state(state) == "PET_STATE_POSITION_INVALID", identity + ": respects actual city bounds " + str(point))
		for field in ["yaw", "interactionCount"]:
			for bad in [NAN, INF, -INF, 1000000, -1000000, "0"]:
				var state: Dictionary = before.duplicate(true)
				state[field] = bad
				verify(node.validate_state(state) == "PET_STATE_VALUE_INVALID", identity + ": large-city position does not bypass " + field)
		verify(node.snapshot() == before, identity + ": validation never modifies live state or clamps the foot position")
		var fraction: Dictionary = before.duplicate(true)
		fraction.interactionCount = 0.5
		verify(node.validate_state(fraction) == "PET_STATE_VALUE_INVALID", identity + ": fractional interaction count remains rejected")
		var changed_identity: Dictionary = before.duplicate(true)
		changed_identity.entityId = "foreign"
		verify(node.validate_state(changed_identity) == "PET_STATE_IDENTITY_INVALID", identity + ": wrong identity remains rejected")
		var changed_source: Dictionary = before.duplicate(true)
		changed_source.sourceSettings.name = "Other"
		verify(node.validate_state(changed_source) == "PET_SOURCE_SETTINGS_CHANGED", identity + ": sourceSettings migration still requires the normal host path")
		node.saved_position_min = Vector3(-32, 0, -32)
		node.saved_position_max = Vector3(32, 32, 32)
		for y in [-0.0001868, -0.0019]:
			var state: Dictionary = before.duplicate(true)
			state.position = [0, y, 0]
			verify(node.validate_state(state) == "", identity + ": sandbox accepts bounded vertical contact roundoff")
		for point in [[40, 0, 0], [0, -0.0021, 0], [0, 0, 40]]:
			var state: Dictionary = before.duplicate(true)
			state.position = point
			verify(node.validate_state(state) == "PET_STATE_POSITION_INVALID", identity + ": old ±80 region cannot bypass tighter receiving-world bounds")
		node.saved_position_min.x = -INF
		verify(node.validate_state(before) == "PET_STATE_BOUNDS_INVALID", identity + ": nonfinite source bounds rejected")
		city_bounds(node)
		var blocker := pet(Pom, "blocker-" + identity, node.global_position.x)
		blocker.global_position = node.global_position
		verify(node.validate_restored_state() == "PET_RESTORE_OVERLAP", identity + ": real companion-shape overlap remains rejected")
		stage.remove_child(blocker)
		blocker.queue_free()
		var old := pet(OldPom if index == 0 else OldPet, identity, -30 if index == 0 else 30)
		old.set_following(false)
		old._interaction_count = 13
		var old_state: Dictionary = old.snapshot()
		verify(node.restore(old_state) == "", identity + ": released v2 state restores without new fields")
		verify(node.snapshot() == old_state, identity + ": v2 sourceSettings runtime settings and identity unchanged")
		old.queue_free()
	if writing:
		var file := FileAccess.open("user://companion-state.json", FileAccess.WRITE)
		file.store_string(JSON.stringify(saved))
		file.close()
	print("COMPANION_BOUNDS_TEST=" + JSON.stringify({"ok": not failed, "checks": checks, "mode": "write" if writing else "read", "headless": DisplayServer.get_name() == "headless"}))
	quit(1 if failed else 0)
