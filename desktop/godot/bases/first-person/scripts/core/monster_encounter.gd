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
	var received: Array[StringName] = []
	if inventory != null:
		for item in loot:
			if inventory.add(item, 1) > 0:
				received.append(item)
	loot_taken = true
	loot_collected.emit(received)
	return {"handled": true, "items": received}

func respawn() -> bool:
	if not is_destroyed:
		return false
	reset()
	loot_taken = false
	return true

func snapshot() -> Dictionary:
	var value := super.snapshot()
	value["lootTaken"] = loot_taken
	return value

func restore(data: Dictionary) -> String:
	var problem := super.restore(data)
	if not problem.is_empty():
		return problem
	if data.has("lootTaken") and not data.lootTaken is bool:
		return String(target_id) + ": lootTaken 无效"
	loot_taken = bool(data.get("lootTaken", false))
	return ""
