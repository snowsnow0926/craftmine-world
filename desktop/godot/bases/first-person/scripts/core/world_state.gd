class_name WorldState
extends Node

## Versioned world state for the first-person base.
##
## The format is explicit and validated on load: an unsupported version, a
## mismatched base or any invalid field is rejected without partially applying.
## Player position, look direction, equipment, inventory, targets, interactables
## and quest progress are all preserved.
##
## Damage, cooldown, magazine size, meshes and crosshair styles are deliberately
## NOT part of the saved state. They live in the equipment resources, so editing
## a weapon's damage keeps the player's existing progress.

const FORMAT := "craftmine.godot-base-state/1"
const STATE_VERSION := 1

signal state_applied()

@export var base_id := "first-person"
@export var base_version := "0.1.0"
@export var world_id := "local-world"

var player: PlayerController
var equipment_state: EquipmentState
var inventory: Inventory
var quest_tracker: QuestTracker


func bind_world(world: BaseWorld) -> void:
	player = world.player
	equipment_state = world.equipment_state
	inventory = world.inventory
	quest_tracker = world.quest_tracker


func capture() -> Dictionary:
	return {
		"format": FORMAT,
		"stateVersion": STATE_VERSION,
		"base": base_id,
		"baseVersion": base_version,
		"worldId": world_id,
		"savedAt": Time.get_datetime_string_from_system(true) + "Z",
		"player": player.snapshot() if player != null else {},
		"equipment": equipment_state.snapshot() if equipment_state != null else {},
		"inventory": inventory.snapshot() if inventory != null else {"slots": []},
		"targets": collect("base_targets"),
		"interactables": collect("base_interactables"),
		"quests": quest_tracker.snapshot() if quest_tracker != null else {"quests": []},
	}


## Applies a saved state. Returns "" on success, otherwise a message explaining
## why nothing changed.
func apply(state: Dictionary) -> String:
	var problem := validate_envelope(state)
	if not problem.is_empty():
		return problem
	var migrated := _migrate(state)
	if not migrated.has("format"):
		return migrated.get("error", "State migration failed")
	var backup := capture()
	var failure := _apply_inner(migrated)
	if not failure.is_empty():
		var rollback := _apply_inner(backup)
		if not rollback.is_empty():
			return failure + " (and the world could not be rolled back: " + rollback + ")"
		return failure
	state_applied.emit()
	return ""


## Checks only the envelope. Callers can reject a foreign or future save before
## touching any live node.
func validate_envelope(state: Dictionary) -> String:
	if state.is_empty():
		return "State is empty"
	if state.get("format") != FORMAT:
		return "State format is not supported"
	var version = state.get("stateVersion")
	if not (version is float or version is int) or float(version) != floorf(float(version)):
		return "State version is invalid"
	if int(version) < 1:
		return "State version is invalid"
	if int(version) > STATE_VERSION:
		return "State version is newer than this base supports"
	if str(state.get("base", "")) != base_id:
		return "State belongs to another base"
	if not state.get("player") is Dictionary:
		return "State has no player block"
	if not state.get("equipment") is Dictionary:
		return "State has no equipment block"
	if not state.get("inventory") is Dictionary:
		return "State has no inventory block"
	if not state.get("targets") is Array:
		return "State has no target block"
	if not state.get("interactables") is Array:
		return "State has no interactable block"
	if not state.get("quests") is Dictionary:
		return "State has no quest block"
	return ""


func _apply_inner(state: Dictionary) -> String:
	if player != null:
		var player_problem := player.restore(state.get("player", {}))
		if not player_problem.is_empty():
			return player_problem
	if equipment_state != null:
		var equipment_problem := equipment_state.restore(state.get("equipment", {}))
		if not equipment_problem.is_empty():
			return equipment_problem
	if inventory != null:
		var inventory_problem := inventory.restore(state.get("inventory", {}))
		if not inventory_problem.is_empty():
			return inventory_problem
	var target_problem := _apply_collection("base_targets", state.get("targets", []))
	if not target_problem.is_empty():
		return target_problem
	var interactable_problem := _apply_collection("base_interactables", state.get("interactables", []))
	if not interactable_problem.is_empty():
		return interactable_problem
	if quest_tracker != null:
		var quest_problem := quest_tracker.restore(state.get("quests", {}))
		if not quest_problem.is_empty():
			return quest_problem
	return ""


func collect(group: StringName) -> Array:
	var entries := []
	for node in _state_nodes(group):
		entries.append(node.snapshot())
	return entries


## Nodes that participate in saved state, in a stable, unique order. Sorting by
## scene path (not by node name) keeps two same-named nodes from different
## parents in a consistent order across processes.
func _state_nodes(group: StringName) -> Array:
	var nodes: Array = []
	for node in get_tree().get_nodes_in_group(group):
		if node.has_method("snapshot") and node.has_method("restore"):
			nodes.append(node)
	nodes.sort_custom(func(a, b): return String(a.get_path()) < String(b.get_path()))
	return nodes


func _apply_collection(group: StringName, entries) -> String:
	if not entries is Array:
		return "Saved " + group + " block is not an array"
	var nodes := _state_nodes(group)
	if entries.size() != nodes.size():
		return "Saved " + group + " block does not match the scene"
	for index in nodes.size():
		var node = nodes[index]
		var entry = entries[index]
		if not entry is Dictionary:
			return "Saved " + group + " entry is not an object"
		if node.has_method("state_id") and str(entry.get("id", "")) != String(node.state_id()):
			return "Saved " + group + " entry does not match scene node " + String(node.name)
		var problem: String = node.restore(entry)
		if not problem.is_empty():
			return problem
	return ""


## Migration hook for older state versions. Version 1 is the first format, so
## this currently only rejects malformed envelopes. New versions must add an
## explicit step here instead of guessing at missing fields.
func _migrate(state: Dictionary) -> Dictionary:
	var version := int(state.get("stateVersion", 0))
	if version == STATE_VERSION:
		return state
	return {"error": "State version cannot be migrated"}
