extends "res://addons/cw.module.approved-pomeranian/companion.gd"
## Source-local repair for the retained dual-companion city. The released v2
## component, authored geometry, identities and saved progress remain intact.

@export var follow_lateral := 0.85
@export var follow_back := 0.75

const ARRIVE_DISTANCE := 0.5
const ARRIVE_HEIGHT := 1.5
const NAV_POINT_EPS := 0.12
const NAV_TARGET_STEP := 0.4
const NAV_REPATH_INTERVAL := 30
const SAVE_LIMIT_X := Vector2(-240.0, 240.0)
const SAVE_LIMIT_Y := Vector2(-20.0, 160.0)
const SAVE_LIMIT_Z := Vector2(-300.0, 80.0)

static var _nav_state := 0
static var _nav_world: WeakRef = null
var _nav_path := PackedVector3Array()
var _nav_path_index := 0
var _has_nav_target := false
var _nav_target := Vector3.ZERO
var _nav_repath_frame := 0

func validate_state(data: Dictionary) -> String:
	if not configuration_error.is_empty() or not _fields(data, ["format", "entityId", "settings", "sourceSettings", "position", "yaw", "interactionCount"]) or data.format != STATE_FORMAT or data.entityId != _identity:
		return "PET_STATE_IDENTITY_INVALID"
	if not _valid_settings(data.settings) or not _valid_settings(data.sourceSettings):
		return "PET_STATE_SETTINGS_INVALID"
	if data.sourceSettings != _source_settings:
		return "PET_SOURCE_SETTINGS_CHANGED"
	if not data.position is Array or data.position.size() != 3:
		return "PET_STATE_POSITION_INVALID"
	var limits: Array[Vector2] = [SAVE_LIMIT_X, SAVE_LIMIT_Y, SAVE_LIMIT_Z]
	for index in 3:
		var limit: Vector2 = limits[index]
		if not _finite(data.position[index], limit.x, limit.y):
			return "PET_STATE_POSITION_INVALID"
	if not _finite(data.yaw, -PI, PI) or not _finite(data.interactionCount, 0, 999999) or float(data.interactionCount) != floorf(float(data.interactionCount)):
		return "PET_STATE_VALUE_INVALID"
	return ""

func _ready() -> void:
	super()
	if not configuration_error.is_empty(): return
	var world := get_parent() as Node3D
	if _nav_world == null or _nav_world.get_ref() != world:
		_nav_world = weakref(world)
		_nav_state = 0
	if _nav_state == 0:
		_nav_state = 1
		call_deferred("_bake_navigation")

func _bake_navigation() -> void:
	if _nav_state != 1: return
	var world := get_parent() as Node3D
	if world == null or not world.is_inside_tree() or world.get_world_3d() == null:
		_nav_state = -1
		return
	var mesh := NavigationMesh.new()
	mesh.cell_size = 0.15
	mesh.cell_height = 0.05
	mesh.agent_radius = 0.3
	mesh.agent_height = 0.5
	# This companion has no stair-step controller. A coarse climb setting can
	# produce paths through low architecture that move_and_slide cannot cross.
	mesh.agent_max_climb = 0.05
	mesh.agent_max_slope = 45.0
	mesh.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	mesh.geometry_collision_mask = 1
	mesh.geometry_source_geometry_mode = NavigationMesh.SOURCE_GEOMETRY_ROOT_NODE_CHILDREN
	var source := NavigationMeshSourceGeometryData3D.new()
	NavigationServer3D.parse_source_geometry_data(mesh, source, world)
	NavigationServer3D.bake_from_source_geometry_data(mesh, source)
	if mesh.get_polygon_count() == 0:
		_nav_state = -1
		return
	var region := NavigationRegion3D.new()
	region.name = "PetNavigation"
	world.add_child(region)
	var map := world.get_world_3d().navigation_map
	NavigationServer3D.map_set_cell_size(map, mesh.cell_size)
	NavigationServer3D.map_set_cell_height(map, mesh.cell_height)
	region.navigation_mesh = mesh
	NavigationServer3D.region_set_map(region.get_rid(), map)
	_nav_state = 2

