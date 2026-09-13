extends Node3D

# Reusable rain simulation derived from the accepted rain world. It owns only
# its volume and HUD; the existing player, camera, floor and environment remain.
const WATER = preload("res://addons/cw.module.rain-control/rain_water.gdshader")
const FORMAT := "craftmine.rain-control-state/1"
const GROUP := "craftmine_weather_controllers"
const DROP_COUNT := 2200
const CHUNK_SIZE := 550
const FLOOR_Y := 0.2
const CEILING_Y := 14.0
const FALL_SPEED := -8.5
const RISE_SPEED := 5.6
const PHASE_NAMES := ["Falling", "Slowing", "Suspended", "Reversing", "Rising", "Returning"]
enum Phase { FALL, BRAKE, HOLD, LIFT, RISE, RETURN }

@export var entity_id := "rain"
@export var player_path := NodePath("../Player")
@export var advance_keycode := KEY_U
@export var normal_keycode := KEY_I
@export var automatic_keycode := KEY_O
@export var show_controls := true

var configuration_error := ""
var phase := Phase.FALL
var speed := FALL_SPEED
var phase_age := 0.0
var rain_clock := 0.0
var automatic := false
var casts := 0
var drop_positions := PackedVector3Array()
var drop_sizes := PackedFloat32Array()
var drop_rates := PackedFloat32Array()
var rain_mesh: MultiMesh
var _material: ShaderMaterial
var _identity := ""
var _player: Node3D
var _settings := {"distributionVersion": 1}
var _label: Label
var _next: Button

func _ready() -> void:
	add_to_group("craftmine_persistent_components")
	add_to_group(GROUP)
	_identity = entity_id
	_player = get_node_or_null(player_path) as Node3D
	var pattern := RegEx.new()
	pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
	var matched := pattern.search(_identity)
	if matched == null or matched.get_string() != _identity:
		configuration_error = "RAIN_IDENTITY_INVALID"
	elif _player == null or _player.get_parent() != get_parent():
		configuration_error = "RAIN_EXISTING_WORLD_PLAYER_REQUIRED"
	elif not is_equal_approx(scale.x, 1.0) or not is_equal_approx(scale.y, 1.0) or not is_equal_approx(scale.z, 1.0) or not rotation.is_zero_approx():
		configuration_error = "RAIN_VOLUME_REQUIRES_UNROTATED_UNIT_SCALE"
	else:
		configuration_error = _binding_error()
	_setup_hud()
	if not configuration_error.is_empty():
		_refresh_hud()
		return
	_setup_rain()
	_sync_drops()
	_refresh_hud()

func _binding_error() -> String:
	var keys := [advance_keycode, normal_keycode, automatic_keycode]
	if keys.any(func(key: int) -> bool: return key < KEY_A or key > KEY_Z) or keys[0] == keys[1] or keys[0] == keys[2] or keys[1] == keys[2]:
		return "RAIN_BINDINGS_REQUIRE_THREE_DISTINCT_LETTER_KEYS"
	for action in InputMap.get_actions():
		for event in InputMap.action_get_events(action):
			if event is InputEventKey and not event.ctrl_pressed and not event.alt_pressed and not event.meta_pressed and not event.shift_pressed:
				var code: int = event.physical_keycode if event.physical_keycode != 0 else event.keycode
				if code in keys: return "RAIN_INPUT_BINDING_CONFLICT:" + str(action)
	return ""

func _availability_error() -> String:
	if not configuration_error.is_empty(): return configuration_error
	if entity_id != _identity: return "RAIN_IDENTITY_CHANGED"
	if not is_instance_valid(_player) or _player.get_parent() != get_parent(): return "RAIN_EXISTING_WORLD_PLAYER_REQUIRED"
	if get_parent().has_method("advance_rain") and get_parent().has_method("resume_rain"):
		return "RAIN_EXISTING_WEATHER_CONFLICT"
	for other in get_tree().get_nodes_in_group(GROUP):
		if other != self and other.get_parent() == get_parent() and not other.is_queued_for_deletion():
			return "RAIN_WEATHER_OWNER_CONFLICT"
	return ""

func _setup_rain() -> void:
	_material = ShaderMaterial.new()
	_material.shader = WATER
	rain_mesh = MultiMesh.new()
	rain_mesh.transform_format = MultiMesh.TRANSFORM_3D
	var bead := SphereMesh.new()
	bead.radius = 0.5
	bead.height = 1.0
	bead.radial_segments = 12
	bead.rings = 6
	rain_mesh.mesh = bead
	rain_mesh.instance_count = DROP_COUNT
	var draw := MultiMeshInstance3D.new()
	draw.name = "RainVolume"
	draw.multimesh = rain_mesh
	draw.material_override = _material
	draw.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	draw.custom_aabb = AABB(Vector3(-31, -1, -31), Vector3(62, 17, 62))
	add_child(draw)
	var rng := RandomNumberGenerator.new()
	rng.seed = 470291
	for i in DROP_COUNT:
		var point := Vector3(rng.randf_range(-30, 30), rng.randf_range(FLOOR_Y, CEILING_Y), rng.randf_range(-30, 30))
		var size := rng.randf_range(0.035, 0.073)
		if i < 1700:
			point.x = rng.randf_range(-13.6, 13.6)
			point.z = rng.randf_range(-15.4, 15.8)
		if i < 360:
			point = Vector3(rng.randf_range(-6, 6), rng.randf_range(0.35, 6.5), rng.randf_range(-6, 10))
			size = rng.randf_range(0.10, 0.20)
		drop_positions.append(point)
		drop_sizes.append(size)
		drop_rates.append(rng.randf_range(0.8, 1.2))

