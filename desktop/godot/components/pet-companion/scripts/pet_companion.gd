extends CharacterBody3D

const STATE_FORMAT := "craftmine.pet-companion-state/1"
const APPEARANCES := ["dog", "pomeranian-white"]
signal feedback_emitted(component_id: String, message: String)

@export var entity_id := ""
@export var companion_name := "小伙伴"
@export_enum("dog", "pomeranian-white") var appearance_key := "dog"
@export var following := true
@export var player_path := NodePath("../Player")
@export var move_speed := 2.8
@export var acceleration := 8.0
@export var stop_distance := 1.5
@export var interaction_distance := 3.0
@export var collision_radius := 0.75
@export var collision_height := 0.77
@export var pomeranian_collision_radius := 0.36
@export var pomeranian_collision_height := 0.48
@export var dog_visual: PackedScene
@export var pomeranian_visual: PackedScene

var _identity := ""
var _source_settings: Dictionary = {}
var _settings: Dictionary = {}
var _player: Node3D
var _shape: CollisionShape3D
var _visual: Node3D
var _animation: AnimationPlayer
var _interaction_count := 0
var _feedback_seconds := 0.0
var feedback_text := ""
var configuration_error := ""

func _ready() -> void:
	# Invalid components must remain discoverable so the host refuses saving them.
	add_to_group("craftmine_persistent_components")
	_identity = entity_id
	_source_settings = {"name": companion_name, "appearanceKey": appearance_key, "following": following}
	_source_settings.make_read_only()
	_settings = _source_settings.duplicate(true)
	var identifier := RegEx.new()
	identifier.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
	var matched := identifier.search(_identity)
	if matched == null or matched.get_string() != _identity or not _valid_settings(_settings) or not _valid_motion_configuration():
		configuration_error = "PET_CONFIGURATION_INVALID"
		set_physics_process(false)
		return
	_player = get_node_or_null(player_path) as Node3D
	_shape = get_node_or_null("CollisionShape3D") as CollisionShape3D
	if _shape == null:
		_shape = CollisionShape3D.new()
		_shape.name = "CollisionShape3D"
		add_child(_shape)
	_visual = get_node_or_null("VisualPivot") as Node3D
	if _visual == null:
		_visual = Node3D.new()
		_visual.name = "VisualPivot"
		add_child(_visual)
	collision_layer = 2
	collision_mask = 11 # ground/objects, other companions, and the actual player
	floor_snap_length = 0.15
	_apply_appearance()

func _physics_process(delta: float) -> void:
	if not configuration_error.is_empty():
		return
	if not is_instance_valid(_player):
		_player = get_node_or_null(player_path) as Node3D
	var desired := Vector3.ZERO
	if _settings.following and is_instance_valid(_player):
		var offset := _player.global_position - global_position
		# This first version follows on flat ground; it never teleports to catch up.
		if absf(offset.y) <= 1.8:
			offset.y = 0.0
			var distance := offset.length()
			if distance > stop_distance:
				desired = offset.normalized() * minf(move_speed, (distance - stop_distance) * 4.0)
	velocity.x = move_toward(velocity.x, desired.x, acceleration * delta)
	velocity.z = move_toward(velocity.z, desired.z, acceleration * delta)
	if is_on_floor():
		velocity.y = -0.1
	else:
		velocity.y = maxf(velocity.y - 9.8 * delta, -30.0)
	move_and_slide()
	var horizontal := Vector2(get_real_velocity().x, get_real_velocity().z)
	if horizontal.length() > 0.08:
		rotation.y = lerp_angle(rotation.y, atan2(-horizontal.x, -horizontal.y), minf(1.0, delta * 8.0))
	_update_animation(horizontal.length() > 0.08)
	_feedback_seconds = maxf(0.0, _feedback_seconds - delta)
	if is_zero_approx(_feedback_seconds):
		feedback_text = ""

func _apply_appearance() -> void:
	_visual.transform = Transform3D.IDENTITY
	var cylinder := CylinderShape3D.new()
	var small: bool = _settings.appearanceKey == "pomeranian-white"
	cylinder.radius = pomeranian_collision_radius if small else collision_radius
	cylinder.height = pomeranian_collision_height if small else collision_height
	_shape.shape = cylinder # Every instance owns its own mutable collision shape.
	_shape.position = Vector3(0, cylinder.height / 2.0, 0)
	_animation = null
	for child in _visual.get_children():
		_visual.remove_child(child)
		child.queue_free()
	var packed: PackedScene = pomeranian_visual if small else dog_visual
	# Behavior-only fixtures deliberately leave visuals unbound. Product packaging
	# must bind both reviewed real appearances; this is not a fallback geometric dog.
	if packed != null:
		var visual := packed.instantiate()
		_visual.add_child(visual)
		var queue: Array[Node] = [visual]
		var visited := 0
		while not queue.is_empty() and visited < 128:
			var current := queue.pop_front() as Node
			visited += 1
			if current is AnimationPlayer:
				_animation = current as AnimationPlayer
				# glTF does not carry loop intent. Clone libraries before changing
				# these known clips so two pets never share mutable animation data.
				for library_name in _animation.get_animation_library_list():
					var library := _animation.get_animation_library(library_name).duplicate(true) as AnimationLibrary
					for clip in ["idle", "walk"]:
						if library.has_animation(clip):
							library.get_animation(clip).loop_mode = Animation.LOOP_LINEAR
					_animation.remove_animation_library(library_name)
					_animation.add_animation_library(library_name, library)
				break
			for child in current.get_children():
				queue.append(child)
	_update_animation(false)

