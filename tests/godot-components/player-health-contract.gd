extends SceneTree

var checks: Array[String] = []

func _initialize() -> void:
	run.call_deferred()

func check(condition: bool, label: String) -> void:
	if not condition:
		push_error(label)
		quit(1)
	checks.append(label)

func run() -> void:
	var world = load("res://scenes/training_range.tscn").instantiate()
	root.add_child(world)
	current_scene = world
	var player = world.player
	player.input_enabled = false
	player.capture_mouse_on_click = false
	for frame in 5:
		await physics_frame
	player.take_damage(35.0)
	var saved: Dictionary = player.snapshot()
	for patch in [{"health": -1}, {"health": INF}, {"health": true}, {"health": 101}, {"maxHealth": 200}, {"maxHealth": 0}, {"maxHealth": "100"}]:
		var invalid := saved.duplicate(true)
		invalid.merge(patch, true)
		invalid.position[0] = 8.0
		check(not player.restore(invalid).is_empty(), "invalid health fields rejected: " + str(patch))
		check(player.snapshot() == saved, "invalid restore leaves pose and health unchanged: " + str(patch))
	for key in ["health", "maxHealth"]:
		var incomplete := saved.duplicate(true)
		incomplete.erase(key)
		check(not player.restore(incomplete).is_empty(), "unpaired field rejected: " + key)
		check(player.snapshot() == saved, "unpaired restore unchanged: " + key)
	var legacy := saved.duplicate(true)
	legacy.erase("health")
	legacy.erase("maxHealth")
	check(player.restore(legacy).is_empty() and player.health == 100.0, "legacy restore resets damaged player to full health")
	player.take_damage(100.0)
	var dead_position: Vector3 = player.global_position
	await player.walk(Vector2(1, 0), 30)
	check(player.global_position == dead_position, "dead walk returns without moving")
	player.velocity = Vector3(8, 0, 8)
	await physics_frame
	await physics_frame
	check(player.velocity.x == 0.0 and player.velocity.z == 0.0, "dead physics removes horizontal momentum")
	player.revive()
	kill_during_walk(player)
	await player.walk(Vector2(1, 0), 60)
	check(player.dead and player._override_remaining == 0, "death during walk cancels pending movement")
	player.revive()
	var before: Vector3 = player.global_position
	await player.walk(Vector2(1, 0), 10)
	check(player.global_position.distance_to(before) > 0.01, "revived player can move again")
	print("CRAFTMINE_HEALTH_CONTRACT=" + JSON.stringify({"checks": checks}))
	quit()

func kill_during_walk(player) -> void:
	for frame in 3:
		await physics_frame
	player.take_damage(100.0)
