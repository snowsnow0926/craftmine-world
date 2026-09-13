extends RefCounted
## Versioned JSON-only component payload; the managed world envelope owns world identity.
const FORMAT := "craftmine.j20-flight-state/1"
const ENTITY_ID := "j20-player-aircraft"
const JetController = preload("res://scripts/j20_controller.gd")

static func vector(value: Vector3) -> Array:
	return [value.x, value.y, value.z]

static func vec(value: Array) -> Vector3:
	return Vector3(float(value[0]), float(value[1]), float(value[2]))

static func initial() -> Dictionary:
	return {"format": FORMAT, "stateVersion": 1, "entityId": ENTITY_ID, "settings": {"flightModelVersion": 1}, "sourceSettings": {"flightModelVersion": 1}, "started": false, "cockpitView": false, "gateIndex": 0, "gearExtension": 1.0,
		"camera": {"position": vector(Vector3(24, 12.18, 152)), "rotation": [0.0, 0.0, 0.0], "fov": 62.0},
		"aircraft": {"position": vector(Vector3(0, 2.18, 180)), "rotation": [0.0, 0.0, 0.0], "velocity": [0.0, 0.0, 0.0], "pitch": 0.0, "heading": 0.0, "bank": 0.0, "airspeed": 0.0, "throttle": 0.0, "gearDown": true, "grounded": true, "crashed": false, "assist": true, "afterburner": false, "verticalSpeed": 0.0, "flightSeconds": 0.0, "landings": 0, "hasFlown": false, "message": "按住 W 加油门；240 km/h 后按 ↓ 抬头起飞"}}

static func capture_jet(jet: CharacterBody3D) -> Dictionary:
	return {"position": vector(jet.position), "rotation": vector(jet.rotation), "velocity": vector(jet.velocity), "pitch": jet.pitch, "heading": jet.heading, "bank": jet.bank, "airspeed": jet.airspeed, "throttle": jet.throttle, "gearDown": jet.gear_down, "grounded": jet.grounded, "crashed": jet.crashed, "assist": jet.assist, "afterburner": jet.afterburner, "verticalSpeed": jet.vertical_speed, "flightSeconds": jet.flight_seconds, "landings": jet.landings, "hasFlown": jet.has_flown, "message": jet.message}

static func capture(session: Node3D) -> Dictionary:
	return {"format": FORMAT, "stateVersion": 1, "entityId": ENTITY_ID, "settings": {"flightModelVersion": 1}, "sourceSettings": {"flightModelVersion": 1}, "started": session.flight_started, "cockpitView": session.cockpit_view, "gateIndex": session.gate_index, "gearExtension": session.gear_model.scale.y, "camera": session.saved_camera.duplicate(true), "aircraft": capture_jet(session.jet)}

static func _fields(value: Variant, keys: Array) -> bool:
	if not value is Dictionary or value.size() != keys.size(): return false
	for key in keys:
		if not value.has(key): return false
	return true

static func _number(value: Variant, lower: float, upper: float) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and float(value) >= lower and float(value) <= upper

static func _vector(value: Variant, lower: float, upper: float) -> bool:
	if not value is Array or value.size() != 3: return false
	for number in value:
		if not _number(number, lower, upper): return false
	return true

static func validate(state: Variant) -> String:
	if not _fields(state, ["format", "stateVersion", "entityId", "settings", "sourceSettings", "started", "cockpitView", "gateIndex", "gearExtension", "camera", "aircraft"]): return "飞行存档字段不完整"
	if state.format != FORMAT or state.entityId != ENTITY_ID or not _number(state.stateVersion, 1, 1): return "飞行存档身份或版本不兼容"
	# JSON parses all numbers as floating point. Validate the numeric version,
	# not strict Dictionary equality against an in-memory integer literal.
	for key in ["settings", "sourceSettings"]:
		if not _fields(state[key], ["flightModelVersion"]) or not _number(state[key].flightModelVersion, 1, 1): return "飞行模型版本不兼容"
	if not state.started is bool or not state.cockpitView is bool: return "无效的驾驶状态"
	if not _number(state.gateIndex, 0, 7) or float(state.gateIndex) != floorf(float(state.gateIndex)): return "无效的航标进度"
	if not _number(state.gearExtension, 0.034, 1.001): return "无效的起落架动画状态"
	var view: Variant = state.camera
	if not _fields(view, ["position", "rotation", "fov"]) or not _vector(view.position, -22000, 22000) or not _vector(view.rotation, -3.142, 3.142) or not _number(view.fov, 20, 100): return "无效的驾驶镜头"
	var jet: Variant = state.aircraft
	if not _fields(jet, ["position", "rotation", "velocity", "pitch", "heading", "bank", "airspeed", "throttle", "gearDown", "grounded", "crashed", "assist", "afterburner", "verticalSpeed", "flightSeconds", "landings", "hasFlown", "message"]): return "飞机状态字段不完整"
	if not _vector(jet.position, -16000, 16000) or not _number(jet.position[1], -20, 8000): return "飞机位置超出训练空域"
	if not _vector(jet.rotation, -3.142, 3.142) or not _vector(jet.velocity, -500, 500): return "无效的飞机姿态或速度矢量"
	if not _number(jet.pitch, -1.151, 1.151) or not _number(jet.heading, -PI, PI) or not _number(jet.bank, -1.451, 1.451): return "无效的飞控姿态"
	if not _number(jet.airspeed, 0, 430) or not _number(jet.throttle, 0, 1) or not _number(jet.verticalSpeed, -500, 500): return "无效的速度或油门"
	if not _number(jet.flightSeconds, 0, 1.0e12) or not _number(jet.landings, 0, 1.0e9) or float(jet.landings) != floorf(float(jet.landings)): return "无效的飞行记录"
	for key in ["gearDown", "grounded", "crashed", "assist", "afterburner", "hasFlown"]:
		if not jet[key] is bool: return "无效的飞机开关状态：" + key
	if not jet.message is String or jet.message.length() > 512: return "无效的飞行提示"
	if jet.grounded and absf(float(jet.position[1]) - 2.18) > 0.001: return "地面状态与飞机高度不符"
	return ""

