## Real keyboard input, used whenever no scripted plan is active.
##
## The action names are declared in code by MiningGame._ready() so the base works
## even in a hand-made world project.
class_name HumanInputSource
extends InputSource


func _init() -> void:
	source_name = "human"


func poll(_delta: float) -> void:
	move_axis = Input.get_axis("ms_left", "ms_right")
	jump_held = Input.is_action_pressed("ms_jump")
	jump_pressed = Input.is_action_just_pressed("ms_jump")
