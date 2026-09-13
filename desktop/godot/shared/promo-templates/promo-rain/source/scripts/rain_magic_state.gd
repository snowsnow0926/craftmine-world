extends Node

# Normal persistent component: the bundled adapter owns capture, validation, transaction and rollback.
const RainWorld = preload("res://scripts/rain_world.gd")
const FORMAT := "craftmine.rain-magic-state/1"
const SOURCE_SETTINGS := {"distributionVersion":1}
const CHUNK_SIZE := 550
const CHUNKS := 4
var entity_id := "rain-magic"
var rain: RainWorld

func _ready() -> void:
	rain = get_parent() as RainWorld
	add_to_group("craftmine_persistent_components")

func snapshot() -> Dictionary:
	if not is_instance_valid(rain) or not rain.rain_ready: return {}
	var heights := []
	for chunk in range(CHUNKS):
		var bytes := PackedByteArray()
		bytes.resize(CHUNK_SIZE*4)
		for i in range(CHUNK_SIZE):
			bytes.encode_float(i*4,rain.drop_positions[chunk*CHUNK_SIZE+i].y)
		heights.append(Marshalls.raw_to_base64(bytes))
	return {"format":FORMAT,"entityId":entity_id,"settings":SOURCE_SETTINGS.duplicate(),"sourceSettings":SOURCE_SETTINGS.duplicate(),"stateVersion":1,"phase":rain.rain_phase,"velocity":rain.rain_speed,"phaseAge":rain.phase_age,"rainClock":rain.rain_clock,"automatic":rain.auto_performance,"casts":rain.cast_count,"heights":heights}

func _number(value: Variant, low: float, high: float) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and float(value) >= low and float(value) <= high

func _integer(value: Variant, low: int, high: int) -> bool:
	return _number(value,low,high) and float(value) == floor(float(value))

func _settings_valid(value: Variant) -> bool:
	# JSON decodes numbers as floats. Compare the numeric leaf, not int-vs-float dictionary storage types.
	return value is Dictionary and value.size() == 1 and value.has("distributionVersion") and _integer(value.distributionVersion,1,1)

func validate_state(state: Dictionary) -> String:
	# Validation is pure: reject the entire payload before writing to the world or audio nodes.
	var keys := ["format","entityId","settings","sourceSettings","stateVersion","phase","velocity","phaseAge","rainClock","automatic","casts","heights"]
	if state.size() != keys.size(): return "Unexpected rain state fields"
	for key in keys:
		if not state.has(key): return "Missing rain state field: "+key
	if state.format != FORMAT or state.entityId != entity_id or not _integer(state.stateVersion,1,1): return "Rain state identity or version mismatch"
	if not _settings_valid(state.settings) or not _settings_valid(state.sourceSettings): return "Rain distribution version mismatch"
	if not _integer(state.phase,0,5): return "Invalid rain stage"
	if not _number(state.velocity,RainWorld.FALL_SPEED,RainWorld.RISE_SPEED): return "Invalid rain velocity"
	if not _number(state.phaseAge,0,1.0e12) or not _number(state.rainClock,0,1.0e12): return "Invalid rain clock"
	if not state.automatic is bool or not _integer(state.casts,0,2147483647): return "Invalid rain control state"
	match int(state.phase):
		RainWorld.RainPhase.FALL:
			if state.velocity != RainWorld.FALL_SPEED or state.automatic: return "Falling stage mismatch"
		RainWorld.RainPhase.HOLD:
			if state.velocity != 0: return "Held rain must be stationary"
		RainWorld.RainPhase.LIFT:
			if state.velocity < 0: return "Lifting stage velocity mismatch"
		RainWorld.RainPhase.RISE:
			if state.velocity != RainWorld.RISE_SPEED: return "Rising stage velocity mismatch"
	if not state.heights is Array or state.heights.size() != CHUNKS: return "Invalid rain position chunks"
	for encoded in state.heights:
		if not encoded is String or encoded.length() != 2936: return "Invalid rain position encoding"
		var bytes := Marshalls.base64_to_raw(encoded)
		if bytes.size() != CHUNK_SIZE*4 or Marshalls.raw_to_base64(bytes) != encoded: return "Malformed rain position data"
		for i in range(CHUNK_SIZE):
			if not _number(bytes.decode_float(i*4),RainWorld.FLOOR_Y,RainWorld.CEILING_Y): return "Rain position outside volume"
	if not is_instance_valid(rain) or not rain.rain_ready or rain.drop_positions.size() != CHUNK_SIZE*CHUNKS: return "Rain simulation is not ready"
	return ""

func restore(state: Dictionary) -> String:
	var problem := validate_state(state)
	if not problem.is_empty(): return problem
	# Deterministic X/Z, scale and rate come from the unchanged distribution. Float32 Y is preserved exactly.
	var positions := rain.drop_positions.duplicate()
	for chunk in range(CHUNKS):
		var bytes := Marshalls.base64_to_raw(state.heights[chunk])
		for i in range(CHUNK_SIZE):
			var index := chunk*CHUNK_SIZE+i
			var point: Vector3 = positions[index]
			point.y = bytes.decode_float(i*4)
			positions[index] = point
	rain.drop_positions = positions
	rain.rain_phase = int(state.phase)
	rain.rain_speed = float(state.velocity)
	rain.phase_age = float(state.phaseAge)
	rain.rain_clock = float(state.rainClock)
	rain.auto_performance = state.automatic
	rain.cast_count = int(state.casts)
	# Do not call _change_phase: it resets age and replays a new cast instead of restoring the saved stage.
	rain._sync_drops()
	rain._update_skill_hud()
	if rain.has_method("sync_rain_audio"): rain.sync_rain_audio(true)
	return ""