func _physics_process(delta: float) -> void:
	if not configuration_error.is_empty(): return
	if not is_instance_valid(_player):
		_player = get_node_or_null(player_path) as Node3D
	var desired := Vector3.ZERO
	if _settings.following and is_instance_valid(_player):
		var anchor := _follow_anchor()
		var flat := anchor - global_position
		flat.y = 0.0
		if flat.length() > ARRIVE_DISTANCE or absf(anchor.y - global_position.y) > ARRIVE_HEIGHT:
			desired = _follow_step(anchor)
	else:
		_has_nav_target = false
		_nav_path = PackedVector3Array()
		_nav_path_index = 0
	velocity.x = move_toward(velocity.x, desired.x, acceleration * delta)
	velocity.z = move_toward(velocity.z, desired.z, acceleration * delta)
	if is_on_floor():
		velocity.y = -0.1
	else:
		velocity.y = maxf(velocity.y - 9.8 * delta, -30.0)
	move_and_slide()
	var horizontal := Vector2(get_real_velocity().x, get_real_velocity().z)
	if horizontal.length() > 0.08:
		_set_heading(wrapf(lerp_angle(_current_heading(), atan2(-horizontal.x, -horizontal.y), minf(1.0, delta * 8.0)), -PI, PI))
	_update_animation(horizontal.length() > 0.08)
	_feedback_seconds = maxf(0.0, _feedback_seconds - delta)
	if is_zero_approx(_feedback_seconds): feedback_text = ""

func _follow_step(anchor: Vector3) -> Vector3:
	if _nav_state != 2: return Vector3.ZERO
	var map := get_world_3d().navigation_map
	if NavigationServer3D.map_get_iteration_id(map) == 0: return Vector3.ZERO
	var frame := Engine.get_physics_frames()
	if not _has_nav_target or _nav_target.distance_to(anchor) > NAV_TARGET_STEP or frame >= _nav_repath_frame:
		_has_nav_target = true
		_nav_target = anchor
		_nav_repath_frame = frame + NAV_REPATH_INTERVAL
		_nav_path = _reachable_nav_path(anchor)
		_nav_path_index = 0
	# An empty or partial route never falls back to pushing toward the player.
	if _nav_path.size() < 2: return Vector3.ZERO
	while _nav_path_index < _nav_path.size() and _nav_flat_distance(_nav_path[_nav_path_index]) <= NAV_POINT_EPS:
		_nav_path_index += 1
	if _nav_path_index >= _nav_path.size(): return Vector3.ZERO
	var offset := _nav_path[_nav_path_index] - global_position
	offset.y = 0.0
	var distance := offset.length()
	if distance <= 0.001: return Vector3.ZERO
	return offset.normalized() * minf(move_speed, maxf(0.5, distance * 4.0))

func _reachable_nav_path(anchor: Vector3) -> PackedVector3Array:
	var map := get_world_3d().navigation_map
	var points := NavigationServer3D.map_get_path(map, global_position, anchor, true)
	if points.is_empty(): return points
	var destination := NavigationServer3D.map_get_closest_point(map, anchor)
	var movement := points[0] - global_position
	movement.y = 0.0
	if points.size() >= 2 and points[-1].distance_to(destination) < 0.5 and (movement.length() <= 0.5 or not test_move(global_transform, movement)):
		return points
	# Nearest-point projection can select the far side of a wall or an isolated
	# patch. Rejoin only through a sweep clear for the actual collision body.
	var best := PackedVector3Array()
	var best_distance := INF
	for radius in [1.0, 2.0, 4.0, 8.0]:
		for step in 16:
			var angle := step * TAU / 16.0
			var probe: Vector3 = global_position + Vector3(cos(angle), 0.0, sin(angle)) * radius
			var point := NavigationServer3D.map_get_closest_point(map, probe)
			if absf(point.y - global_position.y) > 0.5: continue
			var join := point - global_position
			join.y = 0.0
			if join.length() >= best_distance or test_move(global_transform, join): continue
			var candidate := NavigationServer3D.map_get_path(map, point, anchor, true)
			if candidate.size() < 2 or candidate[-1].distance_to(destination) > 0.5: continue
			best_distance = join.length()
			best = candidate
	return best

func _nav_flat_distance(point: Vector3) -> float:
	var difference := point - global_position
	difference.y = 0.0
	return difference.length()

func _set_heading(value: float) -> void:
	# This source pins an upright unit body. Repeated Euler read/modify/write
	# preserves a decomposed scale and can accumulate scale error over turns.
	# Construct the intended rotation directly; retain the parent's yaw cache.
	global_basis = Basis(Vector3.UP, value)
	_heading = value
	_heading_basis = global_basis
	_heading_known = true

func _follow_anchor() -> Vector3:
	var forward := Vector3(0.0, 0.0, -1.0)
	var eye := _player.get_node_or_null("CameraRig/PitchPivot/Camera3D") as Node3D
	if eye != null: forward = -eye.global_basis.z
	forward.y = 0.0
	if forward.length_squared() < 0.0001:
		forward = Vector3(0.0, 0.0, -1.0)
	else:
		forward = forward.normalized()
	var right := forward.cross(Vector3.UP)
	return _player.global_position + right * clampf(follow_lateral, 0.0, 2.0) - forward * clampf(follow_back, 0.0, 2.0)
