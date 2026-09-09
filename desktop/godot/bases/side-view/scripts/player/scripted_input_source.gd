## Scripted input for headless acceptance runs.
##
## Enabled only when CRAFTMINE_SIDEVIEW_INPUT_PLAN points at a plan file. It
## emits the same button state a keyboard would, on a fixed physics tick, so the
## run is deterministic under `--fixed-fps 60`. It has no access to the player
## node and cannot set positions or state.
class_name ScriptedInputSource
extends InputSource

var plan: Dictionary = {}
var tick: int = 0
var last_error: String = ""

static func from_file(path: String) -> ScriptedInputSource:
	var source := ScriptedInputSource.new()
	source.source_name = "scripted"
	if not FileAccess.file_exists(path):
		source.last_error = "missing input plan: %s" % path
		return source
	var raw := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		source.last_error = "input plan is not a JSON object: %s" % path
		return source
	source.plan = parsed
	return source

func is_valid() -> bool:
	return last_error == ""

func duration_ticks() -> int:
	return int(plan.get("durationTicks", 0))

func settle_ticks() -> int:
	return int(plan.get("settleTicks", 30))

func poll(_delta: float) -> void:
	move_axis = 0.0
	jump_held = false
	jump_pressed = false
	attack_pressed = false
	interact_pressed = false
	# Overlapping segments are OR-ed. They must never accumulate, or two
	# overlapping "right" segments would double the run speed.
	var want_left := false
	var want_right := false
	var segments: Array = plan.get("segments", [])
	for raw_segment: Variant in segments:
		if typeof(raw_segment) != TYPE_DICTIONARY:
			continue
		var segment: Dictionary = raw_segment
		var from_tick := int(segment.get("fromTick", 0))
		var to_tick := int(segment.get("toTick", from_tick))
		if tick < from_tick or tick >= to_tick:
			continue
		if segment.get("left", false) == true:
			want_left = true
		if segment.get("right", false) == true:
			want_right = true
		if segment.get("interact", false) == true:
			interact_pressed = true
		var jump: Variant = segment.get("jump", {})
		var jump_state := _pulse_state(jump, tick - from_tick)
		if jump_state.get("held", false):
			jump_held = true
		if jump_state.get("pressed", false):
			jump_pressed = true
		var attack: Variant = segment.get("attack", {})
		if _pulse_state(attack, tick - from_tick).get("pressed", false):
			attack_pressed = true
	if want_left and not want_right:
		move_axis -= 1.0
	elif want_right and not want_left:
		move_axis += 1.0
	tick += 1

## Pulse descriptor: { "mode": "hold"|"once"|"repeat", "period": 40, "hold": 10, "offset": 0 }
static func _pulse_state(descriptor: Variant, local_tick: int) -> Dictionary:
	if typeof(descriptor) != TYPE_DICTIONARY:
		return {"held": false, "pressed": false}
	var spec: Dictionary = descriptor
	var mode := str(spec.get("mode", "none"))
	match mode:
		"hold":
			return {"held": true, "pressed": local_tick == 0}
		"once":
			var offset_once := int(spec.get("offset", 0))
			var hold_once := int(spec.get("hold", 1))
			var in_window_once := local_tick >= offset_once and local_tick < offset_once + hold_once
			return {"held": in_window_once, "pressed": local_tick == offset_once}
		"repeat":
			var period := maxi(1, int(spec.get("period", 40)))
			var hold := maxi(1, int(spec.get("hold", 10)))
			var offset := int(spec.get("offset", 0))
			var shifted := local_tick - offset
			if shifted < 0:
				return {"held": false, "pressed": false}
			var phase := shifted % period
			return {"held": phase < hold, "pressed": phase == 0}
		_:
			return {"held": false, "pressed": false}
