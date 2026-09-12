extends StaticBody3D
# Provenance: res://addons/__ASSET_ID__/provenance.json
# Code license: res://addons/__ASSET_ID__/licenses/LICENSE.md
# Asset license declaration: res://addons/__ASSET_ID__/licenses/README.md
# These references also preserve attribution through managed source extraction.

@export var entity_id: String = ""
@export_range(25, 800, 1) var model_scale_percent: int = 100
@export_range(0, 3, 1) var quarter_turns: int = 0
@export var solid: bool = true
@export var label: String = "__KIND__"
const MODULE_KIND := "__KIND__"
var collision_count := 0

func _ready() -> void:
	add_to_group("kenney_city_modules")
	rebuild_geometry()

func rebuild_geometry() -> void:
	for child in get_children():
		if child is CollisionShape3D:
			remove_child(child)
			child.queue_free()
	var visual := $Visual as Node3D
	visual.scale = Vector3.ONE * clampf(float(model_scale_percent) / 100.0, 0.25, 8.0)
	visual.rotation.y = float(posmod(quarter_turns, 4)) * PI / 2.0
	collision_count = 0
	for node in visual.find_children("*", "MeshInstance3D", true, false):
		var mesh_node := node as MeshInstance3D
		if mesh_node.mesh == null:
			continue
		var shape := CollisionShape3D.new()
		shape.name = "MeshCollision_%d" % collision_count
		shape.shape = mesh_node.mesh.create_trimesh_shape()
		add_child(shape)
		shape.transform = global_transform.affine_inverse() * mesh_node.global_transform
		shape.disabled = not solid
		collision_count += 1

func configure(parameters: Dictionary) -> Dictionary:
	for key in parameters:
		if key not in ["model_scale_percent", "quarter_turns", "solid", "label"]:
			return {"ok": false, "reason": "UNDECLARED_MODULE_PARAMETER"}
	if parameters.has("model_scale_percent") and (not parameters.model_scale_percent is int or parameters.model_scale_percent < 25 or parameters.model_scale_percent > 800):
		return {"ok": false, "reason": "INVALID_MODULE_SCALE"}
	if parameters.has("quarter_turns") and (not parameters.quarter_turns is int or parameters.quarter_turns < 0 or parameters.quarter_turns > 3):
		return {"ok": false, "reason": "INVALID_MODULE_ROTATION"}
	if parameters.has("solid") and not parameters.solid is bool:
		return {"ok": false, "reason": "INVALID_MODULE_SOLID"}
	if parameters.has("label") and (not parameters.label is String or parameters.label.length() > 80):
		return {"ok": false, "reason": "INVALID_MODULE_LABEL"}
	for key in parameters:
		set(key, parameters[key])
	rebuild_geometry()
	return {"ok": true, "state": module_state()}

func module_state() -> Dictionary:
	return {"entity_id": entity_id, "kind": MODULE_KIND, "model_scale_percent": model_scale_percent,
		"quarter_turns": quarter_turns, "solid": solid, "label": label, "collision_count": collision_count}
