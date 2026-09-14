extends CharacterBody3D

const Contract = preload("res://scripts/scene_contract.gd")
const MAX_HP := 1600
const SWEEP_RADIUS := 5.3
const PHASES := ["idle", "seek", "sweep_wind", "sweep", "charge_wind", "charge", "recover", "dead"]
var health := MAX_HP
var phase := "idle"
var timer := 0.0
var duration := 0.0
var aim := Vector3.FORWARD
var hit_player := false
var attack_count := 0
var combo := false
var charge_distance := 0.0
var clock_time := 0.0
var flash := 0.0
# Presentation clock only; no changes to the saved combat schema or victory accounting.
var death_visual_time := 0.0
var arena: Node3D
var hunter: CharacterBody3D
var joints: Dictionary = {}
var rests: Dictionary = {}
var sector: Node3D
var lane: Node3D
var warning_material: StandardMaterial3D
@onready var visual: Node3D = $Visual
@onready var body_shape: CollisionShape3D = $CollisionShape3D

func _ready() -> void:
	# The hunt root binds the existing heavyblade after all siblings initialize.
	for key in ["TorsoPivot", "HeadPivot", "ArmL", "ArmR", "LegL", "LegR", "TailPivot"]:
		var joint := visual.find_child(key, true, false) as Node3D
		if joint != null:
			joints[key] = joint
			rests[key] = joint.transform
		else:
			push_error("Riftbeast articulation missing: " + key)
	_make_warnings()

func _make_warnings() -> void:
	warning_material = StandardMaterial3D.new()
	warning_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	warning_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	warning_material.albedo_color = Color(1.0, 0.30, 0.04, 0.50)
	sector = Node3D.new()
	add_child(sector)
	# A fan of amber strips displays the actual frontal 200-degree hit sector.
	for i in range(21):
		var angle := deg_to_rad(-100.0 + float(i) * 10.0)
		var strip := _box(Vector3(0.38, 0.025, SWEEP_RADIUS), warning_material)
		sector.add_child(strip)
		strip.rotation.y = angle
		strip.position = Vector3(-sin(angle), 0.0, -cos(angle)) * (SWEEP_RADIUS * 0.5)
		strip.position.y = 0.07
	lane = Node3D.new()
	add_child(lane)
	var road := _box(Vector3(4.8, 0.026, 17.0), warning_material)
	lane.add_child(road)
	road.position = Vector3(0, 0.08, -8.5)
	for i in range(5):
		var arrow := _box(Vector3(0.10, 0.04, 1.3), warning_material)
		lane.add_child(arrow)
		arrow.position = Vector3(0, 0.10, -2.0 - i * 3.0)
	sector.visible = false
	lane.visible = false

func _box(size_value: Vector3, material: Material) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size_value
	node.mesh = mesh
	node.material_override = material
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node

func enraged() -> bool:
	return health > 0 and health <= 720

func start_battle() -> void:
	health = MAX_HP
	global_position = arena.trial_to_global(Vector3(21, 0.04, 9))
	rotation = Vector3.ZERO
	velocity = Vector3.ZERO
	aim = Vector3.FORWARD
	hit_player = false
	attack_count = 0
	combo = false
	charge_distance = 0.0
	_enter("seek", 1.5)
	body_shape.disabled = false

func _enter(next: String, seconds: float) -> void:
	phase = next
	timer = seconds
	duration = seconds
	hit_player = false
	if next == "dead": death_visual_time = 0.0
	if next == "sweep_wind":
		arena.call("tell", "抬臂横扫！向后退，或看准落臂时闪避。" if not combo else "怒意连扫！第二击来了。", seconds + 0.6)
	elif next == "charge_wind":
		arena.call("tell", "压低身体 → 冲撞！路线锁定后向侧面闪避。", seconds + 0.8)
	elif next == "recover":
		arena.call("tell", "巨兽失衡，抓住破绽！", seconds)

func _direction_to_player() -> Vector3:
	var v := hunter.global_position - global_position
	v.y = 0.0
	return v.normalized() if v.length_squared() > 0.001 else -global_basis.z

func _face(direction: Vector3, delta: float, speed: float = 4.0) -> void:
	basis = Basis(Vector3.UP, wrapf(lerp_angle(rotation.y, atan2(-direction.x, -direction.z), minf(1.0, speed * delta)), -PI, PI))

