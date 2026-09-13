extends "res://scripts/creation_world.gd"

# Editable Blender source retained as sourceJobId:
# 9fef1bab-852c-4037-b5d4-f0fbd8922800
# Keep the base's stable tree entities, collisions, selection and progress intact.
# Only the tree generator's visual geometry is replaced by this original asset.
const BROADLEAF_MODEL: PackedScene = preload("res://assets/blender/broadleaf.glb")

func _create_entity(definition: Dictionary) -> void:
	super._create_entity(definition)
	if definition.kind != "tree":
		return
	var entity: Node3D = entity_nodes[definition.id]
	for child in entity.get_children():
		if child is MeshInstance3D:
			entity.remove_child(child)
			child.queue_free()
	var model: Node3D = BROADLEAF_MODEL.instantiate() as Node3D
	model.name = "AuthoredBroadleaf"
	entity.set_meta("entity_id", definition.id)
	model.set_meta("source_asset", "res://assets/blender/broadleaf.glb")
	model.set_meta("source_job_id", "9fef1bab-852c-4037-b5d4-f0fbd8922800")
	entity.add_child(model)
	_tint_broadleaf(model, Color(definition.color))

func _tint_broadleaf(node: Node, tint: Color) -> void:
	if node is MeshInstance3D:
		var mesh: MeshInstance3D = node as MeshInstance3D
		var mesh_name: String = str(mesh.name)
		if mesh_name == "CreationColorMesh":
			mesh.material_override = _material(tint)
		elif mesh_name.begins_with("Foliage_Light"):
			mesh.material_override = _material(tint.lightened(0.10))
		elif mesh_name.begins_with("Foliage_Dark"):
			mesh.material_override = _material(tint.darkened(0.16))
	for child in node.get_children():
		_tint_broadleaf(child, tint)
