extends CharacterBody3D

const FORMAT := "craftmine.sandbox-monster-state/1"
const Contract = preload("res://scripts/scene_contract.gd")
@export var entity_id := ""
@export var player_path := NodePath("../Player")
@export var maximum_health := 60.0
@export var attack_damage := 8.0
@export var attack_cooldown := 1.0
@export var move_speed := 1.8
@export var reward_id := "monster-token"
@export var reward_count := 1
var health := 60.0
var remaining_cooldown := 0.0
var loot_taken := false
var _source: Dictionary
var _identity := ""
var _player: Node3D
var _heading := 0.0
var _shape: CollisionShape3D
var _visual: Node3D
var _body_material: StandardMaterial3D
var _flash := 0.0

func _ready() -> void:
	_identity = entity_id
	_source = JSON.parse_string(JSON.stringify({"maximumHealth": maximum_health, "attackDamage": attack_damage, "attackCooldown": attack_cooldown, "moveSpeed": move_speed, "rewardId": reward_id, "rewardCount": reward_count}))
	_source.make_read_only()
	_player = get_node_or_null(player_path) as Node3D
	health = maximum_health
	add_to_group("craftmine_persistent_components")
	add_to_group("craftmine_damageable_targets")
	_shape = CollisionShape3D.new()
	_shape.name = "CollisionShape3D"
	var cylinder := CylinderShape3D.new()
	cylinder.radius = 0.5
	cylinder.height = 1.5
	_shape.shape = cylinder
	_shape.position.y = 0.75
	add_child(_shape)
	collision_layer = 2
	collision_mask = 11
	floor_snap_length = 0.15
	_heading = global_rotation.y
	_make_visual()

func _valid_configuration() -> bool:
	var pattern := RegEx.new()
	pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
	var matched := pattern.search(_identity)
	return matched != null and matched.get_string() == _identity and entity_id == _identity and is_instance_valid(_player) and _finite(maximum_health, 1, 999999) and _finite(attack_damage, 0, 999999) and _finite(attack_cooldown, 0.1, 60) and _finite(move_speed, 0, 12) and Contract.identifier(reward_id) and reward_count >= 1 and reward_count <= 999999

func _vitals() -> Node:
	var found: Node
	for node in get_tree().get_nodes_in_group("craftmine_player_vitals"):
		if get_tree().current_scene.is_ancestor_of(node) and node.get("_player") == _player:
			if found != null: return null
			found = node
	return found

func _physics_process(delta: float) -> void:
	if not _valid_configuration(): return
	remaining_cooldown = maxf(0, remaining_cooldown - delta)
	var desired := Vector3.ZERO
	var offset := _player.global_position - global_position
	var vitals := _vitals()
	if health > 0 and vitals != null and vitals.health > 0 and absf(offset.y) < 1.8:
		offset.y = 0
		if offset.length() > 1.6:
			desired = offset.normalized() * minf(move_speed, (offset.length() - 1.6) * 4)
		if offset.length() <= 2.2 and remaining_cooldown <= 0 and _clear_sight(global_position + Vector3(0, 1, 0), _player.global_position):
			if vitals.take_damage(attack_damage) > 0: remaining_cooldown = attack_cooldown
	velocity.x = move_toward(velocity.x, desired.x, delta * 8)
	velocity.z = move_toward(velocity.z, desired.z, delta * 8)
	velocity.y = -0.1 if is_on_floor() else maxf(velocity.y - delta * 9.8, -30)
	move_and_slide()
	if desired.length() > 0.05:
		_heading = atan2(-desired.x, -desired.z)
		global_rotation.y = _heading
	_flash = maxf(0, _flash - delta)
	_body_material.albedo_color = Color(1, 0.3, 0.2) if _flash > 0 else (Color(0.22, 0.27, 0.19) if health <= 0 else Color(0.22, 0.55, 0.28))

func _clear_sight(from: Vector3, to: Vector3) -> bool:
	var query := PhysicsRayQueryParameters3D.create(from, to, 3)
	query.exclude = [get_rid(), _player.get_rid()]
	return get_world_3d().direct_space_state.intersect_ray(query).is_empty()