func tick(delta: float, active: bool) -> void:
	clock_time += delta
	flash = maxf(0.0, flash - delta)
	if health <= 0: death_visual_time = minf(2.0, death_visual_time + delta)
	if active and health > 0:
		timer = maxf(0.0, timer - delta)
		var to_player := hunter.global_position - global_position
		to_player.y = 0.0
		var distance := to_player.length()
		velocity.x = 0.0
		velocity.z = 0.0
		match phase:
			"seek":
				var direction := _direction_to_player()
				_face(direction, delta, 3.3)
				if distance > 3.8:
					var speed := 4.5 if enraged() else 3.7
					velocity.x = direction.x * speed
					velocity.z = direction.z * speed
				if timer <= 0.0:
					if distance <= 5.5:
						attack_count += 1
						combo = false
						_enter("sweep_wind", 0.9 if enraged() else 1.15)
					elif distance < 22.0:
						attack_count += 1
						charge_distance = 0.0
						_enter("charge_wind", 1.25 if enraged() else 1.55)
			"sweep_wind":
				if timer > duration * 0.45:
					_face(_direction_to_player(), delta, 5.0)
				if timer <= 0.0: _enter("sweep", 0.32)
			"sweep":
				if not hit_player and distance <= SWEEP_RADIUS and within_sweep(to_player, -global_basis.z):
					hit_player = true
					arena.call("hurt", 32 if enraged() else 28, _direction_to_player())
				if timer <= 0.0:
					if enraged() and attack_count % 2 == 1 and not combo:
						combo = true
						_enter("sweep_wind", 0.72)
					else:
						_enter("recover", 1.65 if combo else 1.35)
			"charge_wind":
				if timer > 0.55:
					aim = _direction_to_player()
					basis = Basis(Vector3.UP, atan2(-aim.x, -aim.z))
				if timer <= 0.0: _enter("charge", 1.3)
			"charge":
				var speed := 14.5 if enraged() else 12.8
				velocity.x = aim.x * speed
				velocity.z = aim.z * speed
				charge_distance += speed * delta
				_charge_contact()
			"recover":
				if timer <= 0.0: _enter("seek", 0.45 if enraged() else 0.75)
		velocity.y = maxf(velocity.y - 9.8 * delta, -20.0)
		move_and_slide()
		if phase == "charge":
			# Contact after sliding matters: a body collision can stop the charge this very tick.
			_charge_contact()
			if is_on_wall():
				var struck_hunter := hit_player
				velocity.x = 0.0
				velocity.z = 0.0
				_enter("recover", 1.4 if struck_hunter else 2.05)
				if not struck_hunter: arena.call("tell", "冲撞撞空！倒地硬直，重击惩罚！", 2.05)
			elif timer <= 0.0 or charge_distance >= 17.0:
				velocity.x = 0.0
				velocity.z = 0.0
				_enter("recover", 1.7)
	_animate(delta)
	sector.visible = active and phase in ["sweep_wind", "sweep"]
	lane.visible = active and phase == "charge_wind"
	warning_material.albedo_color = Color(1.0, 0.08 if phase == "charge_wind" else 0.35, 0.015, 0.30 + 0.24 * absf(sin(clock_time * 8.0)))

func _charge_contact() -> void:
	var offset := hunter.global_position - global_position
	offset.y = 0.0
	if not hit_player and offset.length_squared() <= 2.4 * 2.4:
		hit_player = true
		arena.call("hurt", 45, aim)

static func within_sweep(offset: Vector3, forward: Vector3) -> bool:
	return offset.length_squared() <= SWEEP_RADIUS * SWEEP_RADIUS and (offset.length_squared() < 0.001 or forward.normalized().dot(offset.normalized()) >= cos(deg_to_rad(100.0)))

func _joint_rotation(key: String, value: Vector3) -> void:
	if joints.has(key):
		var node: Node3D = joints[key]
		node.transform = rests[key]
		node.rotation += value

func _show_defeat() -> void:
	# End the breathing/attack pose immediately, fall onto the side, then shrink
	# into the ground and disappear. Only Visual changes; actor pose and health stay saved.
	var fall := clampf(death_visual_time / 0.75, 0.0, 1.0)
	fall = fall * fall * (3.0 - 2.0 * fall)
	var vanish := clampf((death_visual_time - 0.85) / 0.95, 0.0, 1.0)
	_joint_rotation("TorsoPivot", Vector3(-0.30, 0, 0))
	_joint_rotation("HeadPivot", Vector3(0.45, 0, 0))
	_joint_rotation("ArmL", Vector3(0.35, 0, 0.50))
	_joint_rotation("ArmR", Vector3(0.45, 0, -0.45))
	_joint_rotation("LegL", Vector3(-0.35, 0, 0))
	_joint_rotation("LegR", Vector3(-0.20, 0, 0))
	_joint_rotation("TailPivot", Vector3.ZERO)
	visual.rotation = Vector3(0.12 * fall, 0, 1.55 * fall)
	visual.position = Vector3(0, 1.2 * fall - 1.35 * vanish, 0)
	visual.scale = Vector3.ONE * maxf(0.01, 1.0 - vanish)
	visual.visible = death_visual_time < 1.8

