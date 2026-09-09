# Anything the player can interact with: shop counters, NPCs, doors.
#
# `can_interact` answers "would the prompt show"; the geometric guard that makes
# an action legal is `overlaps_body(actor)` inside each concrete action. A caller
# that skips the prompt (a script, a probe) still cannot act from a distance.
class_name Interactable
extends Area2D

signal interacted(actor: Node)

@export var entity_id: String = ""
@export var prompt: String = "交互"
@export var enabled: bool = true


func _ready() -> void:
	add_to_group("interactables")
	add_to_group("entities")


func can_interact(_actor: Node) -> bool:
	return enabled


func in_range(actor: Node) -> bool:
	return actor != null and overlaps_body(actor)


func interact(actor: Node) -> Dictionary:
	if not can_interact(actor):
		return {"ok": false, "reason": "disabled"}
	interacted.emit(actor)
	return {"ok": true, "entityId": entity_id, "prompt": prompt}