func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo or event.alt_pressed or event.ctrl_pressed or event.meta_pressed or event.shift_pressed:
		return
	if get_tree().paused or not _availability_error().is_empty() or get_viewport().gui_get_focus_owner() is LineEdit or get_viewport().gui_get_focus_owner() is TextEdit:
		return
	var code: int = event.physical_keycode if event.physical_keycode != 0 else event.keycode
	var action := "advance" if code == advance_keycode else "normal" if code == normal_keycode else "automatic" if code == automatic_keycode else ""
	if not action.is_empty():
		request_action(action)
		get_viewport().set_input_as_handled()

func request_action(action: String) -> String:
	var problem := _availability_error()
	if not problem.is_empty(): return problem
	if get_tree().paused: return "RAIN_WORLD_PAUSED"
	if action not in ["advance", "normal", "automatic"]: return "RAIN_ACTION_INVALID"
	if action == "normal":
		automatic = false
		if phase != Phase.FALL: _change_phase(Phase.RETURN)
	elif action == "automatic":
		if automatic: return ""
		automatic = true
		casts = mini(2147483647, casts + 1)
		_change_phase(Phase.BRAKE)
	else:
		automatic = false
		if phase in [Phase.FALL, Phase.RETURN]:
			casts = mini(2147483647, casts + 1)
			_change_phase(Phase.BRAKE)
		elif phase == Phase.HOLD: _change_phase(Phase.LIFT)
		elif phase in [Phase.LIFT, Phase.RISE]: _change_phase(Phase.RETURN)
	_refresh_hud()
	return ""

func _change_phase(value: int) -> void:
	phase = value
	phase_age = 0.0
	_refresh_hud()

func _physics_process(delta: float) -> void:
	if not _availability_error().is_empty():
		_refresh_hud()
		return
	phase_age = minf(1.0e12, phase_age + delta)
	match phase:
		Phase.BRAKE:
			speed = move_toward(speed, 0.0, 11.0 * delta)
			if speed == 0.0: _change_phase(Phase.HOLD)
		Phase.HOLD:
			speed = 0.0
			if automatic and phase_age >= 3.2: _change_phase(Phase.LIFT)
		Phase.LIFT:
			speed = move_toward(speed, RISE_SPEED, 4.7 * delta)
			if speed == RISE_SPEED: _change_phase(Phase.RISE)
		Phase.RISE:
			if automatic and phase_age >= 4.5: _change_phase(Phase.RETURN)
		Phase.RETURN:
			speed = move_toward(speed, FALL_SPEED, 9.0 * delta)
			if speed == FALL_SPEED:
				automatic = false
				_change_phase(Phase.FALL)
	if speed != 0.0:
		rain_clock = minf(1.0e12, rain_clock + delta * absf(speed) / 8.5)
		for i in drop_positions.size():
			var point: Vector3 = drop_positions[i]
			point.y = wrapf(point.y + speed * drop_rates[i] * delta, FLOOR_Y, CEILING_Y)
			drop_positions[i] = point
	_sync_drops()

func _sync_drops() -> void:
	if rain_mesh == null: return
	var motion := clampf(absf(speed) / 8.5, 0, 1)
	for i in drop_positions.size():
		var size: float = drop_sizes[i]
		var basis := Basis.IDENTITY.scaled(Vector3(size * lerpf(1.0, 0.3, motion), size * lerpf(1.0, 7.5, motion), size * lerpf(1.0, 0.3, motion)))
		rain_mesh.set_instance_transform(i, Transform3D(basis, drop_positions[i]))
	_material.set_shader_parameter("magic_strength", 1.0 - motion * 0.55)

func _setup_hud() -> void:
	var layer := CanvasLayer.new()
	layer.name = "RainControls"
	layer.layer = 4
	add_child(layer)
	var panel := VBoxContainer.new()
	panel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	panel.position = Vector2(18, -100)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.visible = show_controls
	layer.add_child(panel)
	_label = Label.new()
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(_label)
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(row)
	for item in [["advance", advance_keycode, "Suspend / reverse"], ["normal", normal_keycode, "Normal rain"], ["automatic", automatic_keycode, "Automatic"]]:
		var button := Button.new()
		button.text = OS.get_keycode_string(item[1]) + "  " + item[2]
		button.focus_mode = Control.FOCUS_NONE
		button.pressed.connect(func() -> void: request_action(item[0]))
		row.add_child(button)
		if item[0] == "advance": _next = button

