extends SceneTree

var config: Dictionary
var runtime: Node
var world: Node3D
var checks := []

func _initialize() -> void:
	run.call_deferred()

func check(value: bool, label: String) -> void:
	if not value:
		push_error(label)
		quit(1)
		assert(value, label)
	checks.append(label)

func request(op: String, args := {}) -> Dictionary:
	var reply: Dictionary = await runtime.handle_request({"op": op, "args": args, "worldId": "combat-world", "buildId": "combat-build", "instanceId": config.phase})
	check(not reply.has("error"), op + " accepted: " + str(reply.get("error", "")))
	return reply.result

func aim(target: Node3D) -> void:
	var camera: Camera3D = world.get_node("Player/CameraRig/PitchPivot/Camera3D")
	var offset: Vector3 = target.get_node("CollisionShape3D").global_position - camera.global_position
	await request("look", {"yaw": atan2(-offset.x, -offset.z), "pitch": atan2(offset.y, Vector2(offset.x, offset.z).length())})

func run() -> void:
	config = JSON.parse_string(FileAccess.get_file_as_string("res://combat-config.json"))
	world = load("res://combat-world.tscn").instantiate()
	root.add_child(world)
	current_scene = world
	runtime = root.get_node("CraftmineRuntime")
	for frame in 300:
		await process_frame
		if runtime.initialized: break
	check(runtime.initialized, "managed combat runtime ready")
	var args := {}
	if config.has("stateFile"): args.snapshot = JSON.parse_string(FileAccess.get_file_as_string(config.stateFile))
	var loaded := await request("load", args)
	var vitals := world.get_node("Vitals")
	var weapon := world.get_node("Weapon")
	var monster := world.get_node("Monster")
	var pet := world.get_node("Pet")
	check(weapon._visual != null and weapon._visual.get_child_count() == 3, "weapon visual initialized in actual world")
	if config.phase == "reopen":
		check(loaded.snapshot.state.body.inventory.get("monster-token", 0) == 1 and loaded.snapshot.state.body.components["player-weapon"].ammo == 9, "cold process restores saved combat state")
		check(monster.health == 0 and monster.loot_taken, "dead monster and collected reward restored")
		check(weapon.ammo == 9 and weapon.shots_fired == 3, "weapon ammunition and shots restored")
		check(pet.snapshot().interactionCount == 0, "pet state retained independently")
		await request("resume")
		await aim(monster)
		check(not (await request("interact")).interacted, "cold restart cannot duplicate loot")
	else:
		await request("resume")
		await request("wait", {"frames": 90})
		check(monster.global_position.z > 2.4, "monster approaches through real CharacterBody physics")
		check(vitals.health < 100 and vitals.health > 0, "monster damages actual sandbox player")
		await aim(monster)
		var shot := await request("attack")
		check(shot.fired and shot.targetId == "monster-one" and shot.damage == 20, "managed attack hits actual monster")
		var blocked := await request("attack")
		check(not blocked.fired and blocked.reason == "cooldown", "immediate second shot blocked")
		await request("wait", {"frames": 24})
		await aim(monster)
		check((await request("attack")).damage == 20, "second cooled shot damages monster")
		await request("wait", {"frames": 24})
		await aim(monster)
		check((await request("attack")).damage == 20 and monster.health == 0, "third actual shot defeats monster")
		var pet_before: Dictionary = pet.snapshot()
		await aim(monster)
		var reward := await request("interact")
		check(reward.interacted and world.inventory.get("monster-token") == 1, "real reticle interaction awards loot")
		check(not (await request("interact")).interacted and world.inventory.get("monster-token") == 1, "repeat interaction cannot duplicate reward")
		check(pet.snapshot() == pet_before, "combat and loot leave existing pet unchanged")
		await request("pause")
		var before: Dictionary = (await request("snapshot")).state
		var invalid := before.duplicate(true)
		invalid.body.components["monster-one"].position = [0, 0, 6]
		var rejected: Dictionary = await runtime.handle_request({"op": "restore-state", "args": {"state": invalid}, "worldId": "combat-world", "buildId": "combat-build", "instanceId": config.phase})
		check(rejected.has("error"), "restore into player collision rejected")
		check((await request("snapshot")).state == before, "invalid placement rolls back all components and player")
	await request("pause")
	var saved := await request("save")
	var file := FileAccess.open(config.saveFile, FileAccess.WRITE)
	file.store_string(saved.runnerReceipt.snapshotText)
	file.close()
	print("SANDBOX_COMBAT=" + JSON.stringify({"checks": checks, "state": saved.snapshot.state}))
	quit()
