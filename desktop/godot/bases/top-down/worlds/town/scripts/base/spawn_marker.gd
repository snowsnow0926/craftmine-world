# Named arrival point used by door/scene transitions.
class_name SpawnMarker
extends Marker2D

@export var spawn_id: String = ""


func _ready() -> void:
	add_to_group("spawns")
