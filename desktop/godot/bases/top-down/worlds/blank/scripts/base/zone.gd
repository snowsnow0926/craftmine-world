# Area trigger: reports real enter/exit events and answers real overlap queries.
#
# Used for the shop door (scene switch), the herb patch (gathering) and any other
# "walk into a region" rule a world author adds.
class_name TopDownZone
extends Area2D

signal zone_entered(zone_id: String, body: Node)
signal zone_exited(zone_id: String, body: Node)

@export var entity_id: String = ""
@export var zone_id: String = ""
@export var trigger_on_enter: bool = false

var occupants: Array = []


func _ready() -> void:
	add_to_group("zones")
	add_to_group("entities")
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)


func _on_body_entered(body: Node) -> void:
	if occupants.has(body):
		return
	occupants.append(body)
	zone_entered.emit(zone_id, body)
	if trigger_on_enter:
		on_trigger(body)


func _on_body_exited(body: Node) -> void:
	occupants.erase(body)
	zone_exited.emit(zone_id, body)


func on_trigger(_body: Node) -> void:
	pass


func contains(body: Node) -> bool:
	return body != null and overlaps_body(body)
