extends SceneTree

# This trusted harness only loads a fixture and invokes the fixed adapter.
# It never writes player positions, inventory or door state during play.
func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var config: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://scenario.json"))
	var scene = load("res://scenes/creation.tscn").instantiate()
	root.add_child(scene)
	current_scene = scene
	if not scene.ready_for_play:
		push_error("Scenario fixture failed: " + scene.failure)
		quit(1)
		return
	var adapter = load("res://craftmine_shared/base_adapter.gd").new()
	adapter.bind_world(config.identity.worldId)
	var transcript: Dictionary = {"format":"craftmine.godot-scenario-transcript/1", "identity":config.identity, "fixtureRef":config.plan.fixtureRef, "requirementsHash":config.requirementsHash, "steps":[]}
	for action in config.plan.steps:
		var response: Dictionary = await adapter.command(action.op, action.args)
		# Commands can finish just before the next actual physics callback. Sampling
		# after a frame records settled collision changes, not assumed mutations.
		await physics_frame
		await process_frame
		var actual: Dictionary = adapter.observe()
		var door: Dictionary = {}
		for entity in actual.get("creation", {}).get("entities", []):
			if entity.id == "gate": door = entity
		var pose: Vector3 = scene.player.global_position
		var observation := {"playerPosition":[pose.x, pose.y, pose.z], "door":{"reportedOpen":scene.doors.get("gate", false), "observedSolid":door.get("solid"), "observedOpen":door.get("open")}}
		if action.op == "interact":
			observation.interacted = response.get("result", {}).get("interacted")
			observation.entityId = response.get("result", {}).get("entityId")
		transcript.steps.append({"action":action, "identity":config.identity, "requirementsHash":config.requirementsHash, "physicsTick":scene.physics_tick, "ok":not response.has("error"), "observation":observation})
	print("SCENARIO_TRANSCRIPT=" + JSON.stringify(transcript))
	quit()
