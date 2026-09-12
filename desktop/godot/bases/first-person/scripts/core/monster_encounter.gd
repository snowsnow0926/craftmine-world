class_name MonsterEncounter
extends TargetDummy

## 可复用的真实遭遇节点：命中仍由 AimQuery/AttackDispatcher 的射线决定，
## 状态仍由 base_targets/WorldState 保存。
signal loot_collected(items: Array[StringName])

@export var attack_damage := 8.0
@export var attack_cooldown := 1.0
@export var player_path: NodePath = ^"../../Player"
@export var loot: Array[StringName] = [&"coin"]
var attack_remaining := 0.0
var loot_taken := false

func _ready() -> void:
	super._ready()

func _physics_process(delta: float) -> void:
	attack_remaining = maxf(0.0, attack_remaining - delta)
	if is_destroyed or attack_remaining > 0.0:
		return
	var player := get_node_or_null(player_path) as PlayerController
	if player == null or global_position.distance_to(player.global_position) > 3.0:
		return
	var space := get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(global_position + Vector3.UP, player.global_position + Vector3.UP, 1)
	query.exclude = [get_rid(), player.get_rid()]
	if not space.intersect_ray(query).is_empty():
		return
	attack_remaining = attack_cooldown
	player.take_damage(attack_damage)

func can_interact() -> bool:
	return is_destroyed and not loot_taken

func interaction_prompt() -> String:
	return "拾取掉落物"

func interact() -> Dictionary:
	if not can_interact():
		return {"handled": false, "reason": "loot-unavailable"}
	var inventory := get_tree().current_scene.get_node_or_null("Inventory") as Inventory
	if inventory == null:
		return {"handled": false, "reason": "no-inventory"}
	var before := inventory.snapshot()
	var slots: Array = before.get("slots", []).duplicate(true)
	var by_id := {}
	for slot in slots:
		by_id[String(slot.id)] = int(slot.count)
	for item in loot:
		var key := String(item)
		if key.is_empty():
			return {"handled": false, "reason": "invalid-loot"}
		by_id[key] = int(by_id.get(key, 0)) + 1
	for key in by_id:
		if by_id[key] > 9999:
			return {"handled": false, "reason": "inventory-stack-full"}
	if by_id.size() > inventory.capacity:
		return {"handled": false, "reason": "inventory-full"}
	var next := {"slots": []}
	for key in by_id:
		next.slots.append({"id": key, "count": by_id[key]})
	var restore_problem := inventory.restore(next)
	if not restore_problem.is_empty():
		return {"handled": false, "reason": restore_problem}
	var received: Array[StringName] = []
	for item in loot:
		received.append(item)
	if received.size() == loot.size():
		loot_taken = true
	loot_collected.emit(received)
	return {"handled": true, "items": received}

func respawn() -> bool:
	if not is_destroyed:
		return false
	reset()
	loot_taken = false
	attack_remaining = 0.0
	return true

func snapshot() -> Dictionary:
	var value := super.snapshot()
	value["lootTaken"] = loot_taken
	value["attackRemaining"] = attack_remaining
	return value

func restore(data: Dictionary) -> String:
	if data.has("lootTaken") != data.has("attackRemaining"):
		return String(target_id) + ": 怪物扩展状态必须完整"
	if data.has("lootTaken") and not data.lootTaken is bool:
		return String(target_id) + ": lootTaken 无效"
	var saved_attack = data.get("attackRemaining", 0.0)
	if not (saved_attack is float or saved_attack is int) or not is_finite(float(saved_attack)) or float(saved_attack) < 0.0 or float(saved_attack) > attack_cooldown:
		return String(target_id) + ": attackRemaining 无效"
	var problem := super.restore(data)
	if not problem.is_empty():
		return problem
	# Old TargetDummy saves have no loot marker; a dead legacy target is treated
	# as already settled, preventing an invented retroactive reward.
	loot_taken = bool(data.lootTaken) if data.has("lootTaken") else is_destroyed
	attack_remaining = float(saved_attack)
	return ""
