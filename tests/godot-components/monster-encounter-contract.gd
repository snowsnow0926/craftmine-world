extends SceneTree

var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func check(ok: bool, message: String) -> void:
	if not ok:
		failures.append(message)

func _run() -> void:
	var world := load("res://scenes/training_range.tscn").instantiate() as BaseWorld
	root.add_child(world)
	await process_frame
	await physics_frame
	var monster := load("res://scenes/actors/monster_encounter.tscn").instantiate() as MonsterEncounter
	monster.position = Vector3(0, 0, 0)
	world.get_node("Targets").add_child(monster)
	await process_frame
	var inventory := world.inventory
	var player := world.player
	player.position = Vector3(0, 0.9, 2)
	monster.apply_damage(60)
	inventory.capacity = 1
	var before := inventory.snapshot()
	var first := monster.interact()
	var second := monster.interact()
	check(not bool(first.get("handled", false)) and not bool(second.get("handled", false)), "容量不足两次领取都必须拒绝")
	check(inventory.snapshot() == before, "容量不足不能改变库存")
	inventory.remove(&"repair_kit", 1)
	inventory.capacity = 2
	var third := monster.interact()
	check(bool(third.get("handled", false)) and third.get("items", []).size() == 2, "腾出容量后只能一次性领取全部掉落")
	var wall := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new(); box.size = Vector3(3, 3, 0.4)
	shape.shape = box; wall.add_child(shape); wall.position = Vector3(0, 1.5, 1); world.add_child(wall)
	monster.respawn(); player.position = Vector3(0, 0.9, 2); var hp := player.health
	await physics_frame; await physics_frame
	check(is_equal_approx(player.health, hp), "挡墙存在时怪物不能隔墙伤害玩家")
	w_all_free(wall)
	await physics_frame; await physics_frame
	check(player.health < hp, "移除挡墙后近距攻击应真实扣血")
	monster.attack_remaining = monster.attack_cooldown
	var saved := monster.snapshot(); monster.attack_remaining = 0.0
	var restore_error := monster.restore(saved)
	check(restore_error.is_empty() and is_equal_approx(monster.attack_remaining, float(saved.attackRemaining)), "非零攻击冷却应随快照恢复")
	if failures.is_empty():
		print("MONSTER_ENCOUNTER_CONTRACT=PASS")
	else:
		for failure in failures: printerr(failure)
		print("MONSTER_ENCOUNTER_CONTRACT=FAIL")
	quit(0 if failures.is_empty() else 1)

func w_all_free(node: Node) -> void:
	node.queue_free()

