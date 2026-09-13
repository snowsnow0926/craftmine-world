extends CharacterBody3D

const Contract = preload("res://scripts/scene_contract.gd")
@export var entity_id := "grove-monster-01"
@export var monster_name := "苔角怪"
@export var tint := Color("47956b")
@export var body_size := 1.0
@export var max_health := 60
@export var attack_damage := 12
@export var move_speed := 2.5
@export var phase_seed := 0.0
var health := 60
var world: Node3D
var combat: Node3D
var player: CharacterBody3D
var home := Vector3.ZERO
var clock_value := 0.0
var attack_wait := 0.0
var windup := 0.0
var flash_time := 0.0
var stagger := 0.0
var knockback := Vector3.ZERO
var aggro := false
var avoid_time := 0.0
var avoid_direction := Vector3.ZERO
var skin_materials: Array[Dictionary] = []
var label: Label3D

func _ready() -> void:
	combat = get_parent() as Node3D
	world = combat.get_parent() as Node3D
	player = world.get_node("Player") as CharacterBody3D
	home = global_position
	health = max_health
	clock_value = phase_seed
	add_to_group("craftmine_persistent_components")
	add_to_group("grove_hostiles")
	set_meta("entity_id", entity_id)
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.60 * body_size
	capsule.height = 1.60 * body_size
	$CollisionShape3D.shape = capsule
	$CollisionShape3D.position.y = 0.80 * body_size
	$Visual.scale = Vector3.ONE * body_size
	for node in $Visual.find_children("*", "MeshInstance3D", true, false):
		var mesh: MeshInstance3D = node as MeshInstance3D
		if not str(mesh.name).begins_with("Skin") and not str(mesh.name).begins_with("BackNodule"): continue
		var material := StandardMaterial3D.new()
		var base := tint.darkened(0.22) if "Paw" in str(mesh.name) or "Nodule" in str(mesh.name) else tint
		material.albedo_color = base
		material.roughness = 0.6
		mesh.material_override = material
		skin_materials.append({"material": material, "colour": base})
	call_deferred("_make_label")

func _make_label() -> void:
	label = Label3D.new()
	label.font = world.get("creation_font") as Font
	label.position.y = 1.82 * body_size
	label.font_size = 25
	label.pixel_size = 0.006
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	add_child(label)
	_refresh_visuals()

func _distance_to_actor() -> float:
	var delta := player.global_position - global_position
	delta.y = 0.0
	return delta.length()

func _line_of_sight() -> bool:
	var origin := global_position + Vector3(0, 0.85 * body_size, 0)
	var target := player.global_position + Vector3(0, 0.15, 0)
	var query := PhysicsRayQueryParameters3D.create(origin, target, 3)
	return get_world_3d().direct_space_state.intersect_ray(query).is_empty()

func _corridor_clear(direction: Vector3) -> bool:
	var side := Vector3(-direction.z, 0, direction.x) * 0.63 * body_size
	for offset: Vector3 in [Vector3.ZERO, side, -side]:
		var origin := global_position + Vector3(0, 0.7 * body_size, 0) + offset
		var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * 1.6, 3)
		if not get_world_3d().direct_space_state.intersect_ray(query).is_empty(): return false
	return true

func _steer(goal: Vector3) -> Vector3:
	var direct := goal - global_position
	direct.y = 0.0
	if direct.length() < 0.25: return Vector3.ZERO
	direct = direct.normalized()
	if avoid_time > 0.0 and _corridor_clear(avoid_direction): return avoid_direction
	if _corridor_clear(direct): return direct
	var side := 1.0 if int(phase_seed) % 2 == 0 else -1.0
	for angle: float in [0.65, -0.65, 1.1, -1.1, 1.57, -1.57, 2.2, -2.2, PI]:
		var choice := direct.rotated(Vector3.UP, angle * side)
		if _corridor_clear(choice):
			avoid_direction = choice
			avoid_time = 0.65
			return choice
	return Vector3.ZERO

