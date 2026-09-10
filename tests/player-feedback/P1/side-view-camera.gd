extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func request(runtime: Node, op: String, args: Dictionary = {}) -> Dictionary:
	return await runtime.handle_request({"worldId": "camera-restore-test", "buildId": "camera-build", "instanceId": "camera-instance", "op": op, "args": args})

func run() -> void:
	change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
	for _frame in range(15):
		await process_frame
	var runtime := root.get_node("CraftmineRuntime")
	var host := root.get_node("SideView")
	var checks := []
	var loaded: Dictionary = await request(runtime, "load", {"snapshot": null})
	checks.append({"name": "managed initial load", "passed": not loaded.has("error"), "result": loaded})
	var snapshot: Dictionary = (await request(runtime, "snapshot")).result.state
	for point in [Vector2(589.4258, 439.924), Vector2(143.5, 440.0)]:
		var body: Dictionary = snapshot.duplicate(true)
		body.body.player = {"room": "ruins", "x": point.x, "y": point.y, "facing": -1}
		var restored: Dictionary = await request(runtime, "restore-state", {"state": body})
		var camera: Camera2D = host.player.camera
		var actual := camera.get_screen_center_position()
		var before: Dictionary = (await request(runtime, "snapshot")).result.state
		# Compare immediate paused positioning with the engine's settled target.
		camera.reset_smoothing()
		camera.force_update_scroll()
		var expected := camera.get_screen_center_position()
		var after: Dictionary = (await request(runtime, "snapshot")).result.state
		checks.append({"name": "paused restore immediately settles camera", "passed": not restored.has("error") and paused and camera.position_smoothing_enabled and actual.distance_to(expected) < 0.1, "actual": [actual.x, actual.y], "expected": [expected.x, expected.y], "restore": restored})
		checks.append({"name": "camera settling preserves complete native progress", "passed": before == after, "before": before, "after": after})
	print("CAMERA_RESULT=" + JSON.stringify({"checks": checks}))
	quit()
