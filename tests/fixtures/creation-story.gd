extends SceneTree

var bridge: Node
var world: Node
var commands := []
var checks := []
var build_id := "story-build"

func _initialize() -> void:
	_run.call_deferred()

func require_ok(condition: bool, message: String) -> void:
	checks.append({"name": message, "passed": condition})
	if not condition:
		push_error(message)
		quit(1)
		assert(condition, message)

func request(op: String, args := {}) -> Dictionary:
	var response: Dictionary = await bridge.handle_request({"op": op, "worldId": "creation-story", "buildId": build_id, "instanceId": "story-instance", "args": args})
	commands.append({"op": op, "args": args, "response": response})
	require_ok(not response.has("error"), op + ": " + str(response))
	return response.get("result", {})

func aim(id: String) -> void:
	var node: Node3D = world.entity_nodes[id]
	var eye: Vector3 = world.player.camera_rig.camera.global_position
	var point: Vector3 = node.global_position + Vector3(0, 0.65, 0)
	var delta := point - eye
	await request("look", {"yaw": atan2(-delta.x, -delta.z), "pitch": atan2(delta.y, Vector2(delta.x, delta.z).length())})
	await physics_frame
	require_ok(world.refresh_target().entityId == id, "Ray must hit actual entity: " + id + "; actual: " + str(world.target))

func interact(id: String) -> Dictionary:
	await aim(id)
	return await request("interact")

func _run() -> void:
	change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
	await process_frame
	bridge = root.get_node("CraftmineRuntime")
	for _frame in range(300):
		if bridge.initialized:
			break
		await process_frame
	world = current_scene
	require_ok(bridge.initialized, "Runtime must initialize")
	require_ok(DisplayServer.get_name() == "headless", "Test requires headless display")
	require_ok(not world.player.capture_mouse_on_click, "Headless player must disable mouse capture")
	var config: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://story-config.json"))
	build_id = config.get("buildId", "story-build")
	var before: Dictionary = await request("load", {"snapshot": config.get("restore")})
	var restored: Dictionary = before.snapshot.state
	await request("resume")
	await request("wait", {"frames": 20})
	match config.stage:
		"blank":
			await request("look", {"yaw": 0, "pitch": -0.6})
			await physics_frame
			require_ok(world.refresh_target().surface == "ground", "Blank world must yield actual ground ray")
		"tree", "enlarged":
			await aim("story-tree")
			require_ok(world.entity_nodes["story-tree"].scale.y == (2.0 if config.stage == "enlarged" else 1.0), "Authored tree size must reach real scene node")
		"play":
			var opened := await interact("story-chest")
			require_ok(opened.interacted, "Chest must open through real ray interaction")
			var duplicate := await interact("story-chest")
			require_ok(not duplicate.interacted and duplicate.reason == "already-opened", "Chest must only reward once")
			await interact("marker-b")
			require_ok(not world.doors["story-door"], "Wrong marker must keep door closed")
			await interact("marker-a")
			require_ok(not world.doors["story-door"], "Partial sequence must keep door closed")
			await interact("marker-b")
			require_ok(world.doors["story-door"], "Authored sequence must open door")
			await request("wait", {"frames": 2})
			require_ok(world.entity_nodes["story-door"].get_node("Body").get_child(0).disabled, "Open door must remove real collision")
			await request("set-time", {"hours": 21})
			var start: Vector3 = world.player.position
			await request("look", {"yaw": 0, "pitch": 0})
			await request("walk", {"right": 1, "forward": 0, "frames": 15})
			await request("wait", {"frames": 30})
			require_ok(world.player.position.distance_to(start) > 0.2, "Ordinary player controller must move physically")
		"reopen":
			require_ok(world.inventory.get("story-token", 0) == 2, "Inventory must survive restart")
			require_ok(world.opened_chests.get("story-chest", false), "Chest ledger must survive restart")
			require_ok(world.doors.get("story-door", false), "Door state must survive restart")
			require_ok(world.capture().rules["story-rule"].completed, "Rule completion must survive restart")
			require_ok(world.time_of_day == 21.0, "Time must survive restart")
			var duplicate := await interact("story-chest")
			require_ok(not duplicate.interacted and duplicate.reason == "already-opened", "Restart must not duplicate reward")
		"continued":
			require_ok(world.entities.has("later-rock"), "New source object must exist after continued creation")
			require_ok(world.inventory.get("story-token", 0) == 2 and world.opened_chests.get("story-chest", false), "Continued creation must preserve old reward ledger")
			require_ok(world.doors.get("story-door", false) and world.capture().rules["story-rule"].completed, "Continued creation must preserve completed old gameplay")
			require_ok(not world.doors.get("later-door", true) and not world.capture().rules["later-rule"].completed, "New door and rule must use fresh defaults")
			require_ok(world.time_of_day == 18.0 and world.capture().sourceTimeOfDay == 18.0, "Source time edit must apply during additive migration")
	await request("pause")
	if config.stage in ["play", "reopen"]:
		var original: Dictionary = world.capture()
		for mutation in ["unknown", "inventory", "missing-door", "missing-rule"]:
			var invalid: Dictionary = original.duplicate(true)
			match mutation:
				"unknown": invalid["unknown"] = true
				"inventory": invalid.inventory["story-token"] = -1
				"missing-door": invalid.doors.erase("story-door")
				"missing-rule": invalid.rules.erase("story-rule")
			require_ok(not world.restore(invalid).is_empty(), "Invalid restore must reject: " + mutation)
			require_ok(world.capture() == original, "Rejected restore must not mutate: " + mutation)
	var observation := await request("observe")
	var saved := await request("save")
	var result := {"stage": config.stage, "headless": true, "sampledAt": Time.get_datetime_string_from_system(true) + "Z", "restored": restored, "observation": observation, "saved": saved, "commands": commands, "checks": checks}
	print("CRAFTMINE_CREATION_STORY=" + JSON.stringify(result))
	quit(0)
