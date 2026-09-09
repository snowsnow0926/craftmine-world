## Scripted input for the headless probe.
##
## It emits the same button state a keyboard would and has no access to the
## player node: it cannot set positions or state, so `move` can only succeed
## through the real physics simulation.
class_name ScriptedInputSource
extends InputSource

var direction: Vector2 = Vector2.ZERO
var _jump_was_held: bool = false


func _init() -> void:
	source_name = "scripted"


func set_direction(value: Vector2) -> void:
	direction = value


func poll(_delta: float) -> void:
	move_axis = clampf(direction.x, -1.0, 1.0)
	var wants_jump := direction.y < -0.5
	jump_held = wants_jump
	jump_pressed = wants_jump and not _jump_was_held
	_jump_was_held = wants_jump
