extends Node3D

const FORMAT := "craftmine.sandbox-weapon-state/1"
const GROUP := "craftmine_player_weapons"
@export var entity_id := ""
@export var player_path := NodePath("../Player")
@export var damage := 20.0
@export var range_meters := 30.0
@export var cooldown_seconds := 0.35
@export var max_ammo := 12
var ammo := 0
var remaining_cooldown := 0.0
var shots_fired := 0
var _player: Node3D
var _identity := ""
var _source: Dictionary = {}
var _visual: MeshInstance3D

func _ready() -> void:
	_identity = entity_id
	_source = _configuration()
	_source.make_read_only()
	ammo = max_ammo
	_player = get_node_or_null(player_path) as Node3D
	add_to_group(GROUP)
	add_to_group("craftmine_persistent_components")
	if not _configuration_error().is_empty(): return
	var mount := _player.get_node_or_null("CameraRig/PitchPivot/Camera3D/WeaponMount")
	if mount != null:
		_visual = MeshInstance3D.new()
		var mesh := BoxMesh.new()
		mesh.size = Vector3(0.13, 0.15, 0.45)
		_visual.mesh = mesh
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(0.18, 0.24, 0.3)
		material.metallic = 0.5
		_visual.material_override = material
		_visual.position = Vector3(0.22, -0.18, -0.45)
		mount.add_child(_visual)

func _configuration() -> Dictionary:
	return JSON.parse_string(JSON.stringify({"damage": damage, "range": range_meters, "cooldown": cooldown_seconds, "maxAmmo": max_ammo}))

func _configuration_error() -> String:
	if not is_inside_tree() or get_parent() != get_tree().current_scene: return "WEAPON_WORLD_INVALID"
	var pattern := RegEx.new()
	pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
	var matched := pattern.search(_identity)
	if matched == null or matched.get_string() != _identity or entity_id != _identity: return "WEAPON_IDENTITY_INVALID"
	if not is_instance_valid(_player) or _player.get_parent() != get_parent(): return "WEAPON_PLAYER_INVALID"
	if not is_finite(damage) or damage <= 0.0 or damage > 999999.0 or not is_finite(range_meters) or range_meters < 0.5 or range_meters > 80.0 or not is_finite(cooldown_seconds) or cooldown_seconds < 0.05 or cooldown_seconds > 60.0 or max_ammo < 1 or max_ammo > 999999: return "WEAPON_CONFIGURATION_INVALID"
	if _configuration() != _source: return "WEAPON_CONFIGURATION_CHANGED"
	for peer in get_tree().get_nodes_in_group(GROUP):
		if peer != self and peer.get_parent() == get_parent() and peer.get("_player") == _player: return "WEAPON_DUPLICATE_PLAYER"
	return ""

func _physics_process(delta: float) -> void:
	if not get_tree().paused:
		remaining_cooldown = maxf(0.0, remaining_cooldown - delta)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed and is_instance_valid(_player) and _player.get("captured") == true:
		attack(_player)
		get_viewport().set_input_as_handled()

func _result(fired: bool, reason: String, target_id := "", applied := 0.0) -> Dictionary:
	return {"fired": fired, "reason": reason, "entityId": _identity, "hit": not target_id.is_empty(), "targetId": target_id, "damage": applied, "ammo": ammo, "remainingCooldown": remaining_cooldown, "shotsFired": shots_fired}

func attack(player: Node3D) -> Dictionary:
	var problem := _configuration_error()
	if not problem.is_empty(): return _result(false, problem)
	if player != _player: return _result(false, "wrong-player")
	if get_tree().paused: return _result(false, "paused")
	var vitals: Array[Node] = []
	for node in get_tree().get_nodes_in_group("craftmine_player_vitals"):
		if node.get_parent() == get_parent() and node.get("_player") == player: vitals.append(node)
	if vitals.size() != 1: return _result(false, "vitals-unavailable")
	var hp: Variant = vitals[0].get("health")
	if not (hp is float or hp is int) or not is_finite(float(hp)) or hp <= 0: return _result(false, "player-dead")
	if remaining_cooldown > 0.0: return _result(false, "cooldown")
	if ammo <= 0: return _result(false, "empty")
	if shots_fired >= 999999999: return _result(false, "shot-counter-full")
	var camera := get_viewport().get_camera_3d()
	if camera == null or not player.is_ancestor_of(camera): return _result(false, "no-player-camera")
	var center := camera.get_viewport().get_visible_rect().size * 0.5
	var origin := camera.project_ray_origin(center)
	var direction := camera.project_ray_normal(center).normalized()
	var excluded: Array[RID] = []
	if player is CollisionObject3D: excluded.append(player.get_rid())
	for body in player.find_children("*", "CollisionObject3D", true, false): excluded.append(body.get_rid())
	for body in find_children("*", "CollisionObject3D", true, false): excluded.append(body.get_rid())
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * range_meters, 4294967295, excluded)
	query.collide_with_areas = true
	var hit := camera.get_world_3d().direct_space_state.intersect_ray(query)
	ammo -= 1
	shots_fired += 1
	remaining_cooldown = cooldown_seconds
	if hit.is_empty(): return _result(true, "miss")
	var target := hit.collider as Node
	while target != null and target != get_parent():
		if target == player or player.is_ancestor_of(target) or target == self: break
		if target.is_in_group("craftmine_damageable_targets") and target.has_method("apply_damage"):
			var target_id: Variant = target.get("entity_id")
			if not target_id is String or target_id.is_empty(): return _result(true, "invalid-target")
			var result: Variant = target.apply_damage(damage, player)
			if not result is Dictionary: return _result(true, "invalid-damage-receipt")
			var applied: Variant = result.get("applied")
			if not (applied is float or applied is int) or not is_finite(float(applied)) or applied < 0 or applied > damage: return _result(true, "invalid-damage-receipt")
			return _result(true, "", target_id, float(applied))
		target = target.get_parent()
	return _result(true, "obstructed")

func snapshot() -> Dictionary:
	return JSON.parse_string(JSON.stringify({"format": FORMAT, "entityId": _identity, "settings": _source, "sourceSettings": _source, "ammo": ammo, "remainingCooldown": remaining_cooldown, "shotsFired": shots_fired}))

func validate_state(data: Dictionary) -> String:
	var problem := _configuration_error()
	if not problem.is_empty(): return problem
	var fields := ["format", "entityId", "settings", "sourceSettings", "ammo", "remainingCooldown", "shotsFired"]
	if data.size() != fields.size() or not fields.all(func(key): return data.has(key)) or data.format != FORMAT or data.entityId != _identity: return "WEAPON_STATE_IDENTITY_INVALID"
	if data.settings != _source or data.sourceSettings != _source: return "WEAPON_SOURCE_SETTINGS_CHANGED"
	if not _integer(data.ammo, 0, max_ammo) or not _integer(data.shotsFired, 0, 999999999): return "WEAPON_PROGRESS_INVALID"
	var value: Variant = data.remainingCooldown
	if not (value is float or value is int) or not is_finite(float(value)) or value < 0.0 or value > cooldown_seconds: return "WEAPON_COOLDOWN_INVALID"
	return ""

func _integer(value: Variant, low: int, high: int) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and float(value) == floorf(float(value)) and value >= low and value <= high

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	ammo = int(data.ammo)
	remaining_cooldown = float(data.remainingCooldown)
	shots_fired = int(data.shotsFired)
	return ""

func _exit_tree() -> void:
	if is_instance_valid(_visual): _visual.queue_free()