func _animate(_delta: float) -> void:
	if health <= 0:
		_show_defeat()
		return
	death_visual_time = 0.0
	visual.visible = true
	visual.scale = Vector3.ONE
	var walk := sin(clock_time * (8.0 if phase == "charge" else 4.6))
	var moving := phase in ["seek", "charge"] and velocity.length_squared() > 0.5
	_joint_rotation("LegL", Vector3(walk * 0.26 if moving else 0.0, 0, 0))
	_joint_rotation("LegR", Vector3(-walk * 0.26 if moving else 0.0, 0, 0))
	_joint_rotation("ArmL", Vector3(-walk * 0.14 if moving else 0.02 * sin(clock_time), 0, 0))
	_joint_rotation("ArmR", Vector3(walk * 0.14 if moving else 0.0, 0, 0))
	_joint_rotation("TorsoPivot", Vector3(0.018 * sin(clock_time * 1.5), 0, 0))
	_joint_rotation("HeadPivot", Vector3(0, 0.035 * sin(clock_time), 0))
	_joint_rotation("TailPivot", Vector3(0, sin(clock_time * 1.4) * 0.12, 0))
	visual.position = Vector3(0, absf(walk) * 0.045 if moving else 0.0, 0)
	visual.rotation = Vector3.ZERO
	if phase == "sweep_wind":
		var progress := 1.0 - timer / maxf(duration, 0.01)
		_joint_rotation("ArmR", Vector3(-0.35, 0.30, -1.4 * progress))
		_joint_rotation("TorsoPivot", Vector3(0.0, -0.55 * progress, 0.0))
	elif phase == "sweep":
		var progress := 1.0 - timer / maxf(duration, 0.01)
		_joint_rotation("ArmR", Vector3(-0.5, -2.0 * progress, -1.4 + 1.1 * progress))
		_joint_rotation("TorsoPivot", Vector3(0, -0.55 + 1.4 * progress, 0))
	elif phase in ["charge_wind", "charge"]:
		_joint_rotation("TorsoPivot", Vector3(-0.30, 0, 0))
		_joint_rotation("HeadPivot", Vector3(0.32, 0, 0))
		_joint_rotation("ArmL", Vector3(-0.55, 0, 0.2))
		_joint_rotation("ArmR", Vector3(-0.55, 0, -0.2))
		visual.position.y = -0.5
	elif phase == "recover":
		_joint_rotation("TorsoPivot", Vector3(-0.18, 0, 0.06 * sin(clock_time * 3.0)))
		visual.position.y = -0.45
	if flash > 0.0: visual.position.x += 0.05 * sin(flash * 100.0)

func take_melee(amount: int) -> int:
	if phase in ["idle", "dead"] or health <= 0: return 0
	var damage := roundi(amount * (1.25 if phase == "recover" else 1.0))
	health = maxi(0, health - damage)
	flash = 0.18
	if health == 0:
		_enter("dead", 0.0)
		velocity = Vector3.ZERO
		body_shape.set_deferred("disabled", true)
		arena.call("victory")
	return damage

func snapshot() -> Dictionary:
	return {"health": health, "phase": phase, "timer": timer, "duration": duration, "position": [position.x, position.y, position.z], "yaw": rotation.y, "aim": [aim.x, aim.y, aim.z], "hit": hit_player, "count": attack_count, "combo": combo, "distance": charge_distance}

func validate_state(data: Dictionary) -> String:
	if not Contract.fields(data, ["health", "phase", "timer", "duration", "position", "yaw", "aim", "hit", "count", "combo", "distance"]): return "Invalid riftbeast fields"
	if not Contract.integer(data.health, 0, MAX_HP) or not data.phase in PHASES: return "Invalid riftbeast phase or health"
	for key in ["timer", "duration", "distance"]:
		if not Contract.finite(data[key], 0.0, 100.0): return "Invalid riftbeast timer"
	for key in ["position", "aim"]:
		if not data[key] is Array or data[key].size() != 3: return "Invalid riftbeast vector"
		for number in data[key]:
			if not Contract.finite(number, -64.0, 64.0): return "Invalid riftbeast vector value"
	if not Contract.finite(data.yaw, -7.0, 7.0) or not Contract.integer(data.count, 0, 1000000): return "Invalid riftbeast facing or count"
	if not data.hit is bool or not data.combo is bool: return "Invalid riftbeast hit state"
	if (data.health == 0) != (data.phase == "dead"): return "Riftbeast defeat state mismatch"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if problem != "": return problem
	health = int(data.health)
	phase = str(data.phase)
	timer = float(data.timer)
	duration = float(data.duration)
	position = Vector3(data.position[0], data.position[1], data.position[2])
	# Preserve the real Euler cache without accumulating scale from an old basis.
	basis = Basis.IDENTITY
	rotation = Vector3(0.0, float(data.yaw), 0.0)
	aim = Vector3(data.aim[0], data.aim[1], data.aim[2])
	hit_player = data.hit
	attack_count = int(data.count)
	combo = data.combo
	charge_distance = float(data.distance)
	velocity = Vector3.ZERO
	body_shape.disabled = health == 0
	# A saved kill is already complete. Do not replay a live-looking stance on load.
	death_visual_time = 2.0 if health == 0 else 0.0
	_animate(0.0)
	return ""
