## Bounded virtual controls for the managed runtime. No OS input or state setters.
## The player consumes these button values through its ordinary physics controller.
class_name ManagedInputSource
extends InputSource

var frames: Array[Dictionary] = []
var tick := 0
var _previous_jump := false
var _previous_attack := false

func poll(_delta: float) -> void:
	var frame: Dictionary = frames[tick] if tick < frames.size() else {}
	move_axis = float(frame.get("move", 0.0))
	jump_held = frame.get("jump", false)
	jump_pressed = jump_held and not _previous_jump
	var attack: bool = frame.get("attack", false)
	attack_pressed = attack and not _previous_attack
	interact_pressed = frame.get("interact", false)
	_previous_jump = jump_held
	_previous_attack = attack
	tick += 1
