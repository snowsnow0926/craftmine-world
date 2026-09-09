class_name PickupItem
extends Interactable

## A one-time world pickup. The taken flag is gameplay state and survives a save
## and restart, so a player cannot farm the same item twice.

@export var item_id: StringName = &"repair_kit"
@export var amount := 1

var inventory: Inventory
var taken := false


func _ready() -> void:
	add_to_group("base_interactables")


func bind_world(world: BaseWorld) -> void:
	inventory = world.inventory


func can_interact() -> bool:
	return enabled and not taken


func interaction_prompt() -> String:
	if not can_interact():
		return ""
	return prompt + " " + String(item_id) + "  [E]"


func interact() -> Dictionary:
	if not can_interact() or inventory == null:
		return {"handled": false, "reason": "empty"}
	var added := inventory.add(item_id, amount)
	taken = true
	visible = false
	var result := {"handled": true, "item": String(item_id), "count": added, "taken": true}
	interacted.emit(result)
	return result


func snapshot() -> Dictionary:
	return {"id": state_id(), "enabled": enabled, "taken": taken}


func restore(data: Dictionary) -> String:
	var saved_taken = data.get("taken")
	if not saved_taken is bool:
		return name + ": saved taken flag is invalid"
	var base_problem := super.restore(data)
	if not base_problem.is_empty():
		return base_problem
	taken = bool(saved_taken)
	visible = not taken
	return ""