func _refresh_hud() -> void:
	if _label == null: return
	var problem := _availability_error()
	_label.text = "Rain · " + PHASE_NAMES[phase] + (" · Automatic" if automatic else "")
	if problem in ["RAIN_WEATHER_OWNER_CONFLICT", "RAIN_EXISTING_WEATHER_CONFLICT"]: _label.text = "Only one rain effect per world. Remove the extra effect."
	elif not problem.is_empty(): _label.text = "Rain unavailable. Ask AI to fix its controls."
	if _next != null: _next.disabled = not problem.is_empty() or phase == Phase.BRAKE

func snapshot() -> Dictionary:
	var heights := []
	for chunk in range(4):
		var bytes := PackedByteArray()
		bytes.resize(CHUNK_SIZE * 4)
		if drop_positions.size() == DROP_COUNT:
			for i in CHUNK_SIZE: bytes.encode_float(i * 4, drop_positions[chunk * CHUNK_SIZE + i].y)
		heights.append(Marshalls.raw_to_base64(bytes))
	return {"format": FORMAT, "entityId": _identity, "settings": _settings.duplicate(), "sourceSettings": _settings.duplicate(), "phase": phase, "velocity": speed, "phaseAge": phase_age, "rainClock": rain_clock, "automatic": automatic, "casts": casts, "heights": heights}

func _number(value: Variant, low: float, high: float) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and float(value) >= low and float(value) <= high

func _integer(value: Variant, low: int, high: int) -> bool:
	return _number(value, low, high) and float(value) == floor(float(value))

func validate_state(state: Dictionary) -> String:
	var problem := _availability_error()
	if not problem.is_empty(): return problem
	var keys := ["format", "entityId", "settings", "sourceSettings", "phase", "velocity", "phaseAge", "rainClock", "automatic", "casts", "heights"]
	if state.size() != keys.size(): return "RAIN_STATE_FIELDS_INVALID"
	for key in keys:
		if not state.has(key): return "RAIN_STATE_FIELDS_INVALID"
	if state.format != FORMAT or state.entityId != _identity: return "RAIN_STATE_IDENTITY_INVALID"
	for settings in [state.settings, state.sourceSettings]:
		if not settings is Dictionary or settings.size() != 1 or not _integer(settings.get("distributionVersion"), 1, 1): return "RAIN_DISTRIBUTION_INVALID"
	if not _integer(state.phase, 0, 5) or not _number(state.velocity, FALL_SPEED, RISE_SPEED): return "RAIN_PHASE_INVALID"
	if not _number(state.phaseAge, 0, 1.0e12) or not _number(state.rainClock, 0, 1.0e12): return "RAIN_CLOCK_INVALID"
	if not state.automatic is bool or not _integer(state.casts, 0, 2147483647): return "RAIN_CONTROL_STATE_INVALID"
	if state.phase == Phase.FALL and (state.velocity != FALL_SPEED or state.automatic): return "RAIN_PHASE_VELOCITY_MISMATCH"
	if state.phase == Phase.HOLD and state.velocity != 0: return "RAIN_PHASE_VELOCITY_MISMATCH"
	if state.phase == Phase.LIFT and state.velocity < 0: return "RAIN_PHASE_VELOCITY_MISMATCH"
	if state.phase == Phase.RISE and state.velocity != RISE_SPEED: return "RAIN_PHASE_VELOCITY_MISMATCH"
	if not state.heights is Array or state.heights.size() != 4: return "RAIN_HEIGHTS_INVALID"
	for encoded in state.heights:
		if not encoded is String or encoded.length() != 2936: return "RAIN_HEIGHTS_INVALID"
		var bytes := Marshalls.base64_to_raw(encoded)
		if bytes.size() != CHUNK_SIZE * 4 or Marshalls.raw_to_base64(bytes) != encoded: return "RAIN_HEIGHTS_INVALID"
		for i in CHUNK_SIZE:
			if not _number(bytes.decode_float(i * 4), FLOOR_Y, CEILING_Y): return "RAIN_HEIGHT_OUTSIDE_VOLUME"
	if drop_positions.size() != DROP_COUNT or rain_mesh == null: return "RAIN_NOT_READY"
	return ""

func restore(state: Dictionary) -> String:
	var problem := validate_state(state)
	if not problem.is_empty(): return problem
	for chunk in range(4):
		var bytes := Marshalls.base64_to_raw(state.heights[chunk])
		for i in CHUNK_SIZE:
			var index := chunk * CHUNK_SIZE + i
			var point: Vector3 = drop_positions[index]
			point.y = bytes.decode_float(i * 4)
			drop_positions[index] = point
	phase = int(state.phase)
	speed = float(state.velocity)
	phase_age = float(state.phaseAge)
	rain_clock = float(state.rainClock)
	automatic = state.automatic
	casts = int(state.casts)
	_sync_drops()
	_refresh_hud()
	return ""

func validate_restored_state() -> String:
	return validate_state(snapshot())
