extends SceneTree

var checks := []
var config: Dictionary
var runtime: Node
var world: Node

func _initialize() -> void:
	run.call_deferred()

func check(value: bool, label: String) -> void:
	if not value:
		push_error(label)
		quit(1)
		assert(value, label)
	checks.append(label)

func request(op: String, args := {}) -> Dictionary:
	return await runtime.handle_request({"worldId": "vitals-world", "buildId": "vitals-build", "instanceId": config.phase, "op": op, "args": args})

func run() -> void:
	config = JSON.parse_string(FileAccess.get_file_as_string("res://test-config.json"))
	world = load("res://vitals-world.tscn").instantiate()
	root.add_child(world)
	current_scene = world
	runtime = root.get_node("CraftmineRuntime")
	for frame in 300:
		await process_frame
		if runtime.initialized: break
	check(runtime.initialized, "managed sandbox initialized")
	var args := {}
	if config.has("stateFile"): args.snapshot = JSON.parse_string(FileAccess.get_file_as_string(config.stateFile))
	var loaded := await request("load", args)
	check(not loaded.has("error"), "load accepted: " + str(loaded.get("error", "")))
	var vitals := world.get_node("Vitals")
	var player := world.get_node("Player")
	check(vitals.take_damage(5) == 0, "paused damage rejected")
	await request("resume")
	if config.phase == "damaged":
		check(vitals.take_damage(35) == 35 and vitals.health == 65, "live damage applied")
		var before: Dictionary = vitals.snapshot()
		for value in [-1, INF, true, 101]:
			var invalid := before.duplicate(true)
			invalid.health = value
			check(not vitals.restore(invalid).is_empty() and vitals.snapshot() == before, "invalid health rejected atomically")
	elif config.phase == "dead":
		check(vitals.health == 65, "damaged health survived process restart")
		vitals.take_damage(100)
		check(vitals.health == 0 and player.movement_locked(), "death locks player movement")
		var position: Vector3 = player.global_position
		await request("walk", {"forward": 1, "frames": 30})
		check(player.global_position.x == position.x and player.global_position.z == position.z, "dead managed walk returns without horizontal movement")
	else:
		check(vitals.health == 0 and player.movement_locked(), "dead state restores movement lock in new process")
		var other_owner := Node.new()
		world.add_child(other_owner)
		player.set_movement_lock(other_owner, true)
		check(vitals.revive() and player.movement_locked(), "revive does not release another component lock")
		other_owner.queue_free()
		await process_frame
		check(not player.movement_locked(), "freed owner does not leave player stuck")
		var position: Vector3 = player.global_position
		await request("walk", {"right": 1, "frames": 15})
		check(player.global_position.distance_to(position) > 0.01, "revived player moves through real managed command")
		var extra = load("res://components/combat-vitals/scripts/combat_vitals.gd").new()
		extra.entity_id = "duplicate-vitals"
		world.add_child(extra)
		check((await request("snapshot")).has("error"), "duplicate player vitals cannot be saved")
		extra.queue_free()
		await process_frame
	await request("pause")
	var saved := await request("save")
	check(not saved.has("error"), "managed component save accepted: " + str(saved.get("error", "")))
	var saved_file := FileAccess.open(config.saveFile, FileAccess.WRITE)
	saved_file.store_string(saved.result.runnerReceipt.snapshotText)
	saved_file.close()
	print("COMBAT_VITALS=" + JSON.stringify({"phase": config.phase, "checks": checks, "snapshot": saved.result.snapshot.state}))
	quit()
