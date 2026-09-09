extends SceneTree
var runtime: Node
func _initialize() -> void:
	call_deferred("run")
func run() -> void:
	change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
	for _frame in range(15):
		await process_frame
	runtime = root.get_node("CraftmineRuntime")
	var cases: Array = JSON.parse_string(FileAccess.get_file_as_string("res://requests.json"))
	var results := []
	var saved_receipt := {}
	for request in cases:
		if request.get("fixture") == "ack":
			var receipt := saved_receipt.duplicate(true)
			receipt.format = "craftmine.godot-progress-receipt/1"
			receipt.merge(request.get("override", {}), true)
			results.append(await runtime.handle_request({"worldId": saved_receipt.worldId, "buildId": saved_receipt.buildId, "instanceId": saved_receipt.instanceId, "op": "acknowledge", "args": {"receipt": receipt}}))
			continue
		if request.get("fixture") == "damage":
			var host = root.get_node("SideView")
			host.player.take_damage(1, "headless-save-test")
			for target in host.room_manager.current_room.get_children():
				if target.has_method("receive_hit"):
					target.receive_hit(1, 1)
					break
			results.append({"fixture": "damage"})
			continue
		var result: Dictionary = await runtime.handle_request(request)
		if request.get("op") == "save" and result.has("result"):
			saved_receipt = result.result.runnerReceipt
		results.append(result)
	print("MANAGED_RESULTS=" + JSON.stringify(results))
	quit()
