class_name AttackDispatcher
extends Node

## Turns an attack input into the behaviour of the equipped item. It never
## decides which item is active and never stores damage or cooldown of its own:
## EquipmentState consumes the round and starts the cooldown, and the returned
## definition selects ranged or melee execution.

signal attack_resolved(result: Dictionary)
signal attack_blocked(reason: String)
signal damage_dealt(target: Object, amount: float, point: Vector3)

@export var equipment_state_path: NodePath = ^"../../EquipmentState"
@export var input_enabled := true

@onready var ranged: RangedAttack = get_node_or_null("RangedAttack")
@onready var melee: MeleeAttack = get_node_or_null("MeleeAttack")

var equipment_state: EquipmentState
var attack_count := 0
var last_result: Dictionary = {}


func bind_world(world: BaseWorld) -> void:
	equipment_state = world.equipment_state
	if ranged != null:
		ranged.camera_rig = world.camera_rig()
		if not ranged.hit_landed.is_connected(_on_hit_landed):
			ranged.hit_landed.connect(_on_hit_landed)
	if melee != null:
		melee.camera_rig = world.camera_rig()
		if not melee.hit_landed.is_connected(_on_hit_landed):
			melee.hit_landed.connect(_on_hit_landed)


func _unhandled_input(event: InputEvent) -> void:
	if input_enabled and event.is_action_pressed("attack"):
		await try_attack()


func try_attack() -> Dictionary:
	if equipment_state == null:
		return {"fired": false, "reason": "no-equipment-state", "hits": []}
	var attempt := equipment_state.try_begin_attack()
	if not attempt.get("ok", false):
		var reason := str(attempt.get("reason", "unknown"))
		attack_blocked.emit(reason)
		last_result = {"fired": false, "reason": reason, "hits": [], "damage": 0.0, "equipment": equipment_state.active_id}
		attack_resolved.emit(last_result)
		return last_result
	var definition: EquipmentDefinition = attempt.definition
	attack_count += 1
	var result: Dictionary = {"fired": false, "reason": "no-attack", "hits": [], "damage": 0.0}
	match definition.attack_mode:
		EquipmentDefinition.AttackMode.RANGED:
			if ranged != null:
				result = await ranged.execute(definition)
			else:
				result = {"fired": false, "reason": "no-ranged-node", "hits": [], "damage": 0.0}
		EquipmentDefinition.AttackMode.MELEE:
			if melee != null:
				result = await melee.execute(definition)
			else:
				result = {"fired": false, "reason": "no-melee-node", "hits": [], "damage": 0.0}
		_:
			pass
	result["equipment"] = String(definition.id)
	result["attackMode"] = definition.attack_mode_name()
	result["shot"] = attack_count
	last_result = result
	attack_resolved.emit(result)
	return result


func _on_hit_landed(target: Object, amount: float, point: Vector3) -> void:
	damage_dealt.emit(target, amount, point)


func snapshot() -> Dictionary:
	return {"attackCount": attack_count, "last": last_result}
