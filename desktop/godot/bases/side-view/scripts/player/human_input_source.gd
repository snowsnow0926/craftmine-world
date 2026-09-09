## Real keyboard input, used whenever no acceptance plan is supplied.
class_name HumanInputSource
extends InputSource

func _init() -> void:
	source_name = "human"

func poll(_delta: float) -> void:
	move_axis = Input.get_axis("sv_move_left", "sv_move_right")
	jump_held = Input.is_action_pressed("sv_jump")
	jump_pressed = Input.is_action_just_pressed("sv_jump")
	attack_pressed = Input.is_action_just_pressed("sv_attack")
	interact_pressed = Input.is_action_just_pressed("sv_interact")
