extends RefCounted

# Optional, explicit source component. No automatic scene search or startup.
const GroundMaterial = preload("ground.tres")
const BoundaryMaterial = preload("boundary.tres")
const OutdoorEnvironment = preload("environment.tres")
const SUN_TINT := Color(1.0, 0.96, 0.88, 1.0)

static func apply_to(environment_node: WorldEnvironment, ground: MeshInstance3D,
		sun: DirectionalLight3D, boundary_meshes: Array[MeshInstance3D] = []) -> String:
	# Validate the entire explicit selection before changing any resource.
	if not is_instance_valid(environment_node) or not is_instance_valid(ground) or ground.mesh == null or not is_instance_valid(sun):
		return "NATURAL_DAYLIGHT_TARGETS_REQUIRED"
	for mesh in boundary_meshes:
		if not is_instance_valid(mesh) or mesh == ground or mesh.mesh == null:
			return "NATURAL_DAYLIGHT_BOUNDARY_INVALID"
	# Each application owns its resources; tuning one world cannot recolor another.
	environment_node.environment = OutdoorEnvironment.duplicate(true) as Environment
	ground.material_override = GroundMaterial.duplicate(true) as StandardMaterial3D
	for mesh in boundary_meshes:
		mesh.material_override = BoundaryMaterial.duplicate(true) as StandardMaterial3D
	sun.light_color = SUN_TINT
	# Energy, rotation and shadows remain controlled by the existing world.
	# No geometry, collision, input, time-of-day or saved state is changed.
	return ""
