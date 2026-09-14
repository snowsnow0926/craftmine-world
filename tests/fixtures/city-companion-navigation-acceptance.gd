extends SceneTree
## Deterministic engine regression using a copy of the real exported world and
## its ordinary saved-state adapter. No model, OS input or gameplay claim.

var checks: Array = []
var failures: Array = []

func _initialize() -> void:
	call_deferred("run")

func check(label: String, passed: bool) -> void:
	checks.append({"name": label, "passed": passed})
	if not passed: failures.append(label)

func run() -> void:
	var cold := "--cold" in OS.get_cmdline_user_args()
	var scene = load("res://scenes/creation.tscn").instantiate()
	root.add_child(scene)
	current_scene = scene
	var runtime = root.get_node("CraftmineRuntime")
	var state = JSON.parse_string(FileAccess.get_file_as_string("res://navigation-cold.json" if cold else "res://navigation-initial.json"))
	for frame in 5: await physics_frame
	runtime.adapter.bind_world(state.worldId)
	var problem: String = await runtime.adapter.restore(state.body)
	check("ordinary saved-state restore accepted", problem.is_empty())
	if not problem.is_empty():
		finish(cold, {"restoreError": problem})
		return
	# Compare the JSON wire state, as the production transport does. Vector3
	# float32 values can have extra in-memory digits beyond their JSON form.
	var restored: Dictionary = JSON.parse_string(JSON.stringify(runtime.adapter.capture()))
	print("RESTORE_DIFFERENCES ", JSON.stringify(differences(state.body, restored)))
	check("restore preserves the complete saved state", differences(state.body, restored).is_empty())
	if cold:
		finish(true, {"restoreError": problem})
		return
	var dog = scene.get_node("pet-xueqiu")
	var original: Dictionary = runtime.adapter.capture().duplicate(true)
	var previous: Vector3 = dog.global_position
	var max_step := 0.0
	var route_samples: Array = []
	paused = false
	for frame in 3000:
		await physics_frame
		max_step = maxf(max_step, dog.global_position.distance_to(previous))
		previous = dog.global_position
		if frame % 120 == 0:
			route_samples.append({"frame": frame, "position": [previous.x, previous.y, previous.z]})
	paused = true
	var after: Dictionary = runtime.adapter.capture()
	check("capture accepts all components", runtime.adapter.capture_error().is_empty())
	check("companion physically arrives near the player", dog.global_position.distance_to(scene.player.global_position) < 2.5)
	check("companion reaches the upper ramp", dog.global_position.y > 8.5)
	check("continuous physical movement has no teleport", max_step < 0.12)
	var placement: String = dog.validate_restored_state()
	print("ARRIVAL_PLACEMENT ", placement)
	print("ARRIVAL_BASIS ", dog._shape.global_basis, " upright=", dog._upright_unit(dog._shape.global_transform))
	for peer in get_nodes_in_group("craftmine_persistent_components"):
		if peer is PhysicsBody3D: print("PEER_BASIS ", peer.name, " ", peer.global_basis)
	check("arrival still validates actual collision placement", placement.is_empty())
	for field in ["inventory", "openedChests", "player", "doors", "rules"]:
		check("preserves " + field, after[field] == original[field])
	for id in ["pet-xueqiu", "ins-9838fd1f5409fd8ae4b39b7d-e0"]:
		for field in ["entityId", "settings", "sourceSettings", "interactionCount"]:
			check("preserves " + id + " " + field, after.components[id][field] == original.components[id][field])
	check("waiting companion stays in place", after.components["ins-9838fd1f5409fd8ae4b39b7d-e0"].position == original.components["ins-9838fd1f5409fd8ae4b39b7d-e0"].position)
	state.body = after
	var saved := FileAccess.open("res://navigation-cold.json", FileAccess.WRITE)
	saved.store_string(JSON.stringify(state))
	saved.close()
	finish(false, {"maxStep": max_step, "routeSamples": route_samples})

func finish(cold: bool, detail: Dictionary) -> void:
	var report := {"role": "deterministic-engine-regression", "cold": cold, "checks": checks, "failures": failures, "detail": detail}
	var file := FileAccess.open("res://navigation-cold-report.json" if cold else "res://navigation-report.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(report, "\t"))
	file.close()
	print("NAVIGATION_ACCEPTANCE ", JSON.stringify({"cold":cold,"checks":checks.size(),"failures":failures}))
	quit(0 if failures.is_empty() else 1)

func differences(before: Variant, after: Variant, prefix: String = "") -> Array:
	var result: Array = []
	if before is Dictionary and after is Dictionary:
		for key in before:
			if not after.has(key): result.append(prefix + "/" + str(key) + ":missing")
			else: result.append_array(differences(before[key], after[key], prefix + "/" + str(key)))
		for key in after:
			if not before.has(key): result.append(prefix + "/" + str(key) + ":added")
	elif before is Array and after is Array:
		if before.size() != after.size(): result.append(prefix + ":size")
		else:
			for index in before.size(): result.append_array(differences(before[index], after[index], prefix + "/" + str(index)))
	elif before != after:
		result.append(prefix)
	return result
