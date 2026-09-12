class_name MonsterEncounter
extends TargetDummy

## A real encounter actor. It remains a base target so aim/raycast, quest and
## WorldState persistence keep using the existing stable entity contract.
signal loot_collected(items: Array[StringName])

@export var attack_damage := 8.0
@export var attack_cooldown := 1.0
@export var loot: Array[StringName] = [&"coin"]
@export var player_path: NodePath = ^"../../Player"

var _attack_remaining := 0.0
var _respawns := 0
var _collected := false

func _ready() -> void:
	_super_ready()

func _super_ready() -> void:
	super._ready()

func _physics_process(delta: float) -> void:
	_attack_remaining = maxf(0.0, _attack_remaining - delta)
	if is_destroyed or _attack_remaining > 0.0:
		return
	var player := get_node_or_null(player_path) as PlayerController
	if player == null or global_position.distance_to(player.global_position) > 3.0:
		return
	_attack_remaining = attack_cooldown
	player.hurt(attack_damage)

func collect_loot() -> Array[StringName]:
	if not is_destroyed or _collected:
		return []
	var inventory := get_tree().current_scene.get_node_or_null("Inventory") as Inventory
	var received: Array[StringName] = []
	if inventory != null:
		for item in loot:
			if inventory.add(item, 1) > 0:
				received.append(item)
	_collected = true
	loot_collected.emit(received)
	return received

func respawn() -> bool:
	if not is_destroyed:
		return false
	reset()
	_collected = false
	_respawns += 1
	return true

func snapshot() -> Dictionary:
	var value := super.snapshot()
	value["respawns"] = _respawns
	value["lootCollected"] = _collected
	return value

func restore(data: Dictionary) -> String:
	var problem := super.restore(data)
	if not problem.is_empty():
		return problem
	var count = data.get("respawns", 0)
	var collected = data.get("lootCollected", false)
	if not (count is int or count is float) or int(count) < 0 or not collected is bool:
		return String(target_id) + ": encounter state is invalid"
	_respawns = int(count)
	_collected = collected
	return ""