func _update_animation(walking: bool) -> void:
	if not is_instance_valid(_animation):
		return
	var clip := "walk" if walking else "idle"
	if _animation.has_animation(clip) and _animation.current_animation != clip:
		_animation.play(clip, 0.0)

func interact(player: Node3D) -> Dictionary:
	if not configuration_error.is_empty() or get_tree().paused or player != _player or not is_instance_valid(player):
		return {"interacted": false, "reason": "unavailable"}
	var center := _shape.global_position
	var eye := player.get_node_or_null("CameraRig/PitchPivot/Camera3D") as Camera3D
	var origin := eye.global_position if eye != null else player.global_position
	if origin.distance_to(center) > interaction_distance:
		return {"interacted": false, "reason": "out-of-range"}
	var excluded: Array[RID] = []
	if player is CollisionObject3D:
		excluded.append((player as CollisionObject3D).get_rid())
	var ray := PhysicsRayQueryParameters3D.create(origin, center, collision_mask, excluded)
	var hit := get_world_3d().direct_space_state.intersect_ray(ray)
	if not hit.is_empty() and hit.collider != self:
		return {"interacted": false, "reason": "obstructed"}
	_interaction_count = mini(999999, _interaction_count + 1)
	feedback_text = str(_settings.name) + "开心地回应了你的抚摸"
	_feedback_seconds = 2.0
	feedback_emitted.emit(_identity, feedback_text)
	return {"interacted": true, "entityId": _identity, "kind": "pet-companion", "feedback": feedback_text, "interactionCount": _interaction_count}

func set_companion_name(value: String) -> String:
	if not _valid_name(value):
		return "PET_NAME_INVALID"
	_settings.name = value
	return ""

func set_appearance_key(value: String) -> String:
	if value not in APPEARANCES:
		return "PET_APPEARANCE_INVALID"
	_settings.appearanceKey = value
	_apply_appearance()
	return ""

func set_following(value: bool) -> void:
	_settings.following = value

func snapshot() -> Dictionary:
	var body := {"format": STATE_FORMAT, "entityId": _identity, "settings": _settings.duplicate(true), "sourceSettings": _source_settings.duplicate(true), "position": [global_position.x, global_position.y, global_position.z], "yaw": global_rotation.y, "interactionCount": _interaction_count}
	# Compare the actual Godot wire representation, not in-memory Vector3 floats
	# against JSON's decimal representation. No field validation is relaxed.
	return JSON.parse_string(JSON.stringify(body))

func validate_state(data: Dictionary) -> String:
	if not configuration_error.is_empty() or not _fields(data, ["format", "entityId", "settings", "sourceSettings", "position", "yaw", "interactionCount"]) or data.format != STATE_FORMAT or data.entityId != _identity:
		return "PET_STATE_IDENTITY_INVALID"
	if not _valid_settings(data.settings) or not _valid_settings(data.sourceSettings):
		return "PET_STATE_SETTINGS_INVALID"
	if data.sourceSettings != _source_settings:
		return "PET_SOURCE_SETTINGS_CHANGED"
	if not data.position is Array or data.position.size() != 3:
		return "PET_STATE_POSITION_INVALID"
	for coordinate in data.position:
		if not _finite(coordinate, -80, 80):
			return "PET_STATE_POSITION_INVALID"
	if not _finite(data.yaw, -PI, PI) or not _finite(data.interactionCount, 0, 999999) or float(data.interactionCount) != floorf(float(data.interactionCount)):
		return "PET_STATE_VALUE_INVALID"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty():
		return problem
	_settings = data.settings.duplicate(true)
	global_position = Vector3(data.position[0], data.position[1], data.position[2])
	global_rotation.y = float(data.yaw)
	velocity = Vector3.ZERO
	_interaction_count = int(data.interactionCount)
	feedback_text = ""
	_feedback_seconds = 0.0
	_apply_appearance()
	return ""

