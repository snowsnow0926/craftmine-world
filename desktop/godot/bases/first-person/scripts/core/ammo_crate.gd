class_name AmmoCrate
extends Interactable

## Ammunition resupply. It adds rounds to the reserve of the equipped item; the
## magazine is still filled by the normal reload, so no path bypasses
## EquipmentState.

@export var rounds_per_use := 12
@export var total_uses := 3

var equipment_state: EquipmentState
var uses_left := 0


func _ready() -> void:
	uses_left = maxi(0, total_uses)
	add_to_group("base_interactables")


func bind_world(world: BaseWorld) -> void:
	equipment_state = world.equipment_state


func can_interact() -> bool:
	return enabled and uses_left > 0


func interaction_prompt() -> String:
	if not can_interact():
		return ""
	return prompt + "  [E]  " + str(uses_left) + " left"


func interact() -> Dictionary:
	if not can_interact() or equipment_state == null:
		return {"handled": false, "reason": "empty"}
	var added := equipment_state.add_reserve(rounds_per_use)
	uses_left -= 1
	var result := {"handled": true, "ammo": added, "usesLeft": uses_left, "reserve": equipment_state.reserve()}
	interacted.emit(result)
	return result


func snapshot() -> Dictionary:
	return {"id": state_id(), "enabled": enabled, "usesLeft": uses_left}


func restore(data: Dictionary) -> String:
	var saved_uses = data.get("usesLeft")
	if not (saved_uses is float or saved_uses is int) or not is_finite(float(saved_uses)) or float(saved_uses) != floorf(float(saved_uses)) or float(saved_uses) < 0.0:
		return name + ": saved uses are invalid"
	var base_problem := super.restore(data)
	if not base_problem.is_empty():
		return base_problem
	# total_uses is source and may be lowered; clamp instead of discarding progress.
	uses_left = mini(int(saved_uses), total_uses)
	return ""