static func apply_jet(jet: CharacterBody3D, state: Dictionary) -> void:
	# Caller validates the complete packet before any mutation. Preserve actual
	# pose separately from control angles, including a save on a touchdown tick.
	jet.position = vec(state.position)
	jet.rotation = vec(state.rotation)
	jet.velocity = vec(state.velocity)
	jet.pitch = float(state.pitch)
	jet.heading = float(state.heading)
	jet.bank = float(state.bank)
	jet.airspeed = float(state.airspeed)
	jet.throttle = float(state.throttle)
	jet.gear_down = state.gearDown
	jet.grounded = state.grounded
	jet.crashed = state.crashed
	jet.assist = state.assist
	jet.afterburner = state.afterburner
	jet.vertical_speed = float(state.verticalSpeed)
	jet.flight_seconds = float(state.flightSeconds)
	jet.landings = int(state.landings)
	jet.has_flown = state.hasFlown
	jet.message = state.message

static func round_trip_probe(parent: Node3D) -> Dictionary:
	# New independent controllers, never the player's plane. Drive real movement,
	# serialize its output, restore another node, and compare subsequent physics.
	var a: CharacterBody3D = JetController.new()
	var b: CharacterBody3D = JetController.new()
	parent.add_child(a)
	parent.add_child(b)
	a.reset_flight(true)
	a.pitch = 0.19
	a.heading = 0.64
	a.bank = -0.37
	a.assist = false
	a.throttle = 0.71
	a.gear_down = false
	for i in 45: a.simulate(1.0 / 60.0, {"roll": 0.1, "throttle": 0.2})
	var packet := initial()
	packet.started = true
	packet.cockpitView = true
	packet.gearExtension = 0.35
	packet.gateIndex = 3
	packet.aircraft = capture_jet(a)
	packet.camera = {"position": vector(Vector3(11.25, 512.75, -850.5)), "rotation": vector(Vector3(0.12, 0.45, -0.17)), "fov": 78.0}
	var wire: Dictionary = JSON.parse_string(JSON.stringify(packet))
	var reason := validate(wire)
	if not reason.is_empty(): push_error("J20_PERSISTENCE_VALIDATION: " + reason + " " + JSON.stringify(wire))
	var results := {"nonDefaultStateValid": reason.is_empty(), "defaultJSONValid": validate(JSON.parse_string(JSON.stringify(initial()))).is_empty()}
	apply_jet(b, wire.aircraft)
	results["allAircraftFieldsRoundTrip"] = JSON.parse_string(JSON.stringify(capture_jet(b))) == wire.aircraft
	var camera_node := Camera3D.new()
	parent.add_child(camera_node)
	camera_node.position = vec(wire.camera.position)
	camera_node.rotation = vec(wire.camera.rotation)
	camera_node.fov = float(wire.camera.fov)
	var restored_view := {"position": vector(camera_node.position), "rotation": vector(camera_node.rotation), "fov": camera_node.fov}
	results["cameraPoseRoundTrip"] = JSON.parse_string(JSON.stringify(restored_view)) == wire.camera and wire.cockpitView == true
	a.simulate(1.0 / 60.0, {"pitch": -0.3})
	b.simulate(1.0 / 60.0, {"pitch": -0.3})
	results["continuedMotionMatches"] = a.position.distance_to(b.position) < 0.001 and a.velocity.distance_to(b.velocity) < 0.001 and absf(a.airspeed - b.airspeed) < 0.000001
	var before: Dictionary = capture_jet(b)
	var corrupt: Dictionary = wire.duplicate(true)
	corrupt.aircraft.throttle = 4.0
	results["invalidStateRejectedWithoutMutation"] = not validate(corrupt).is_empty() and before == capture_jet(b)
	corrupt = wire.duplicate(true)
	corrupt.stateVersion = 99
	results["unknownVersionRejected"] = not validate(corrupt).is_empty()
	corrupt = wire.duplicate(true)
	corrupt.aircraft.position[0] = NAN
	results["nonFiniteRejected"] = not validate(corrupt).is_empty()
	camera_node.free()
	a.free()
	b.free()
	return results
