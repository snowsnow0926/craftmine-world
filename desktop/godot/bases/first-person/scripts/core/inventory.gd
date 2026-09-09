class_name Inventory
extends Node

## Small stack inventory. It is part of the saved state so quest rewards and
## pickups survive a restart.

signal changed()

@export var starting_items: Dictionary = {}
@export var capacity := 16

var stacks: Dictionary = {}


func _ready() -> void:
	stacks = {}
	for key in starting_items.keys():
		add(StringName(str(key)), int(starting_items[key]))


func count(id: StringName) -> int:
	return int(stacks.get(id, 0))


func add(id: StringName, amount: int) -> int:
	if amount <= 0 or id.is_empty():
		return 0
	if not stacks.has(id) and stacks.size() >= capacity:
		return 0
	# The state format stores 1..9999 per slot, so the live stack is clamped to
	# the same range. Otherwise a save could be written that its own loader rejects.
	var added := mini(amount, 9999 - count(id))
	if added <= 0:
		return 0
	stacks[id] = count(id) + added
	changed.emit()
	return added


func remove(id: StringName, amount: int) -> bool:
	if amount <= 0 or count(id) < amount:
		return false
	var remaining := count(id) - amount
	if remaining <= 0:
		stacks.erase(id)
	else:
		stacks[id] = remaining
	changed.emit()
	return true


func snapshot() -> Dictionary:
	var slots := []
	var keys := stacks.keys()
	keys.sort()
	for key in keys:
		slots.append({"id": String(key), "count": int(stacks[key])})
	return {"slots": slots}


## Returns "" on success, otherwise why the saved inventory was rejected.
func restore(data: Dictionary) -> String:
	if not data.get("slots") is Array:
		return "Inventory state has no slot list"
	var restored := {}
	for slot in data.slots:
		if not slot is Dictionary:
			return "Inventory slot is not an object"
		var id := StringName(str(slot.get("id", "")))
		if id.is_empty():
			return "Inventory slot has an empty id"
		var value = slot.get("count")
		if not (value is float or value is int) or not is_finite(float(value)) or float(value) != floorf(float(value)) or float(value) < 1.0 or float(value) > 9999.0:
			return "Inventory slot count is invalid for " + String(id)
		if restored.has(id):
			return "Inventory slot is duplicated: " + String(id)
		restored[id] = int(value)
	if restored.size() > capacity:
		return "Inventory state exceeds capacity"
	stacks = restored
	changed.emit()
	return ""
