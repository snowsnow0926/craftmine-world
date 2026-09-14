extends Node3D

## Reuse the authored model and first grove tree's tint, scale and collision.
const Model = preload("res://addons/cw.nature.promo-broadleaf/model.glb")
@export var entity_id: String = ""
@export var leaf_color: Color = Color("4d8c45")
@export var model_scale: Vector3 = Vector3(2.2, 1.05, 2.2)

func _ready() -> void:
	if entity_id.is_empty() or not model_scale.is_finite() or model_scale.x <= 0.0 or model_scale.y <= 0.0 or model_scale.z <= 0.0:
		push_error("PROMO_TREE_CONFIGURATION_INVALID")
		return
	set_meta("entity_id", entity_id)
	set_meta("source_job_id", "9fef1bab-852c-4037-b5d4-f0fbd8922800")
	var visual := Model.instantiate() as Node3D
	visual.name = "AuthoredBroadleaf"
	visual.scale = model_scale
	add_child(visual)
	_tint(visual)
	var body := StaticBody3D.new()
	body.name = "TrunkCollision"
	body.collision_layer = 1
	body.collision_mask = 0
	body.position = Vector3(0.0, 2.0 * model_scale.y, 0.0)
	var shape := BoxShape3D.new()
	shape.size = Vector3(1.2, 4.0, 1.2) * model_scale
	var collision := CollisionShape3D.new()
	collision.shape = shape
	body.add_child(collision)
	add_child(body)

func _tint(node: Node) -> void:
	if node is MeshInstance3D:
		var shade := leaf_color
		var mesh_name := String(node.name)
		var replace := mesh_name == "CreationColorMesh"
		if mesh_name.begins_with("Foliage_Light"):
			shade = shade.lightened(0.10)
			replace = true
		elif mesh_name.begins_with("Foliage_Dark"):
			shade = shade.darkened(0.16)
			replace = true
		if replace:
			var material := StandardMaterial3D.new()
			material.albedo_color = shade
			material.roughness = 0.85
			(node as MeshInstance3D).material_override = material
	for child in node.get_children():
		_tint(child)
