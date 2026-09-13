extends CharacterBody3D
## Accessible, deliberately simplified flight dynamics; not a real J-20 simulator.
@export var rest_height := 2.18
var throttle := 0.0
var airspeed := 0.0
var pitch := 0.0
var heading := 0.0
var bank := 0.0
var gear_down := true
var grounded := true
var crashed := false
var assist := true
var afterburner := false
var vertical_speed := 0.0
var flight_seconds := 0.0
var landings := 0
var has_flown := false
var message := "按住 W 增加油门；达到 240 km/h 后按 ↓ 抬头起飞"

func _ready() -> void:
	collision_layer = 16
	collision_mask = 1
	motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	var shape := CollisionShape3D.new()
	var hull := BoxShape3D.new()
	hull.size = Vector3(3.7, 2.1, 12.5)
	shape.shape = hull
	add_child(shape)
	set_meta("entity_id", "j20-player-aircraft")

func toggle_gear() -> void:
	if grounded:
		message = "在地面上不能收起起落架"
		return
	gear_down = not gear_down
	message = "起落架已放下 · 建议进场速度 240–340 km/h" if gear_down else "起落架已收起"

func on_runway() -> bool:
	# The reusable wrapper supplies the source-declared target runway.
	return false

func simulate(delta: float, controls: Dictionary) -> void:
	if crashed: return
	throttle = clampf(throttle + float(controls.get("throttle", 0.0)) * delta * 0.36, 0.0, 1.0)
	afterburner = bool(controls.get("boost", false)) and throttle > 0.8
	var pitch_axis: float = float(controls.get("pitch", 0.0))
	var roll_axis: float = float(controls.get("roll", 0.0))
	var rudder: float = float(controls.get("rudder", 0.0))
	var brake: bool = bool(controls.get("brake", false))
	var authority := clampf(airspeed / 80.0, 0.12, 1.0)
	if grounded:
		heading += (rudder + roll_axis) * 0.42 * clampf(airspeed / 18.0, 0.0, 1.0) * delta
		bank = 0.0
		pitch = clampf(pitch + pitch_axis * 0.3 * authority * delta, 0.0, 0.17) if airspeed > 55.0 else 0.0
	else:
		pitch = clampf(pitch + pitch_axis * 0.55 * authority * delta, -1.15, 1.15)
		bank = clampf(bank + roll_axis * 1.15 * authority * delta, -1.45, 1.45)
		if assist:
			if absf(roll_axis) < 0.01: bank = move_toward(bank, 0.0, delta * 0.21)
			if absf(pitch_axis) < 0.01: pitch = move_toward(pitch, 0.0, delta * 0.075)
		heading += (sin(bank) * 0.56 + rudder * 0.23) * authority * delta
	heading = wrapf(heading, -PI, PI)
	rotation = Vector3(pitch, heading, bank)
	var thrust := throttle * (21.0 + (24.0 if afterburner else 0.0))
	var drag := airspeed * 0.018 + airspeed * airspeed * 0.00012
	if gear_down and not grounded: drag += 3.5
	if grounded: drag += 1.8
	if brake: drag += 32.0 if grounded else 21.0
	airspeed = clampf(airspeed + (thrust - drag - sin(pitch) * 9.8) * delta, 0.0, 430.0)
	if grounded and airspeed > 65.0 and pitch > 0.065:
		grounded = false
		has_flown = true
		message = "已离地！松开俯仰保持平飞，按 G 收起起落架"
	var forward := -basis.z
	var target_velocity := forward * airspeed
	if grounded:
		target_velocity.y = 0.0
		position.y = rest_height
	else:
		flight_seconds += delta
		target_velocity.y -= maxf(0.0, 63.0 - airspeed) * 0.5
		if airspeed < 63.0: message = "低速失速！增加油门，轻推机头恢复速度"
	velocity = velocity.lerp(target_velocity, minf(1.0, delta * (5.0 if grounded else 2.5)))
	vertical_speed = velocity.y
	var collision := move_and_collide(velocity * delta)
	if collision != null:
		crash("发生碰撞 · 按 R 返回跑道")
		return
	if not grounded and position.y <= rest_height:
		if gear_down and on_runway() and vertical_speed > -8.0 and absf(bank) < 0.22 and absf(pitch) < 0.20 and airspeed < 112.0:
			grounded = true
			position.y = rest_height
			pitch = 0.0
			bank = 0.0
			velocity.y = 0.0
			landings += 1
			message = "着陆成功！S 收油门，按住空格刹车"
		else:
			crash("着陆失败：需对准跑道、放下起落架，轻柔接地 · R 重试")
	if grounded and not on_runway() and airspeed > 28.0:
		crash("冲出跑道 · 按 R 重试；起飞请及时抬头")
	if position.y > 6500.0:
		pitch = minf(pitch, -0.08)
		message = "训练空域高度上限 6500 m，请下降"
	if Vector2(position.x, position.z).length() > 12500.0:
		message = "即将离开训练空域，请转向机场；R 可返回跑道"
	if Vector2(position.x, position.z).length() > 15000.0:
		crash("已离开训练空域 · R 返回跑道")

func crash(reason: String) -> void:
	crashed = true
	afterburner = false
	velocity = Vector3.ZERO
	message = reason

func telemetry() -> Dictionary:
	return {"speedKmh": airspeed * 3.6, "altitudeM": position.y - rest_height, "verticalSpeed": vertical_speed, "throttle": throttle, "airborne": not grounded, "crashed": crashed, "gearDown": gear_down, "landings": landings, "position": [position.x, position.y, position.z]}