func apply_damage(amount: float, player: Node3D) -> Dictionary:
	if get_tree().paused or not _valid_configuration() or player != _player or health <= 0 or not is_finite(amount) or amount <= 0:
		return {"applied": 0.0, "entityId": _identity}
	var applied := minf(health, amount)
	health -= applied
	_flash = 0.15
	if health <= 0:
		velocity.x = 0
		velocity.z = 0
		_visual.scale = Vector3(1.1, 0.3, 1.1)
	return {"applied": applied, "remaining": health, "defeated": health <= 0, "entityId": _identity}

func interact(player: Node3D) -> Dictionary:
	if get_tree().paused or player != _player or health > 0 or loot_taken or not _valid_configuration():
		return {"interacted": false, "reason": "loot-unavailable"}
	var vitals := _vitals()
	if vitals == null or vitals.health <= 0: return {"interacted": false, "reason": "player-dead"}
	var camera := player.get_node_or_null("CameraRig/PitchPivot/Camera3D") as Camera3D
	if camera == null or camera.global_position.distance_to(global_position + Vector3(0, 0.75, 0)) > 3 or not _clear_sight(camera.global_position, global_position + Vector3(0, 0.75, 0)):
		return {"interacted": false, "reason": "out-of-range-or-blocked"}
	var world := get_tree().current_scene
	var inventory: Variant = world.get("inventory")
	if not inventory is Dictionary: return {"interacted": false, "reason": "inventory-unavailable"}
	var previous: Variant = inventory.get(reward_id, 0)
	if not _finite(previous, 0, 999999) or float(previous) != floorf(float(previous)) or previous + reward_count > 999999 or (not inventory.has(reward_id) and inventory.size() >= 4096):
		return {"interacted": false, "reason": "inventory-limit"}
	inventory[reward_id] = int(previous) + reward_count
	loot_taken = true
	return {"interacted": true, "entityId": _identity, "feedback": "获得 %s × %d" % [reward_id, reward_count]}

func snapshot() -> Dictionary:
	return JSON.parse_string(JSON.stringify({"format": FORMAT, "entityId": _identity, "settings": _source, "sourceSettings": _source, "position": [global_position.x, global_position.y, global_position.z], "yaw": _heading, "health": health, "remainingCooldown": remaining_cooldown, "lootTaken": loot_taken}))

func validate_state(data: Dictionary) -> String:
	var fields := ["format", "entityId", "settings", "sourceSettings", "position", "yaw", "health", "remainingCooldown", "lootTaken"]
	if not _valid_configuration() or data.size() != fields.size() or not fields.all(func(key): return data.has(key)) or data.format != FORMAT or data.entityId != _identity: return "MONSTER_STATE_INVALID"
	if data.settings != _source or data.sourceSettings != _source: return "MONSTER_SOURCE_SETTINGS_CHANGED"
	if not data.position is Array or data.position.size() != 3 or not data.position.all(func(value): return _finite(value, -80, 80)) or not _finite(data.yaw, -PI, PI): return "MONSTER_POSE_INVALID"
	if not _finite(data.health, 0, maximum_health) or not _finite(data.remainingCooldown, 0, attack_cooldown) or not data.lootTaken is bool or (data.lootTaken and data.health > 0): return "MONSTER_PROGRESS_INVALID"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	global_position = Vector3(data.position[0], data.position[1], data.position[2])
	_heading = float(data.yaw)
	global_rotation.y = _heading
	health = float(data.health)
	remaining_cooldown = float(data.remainingCooldown)
	loot_taken = data.lootTaken
	velocity = Vector3.ZERO
	_visual.scale = Vector3(1.1, 0.3, 1.1) if health <= 0 else Vector3.ONE
	_flash = 0
	return ""

func _finite(value: Variant, low: float, high: float) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and value >= low and value <= high

