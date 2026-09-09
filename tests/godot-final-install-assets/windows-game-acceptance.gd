extends Node

# This authored acceptance script is deliberately inert during ordinary play.
# It uses real base operations and save APIs; it never requests mouse capture.
func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if "--craftmine-write" in OS.get_cmdline_user_args() or "--craftmine-read" in OS.get_cmdline_user_args():
		run_acceptance.call_deferred()

func fail(message: String) -> void:
	printerr("USER_GAME_FAILURE: " + message)
	get_tree().quit(2)

func run_acceptance() -> void:
	if DisplayServer.get_name() != "headless":
		fail("Acceptance requires headless display")
		return
	await get_tree().process_frame
	var world = get_tree().current_scene
	if world == null or world.world_state == null:
		fail("World was not loaded")
		return
	world.set_world_id("standalone-acceptance")
	get_tree().paused = true
	if "--craftmine-write" in OS.get_cmdline_user_args():
		var result: Dictionary = await BaseOps.new(world).execute("equip", {"value": "practice_sword"})
		if result.has("error"):
			fail(str(result.error))
			return
		var problem: String = world.quicksave()
		if not problem.is_empty():
			fail(problem)
			return
	var loaded: Dictionary = world.save_store.load_state()
	if loaded.has("error"):
		fail(str(loaded.error))
		return
	var failure: String = world.world_state.apply(loaded.state)
	if not failure.is_empty():
		fail(failure)
		return
	var restored: Dictionary = world.world_state.capture()
	# Compare the persisted JSON representation: native integers and parsed JSON
	# numbers have different Variant types. Keep every field and exact JSON value.
	if JSON.parse_string(JSON.stringify(restored)) != loaded.state:
		print("USER_GAME_EXPECTED=" + JSON.stringify(loaded.state))
		print("USER_GAME_ACTUAL=" + JSON.stringify(restored))
		fail("Full native state changed after restore")
		return
	print("USER_GAME_STATE=" + JSON.stringify(restored))
	print("USER_GAME_USER_DIR=" + OS.get_user_data_dir())
	get_tree().quit(0)
