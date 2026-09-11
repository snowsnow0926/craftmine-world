extends Node3D

# This optional package is installed only after the host verifies the stock
# creation_world.gd source hash. The standalone apply_to helper stays generic.
@export var entity_id: String = ""
var applied := false
var error := ""
const Preset = preload("natural_daylight.gd")

func _ready() -> void:
	_apply_to_stock_world.call_deferred()

func _apply_to_stock_world() -> void:
	var world := get_parent() as Node3D
	if world == null:
		error = "NATURAL_DAYLIGHT_PARENT_REQUIRED"
		return
	var environments: Array[WorldEnvironment] = []
	var grounds: Array[MeshInstance3D] = []
	var boundaries: Array[MeshInstance3D] = []
	var lights: Array[DirectionalLight3D] = []
	# Explicit stock-base geometry, checked as a complete set before mutation.
	# Never assume automatically assigned node names or child-list indices.
	for child in world.get_children():
		if child is WorldEnvironment:
			environments.append(child)
		elif child is DirectionalLight3D:
			lights.append(child)
		elif child is MeshInstance3D and child.mesh is BoxMesh:
			if child.mesh.size == Vector3(64, 0.4, 64) and child.position == Vector3(0, -0.2, 0):
				grounds.append(child)
			elif (child.mesh.size == Vector3(0.5, 3, 64) and absf(child.position.x) == 32.0) or (child.mesh.size == Vector3(64, 3, 0.5) and absf(child.position.z) == 32.0):
				boundaries.append(child)
	if environments.size() != 1 or grounds.size() != 1 or lights.size() != 1 or boundaries.size() != 4:
		error = "NATURAL_DAYLIGHT_STOCK_TARGETS_CHANGED"
		return
	error = Preset.apply_to(environments[0], grounds[0], lights[0], boundaries)
	applied = error.is_empty()
