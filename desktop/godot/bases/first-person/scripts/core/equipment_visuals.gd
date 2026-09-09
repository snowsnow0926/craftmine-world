class_name EquipmentVisuals
extends Node3D

## Displays the model of the equipped item under the real camera mount. The
## mesh, material, offset and scale all come from the same EquipmentDefinition
## that supplies the crosshair and the attack behaviour.

@export var equipment_state_path: NodePath = ^"../../../EquipmentState"

var equipment_state: EquipmentState
var _mesh_instance: MeshInstance3D


func bind_world(world: BaseWorld) -> void:
	equipment_state = world.equipment_state
	if equipment_state == null:
		push_warning("EquipmentVisuals has no EquipmentState")
		return
	if not equipment_state.equipment_changed.is_connected(_on_equipment_changed):
		equipment_state.equipment_changed.connect(_on_equipment_changed)
	_on_equipment_changed(equipment_state.active_id, equipment_state.definition())


func _on_equipment_changed(_id: StringName, definition: EquipmentDefinition) -> void:
	if _mesh_instance != null:
		_mesh_instance.queue_free()
		_mesh_instance = null
	if definition == null or definition.display_mesh == null:
		return
	_mesh_instance = MeshInstance3D.new()
	_mesh_instance.name = "DisplayModel"
	_mesh_instance.mesh = definition.display_mesh
	if definition.display_material != null:
		_mesh_instance.material_override = definition.display_material
	_mesh_instance.position = definition.mount_offset
	_mesh_instance.rotation_degrees = definition.mount_rotation_degrees
	_mesh_instance.scale = definition.display_scale
	add_child(_mesh_instance)


func model() -> MeshInstance3D:
	return _mesh_instance


func snapshot() -> Dictionary:
	if _mesh_instance == null:
		return {"visible": false, "meshPath": "", "local": [0.0, 0.0, 0.0]}
	return {
		"visible": _mesh_instance.visible,
		"meshPath": _mesh_instance.mesh.resource_path if _mesh_instance.mesh != null else "",
		"local": [_mesh_instance.position.x, _mesh_instance.position.y, _mesh_instance.position.z],
	}