func validate_restored_state() -> String:
	if not _upright(_shape.global_transform): return "MONSTER_RESTORE_TRANSFORM_INVALID"
	var inset := CylinderShape3D.new()
	inset.radius = 0.498
	inset.height = 1.496
	var excluded: Array[RID] = [get_rid()]
	var bodies: Array[PhysicsBody3D] = [_player]
	for peer in get_tree().get_nodes_in_group("craftmine_persistent_components"):
		if peer is PhysicsBody3D and peer != self and peer not in bodies and get_tree().current_scene.is_ancestor_of(peer): bodies.append(peer)
	# Restored kinematic broadphase poses can lag one frame. Compare supported
	# current shapes analytically, then query the remaining static scene natively.
	for body in bodies:
		excluded.append(body.get_rid())
		if body.collision_layer & collision_mask == 0: continue
		for owner_id in body.get_shape_owners():
			if body.is_shape_owner_disabled(owner_id): continue
			var owner_node := body.shape_owner_get_owner(owner_id) as Node3D
			var pose := owner_node.global_transform if owner_node != null else body.global_transform * body.shape_owner_get_transform(owner_id)
			if not _upright(pose): return "MONSTER_RESTORE_TRANSFORM_INVALID"
			var a := _shape.global_position
			var b := pose.origin
			var distance := Vector2(a.x - b.x, a.z - b.z).length()
			for index in body.shape_owner_get_shape_count(owner_id):
				var shape := body.shape_owner_get_shape(owner_id, index)
				if shape is CylinderShape3D:
					if distance < inset.radius + shape.radius and absf(a.y - b.y) < (inset.height + shape.height) / 2: return "MONSTER_RESTORE_OVERLAP"
				elif shape is CapsuleShape3D:
					var segment_half := maxf(0, shape.height / 2 - shape.radius)
					var vertical := maxf(0, maxf((a.y - inset.height / 2) - (b.y + segment_half), (b.y - segment_half) - (a.y + inset.height / 2)))
					var radial := maxf(0, distance - inset.radius)
					if radial * radial + vertical * vertical < shape.radius * shape.radius: return "MONSTER_RESTORE_OVERLAP"
				else: return "MONSTER_RESTORE_SHAPE_UNSUPPORTED"
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = inset
	query.transform = _shape.global_transform
	query.collision_mask = collision_mask
	query.exclude = excluded
	query.margin = 0
	return "" if get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty() else "MONSTER_RESTORE_OVERLAP"

func _upright(pose: Transform3D) -> bool:
	return pose.basis.is_equal_approx(pose.basis.orthonormalized()) and pose.basis.y.distance_to(Vector3.UP) < 0.00001 and pose.basis.determinant() > 0

func _make_visual() -> void:
	_visual = Node3D.new()
	_visual.name = "VisualPivot"
	add_child(_visual)
	_body_material = StandardMaterial3D.new()
	_body_material.albedo_color = Color(0.22, 0.55, 0.28)
	_sphere(Vector3(0, 0.65, 0), 0.34, 0.8, _body_material)
	_sphere(Vector3(0, 1.05, -0.025), 0.29, 0.55, _body_material)
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.12, 0.07, 0.025)
	var ivory := StandardMaterial3D.new()
	ivory.albedo_color = Color(0.95, 0.85, 0.6)
	for sign_value in [-1, 1]:
		_sphere(Vector3(sign_value * 0.115, 1.11, -0.275), 0.047, 0.08, dark)
		_sphere(Vector3(sign_value * 0.32, 0.6, -0.02), 0.11, 0.36, _body_material)
		_sphere(Vector3(sign_value * 0.16, 0.13, -0.07), 0.14, 0.22, dark)
		var horn := CylinderMesh.new()
		horn.top_radius = 0
		horn.bottom_radius = 0.07
		horn.height = 0.18
		horn.radial_segments = 8
		var mesh := MeshInstance3D.new()
		mesh.mesh = horn
		mesh.material_override = ivory
		mesh.position = Vector3(sign_value * 0.18, 1.31, 0)
		_visual.add_child(mesh)

func _sphere(at: Vector3, radius: float, height: float, material: Material) -> void:
	var shape := SphereMesh.new()
	shape.radius = radius
	shape.height = height
	shape.radial_segments = 12
	shape.rings = 6
	var mesh := MeshInstance3D.new()
	mesh.mesh = shape
	mesh.material_override = material
	mesh.position = at
	_visual.add_child(mesh)