func validate_restored_state() -> String:
	if not is_inside_tree() or not configuration_error.is_empty() or not is_instance_valid(_shape) or not _shape.shape is CylinderShape3D:
		return "PET_RESTORE_PHYSICS_UNAVAILABLE"
	# Called only after the registry restores every component and the player.
	force_update_transform()
	_shape.force_update_transform()
	var restored_bodies: Array[PhysicsBody3D] = []
	if is_instance_valid(_player) and _player is PhysicsBody3D:
		restored_bodies.append(_player as PhysicsBody3D)
	for peer in get_tree().get_nodes_in_group("craftmine_persistent_components"):
		if peer is PhysicsBody3D and peer != self and peer not in restored_bodies:
			restored_bodies.append(peer)
	if restored_bodies.size() > 128 or not _upright_unit(_shape.global_transform):
		return "PET_RESTORE_TRANSFORM_UNSUPPORTED"
	var actual := _shape.shape as CylinderShape3D
	var inset := CylinderShape3D.new()
	inset.radius = actual.radius - 0.002
	inset.height = actual.height - 0.004
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = inset
	query.transform = _shape.global_transform
	query.collision_mask = collision_mask
	var excluded: Array[RID] = [get_rid()]
	# Kinematic broadphase poses lag until a physics step, even after an explicit
	# body_set_state. Compare known actual shapes at current restored transforms;
	# exclude their stale server poses from the remaining native world query.
	for body in restored_bodies:
		excluded.append(body.get_rid())
		if body.collision_layer & collision_mask == 0:
			continue
		var problem := _restored_body_overlap(inset, _shape.global_transform, body)
		if not problem.is_empty():
			return problem
	query.exclude = excluded
	query.margin = 0.0
	return "" if get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty() else "PET_RESTORE_OVERLAP"

func _upright_unit(transform_value: Transform3D) -> bool:
	var basis := transform_value.basis
	return basis.is_equal_approx(basis.orthonormalized()) and basis.y.distance_to(Vector3.UP) < 0.00001 and basis.determinant() > 0.0

func _restored_body_overlap(own: CylinderShape3D, own_transform: Transform3D, body: PhysicsBody3D) -> String:
	for owner_id in body.get_shape_owners():
		if body.is_shape_owner_disabled(owner_id):
			continue
		var owner_node := body.shape_owner_get_owner(owner_id) as Node3D
		var shape_transform := owner_node.global_transform if owner_node != null else body.global_transform * body.shape_owner_get_transform(owner_id)
		if not _upright_unit(shape_transform):
			return "PET_RESTORE_TRANSFORM_UNSUPPORTED"
		for shape_index in body.shape_owner_get_shape_count(owner_id):
			var shape := body.shape_owner_get_shape(owner_id, shape_index)
			var a := own_transform.origin
			var b := shape_transform.origin
			var horizontal := Vector2(a.x - b.x, a.z - b.z).length()
			if shape is CylinderShape3D:
				if horizontal < own.radius + shape.radius and absf(a.y - b.y) < (own.height + shape.height) / 2.0:
					return "PET_RESTORE_OVERLAP"
			elif shape is CapsuleShape3D:
				# Exact distance from the vertical capsule segment to a solid
				# vertical cylinder, compared with the capsule's real sphere radius.
				var segment_half := maxf(0.0, shape.height / 2.0 - shape.radius)
				var vertical := maxf(0.0, maxf((a.y - own.height / 2.0) - (b.y + segment_half), (b.y - segment_half) - (a.y + own.height / 2.0)))
				var radial := maxf(0.0, horizontal - own.radius)
				if radial * radial + vertical * vertical < shape.radius * shape.radius:
					return "PET_RESTORE_OVERLAP"
			else:
				return "PET_RESTORE_SHAPE_UNSUPPORTED"
	return ""

func _valid_motion_configuration() -> bool:
	return _finite(move_speed, 0.1, 12) and _finite(acceleration, 0.1, 60) and _finite(stop_distance, 1.1, 8) and _finite(interaction_distance, 0.1, 3.5) and _finite(collision_radius, 0.05, 2) and _finite(collision_height, 0.05, 4) and _finite(pomeranian_collision_radius, 0.05, 2) and _finite(pomeranian_collision_height, 0.05, 4)

func _fields(value: Dictionary, fields: Array) -> bool:
	return value.size() == fields.size() and fields.all(func(field): return value.has(field))

func _valid_name(value: Variant) -> bool:
	if not value is String or value.is_empty() or value.length() > 48 or value.strip_edges() != value:
		return false
	for index in value.length():
		if value.unicode_at(index) < 32 or value.unicode_at(index) == 127:
			return false
	return true

func _valid_settings(value: Variant) -> bool:
	return value is Dictionary and _fields(value, ["name", "appearanceKey", "following"]) and _valid_name(value.name) and value.appearanceKey is String and value.appearanceKey in APPEARANCES and value.following is bool

func _finite(value: Variant, low: float, high: float) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and float(value) >= low and float(value) <= high
