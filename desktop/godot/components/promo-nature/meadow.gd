extends Node3D

## The original decoration contains no floor collision or player behavior.
const Model = preload("res://addons/cw.scene.promo-meadow/model.glb")
@export var entity_id: String = ""

func _ready() -> void:
	if entity_id.is_empty():
		push_error("PROMO_MEADOW_ID_REQUIRED")
		return
	set_meta("entity_id", entity_id)
	set_meta("decoration_only", true)
	set_meta("source_job_id", "d6352d39-d3cc-4960-9b6f-12c6ea890e5e")
	var visual := Model.instantiate() as Node3D
	visual.name = "GroundMeadow"
	add_child(visual)