func _physics_process(delta: float) -> void:
	if health <= 0 or world.get("ready_for_play") != true: return
	clock_value += delta
	attack_wait = maxf(0.0, attack_wait - delta)
	flash_time = maxf(0.0, flash_time - delta)
	stagger = maxf(0.0, stagger - delta)
	avoid_time = maxf(0.0, avoid_time - delta)
	var distance := _distance_to_actor()
	if combat.get("health") <= 0:
		aggro = false
		windup = 0.0
	elif distance < 8.0 and _line_of_sight():
		aggro = true
	if distance > 13.0 or global_position.distance_to(home) > 12.0: aggro = false
	var wish := Vector3.ZERO
	if stagger > 0.0:
		windup = 0.0
		wish = knockback
		knockback = knockback.move_toward(Vector3.ZERO, delta * 16.0)
	elif windup > 0.0:
		windup = maxf(0.0, windup - delta)
		if windup <= 0.0:
			var height_difference := absf(player.global_position.y - 0.9 - global_position.y)
			if distance < 2.05 * body_size and height_difference < 0.8 and _line_of_sight():
				combat.call("damage_player", attack_damage)
			attack_wait = 1.5
	elif aggro and combat.get("health") > 0:
		if distance < 1.8 * body_size and attack_wait <= 0.0 and _line_of_sight():
			windup = 0.55
		else:
			wish = _steer(player.global_position) * move_speed
	else:
		var goal := home + Vector3(sin(clock_value * 0.35) * 1.2, 0, cos(clock_value * 0.35) * 1.2)
		wish = _steer(goal) * 0.8
	velocity.x = move_toward(velocity.x, wish.x, delta * 9.0)
	velocity.z = move_toward(velocity.z, wish.z, delta * 9.0)
	if windup > 0.0:
		velocity.x = 0.0
		velocity.z = 0.0
	velocity.y = -0.1 if is_on_floor() else maxf(-20.0, velocity.y - 9.8 * delta)
	move_and_slide()
	var facing := player.global_position - global_position if aggro else Vector3(velocity.x, 0, velocity.z)
	facing.y = 0.0
	if facing.length() > 0.1:
		rotation.y = wrapf(lerp_angle(rotation.y, atan2(-facing.x, -facing.z), minf(1.0, delta * 6.0)), -PI, PI)
	_refresh_visuals()

func _refresh_visuals() -> void:
	$Visual.visible = health > 0
	if health > 0:
		var bounce := sin(clock_value * (8.0 if aggro else 4.0))
		var squash := 0.15 if windup > 0.0 else bounce * 0.045
		$Visual.scale = Vector3(1.0 + squash, 1.0 - squash, 1.0 + squash) * body_size
		$Visual.position.y = absf(bounce) * 0.045 if windup <= 0.0 else 0.0
		for item in skin_materials:
			var material: StandardMaterial3D = item.material
			material.albedo_color = Color("fff6d4") if flash_time > 0.0 else (Color("ef6548") if windup > 0.0 else item.colour)
	if label != null:
		label.visible = health > 0 and global_position.distance_to(player.global_position) < 15.0
		label.text = "！准备攻击" if windup > 0.0 else monster_name + "  " + str(health) + "/" + str(max_health)
		label.modulate = Color("ffbc73") if windup > 0.0 else Color.WHITE

func take_hit(amount: int, direction: Vector3) -> bool:
	if health <= 0 or amount <= 0: return false
	health = maxi(0, health - amount)
	flash_time = 0.15
	stagger = 0.3
	windup = 0.0
	aggro = true
	knockback = Vector3(direction.x, 0, direction.z).normalized() * 4.0
	if health == 0:
		velocity = Vector3.ZERO
		collision_layer = 0
		$CollisionShape3D.set_deferred("disabled", true)
		combat.call("monster_defeated", self)
	_refresh_visuals()
	return true

func snapshot() -> Dictionary:
	return {"format": "craftmine.hornling/1", "entityId": entity_id, "sourceSettings": {"maxHealth": max_health}, "settings": {"maxHealth": max_health}, "health": health, "position": [global_position.x, global_position.y, global_position.z], "yaw": rotation.y}

func validate_state(data: Dictionary) -> String:
	if not Contract.fields(data, ["format", "entityId", "sourceSettings", "settings", "health", "position", "yaw"]): return "Invalid monster fields"
	if data.format != "craftmine.hornling/1" or data.entityId != entity_id: return "Monster identity mismatch"
	for key in ["settings", "sourceSettings"]:
		if not Contract.fields(data[key], ["maxHealth"]) or data[key].maxHealth != max_health: return "Monster source settings mismatch"
	if not Contract.integer(data.health, 0, max_health): return "Invalid monster health"
	if not data.position is Array or data.position.size() != 3: return "Invalid monster pose"
	if not Contract.finite(data.position[0], -31.5, 31.5) or not Contract.finite(data.position[1], -0.2, 10) or not Contract.finite(data.position[2], -31.5, 31.5) or not Contract.finite(data.yaw, -PI - 0.001, PI + 0.001): return "Monster pose out of bounds"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	health = int(data.health)
	global_position = Vector3(float(data.position[0]), float(data.position[1]), float(data.position[2]))
	rotation.y = float(data.yaw)
	velocity = Vector3.ZERO
	aggro = false
	windup = 0.0
	stagger = 0.0
	flash_time = 0.0
	avoid_time = 0.0
	attack_wait = 1.0
	collision_layer = 32 if health > 0 else 0
	$CollisionShape3D.set_deferred("disabled", health <= 0)
	_refresh_visuals()
	return ""
