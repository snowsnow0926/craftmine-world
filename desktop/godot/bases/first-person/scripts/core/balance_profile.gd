@tool
class_name BalanceProfile
extends Resource

## Tuning values for a level. Keeping them in a resource means a model can
## change movement feel without editing a script or a scene node.

@export var player_move_speed := 4.5
@export var player_jump_velocity := 4.2
@export var mouse_sensitivity_degrees := 0.12
@export var gravity_scale := 1.0
@export var hit_flash_seconds := 0.12


func apply_to(world: BaseWorld) -> void:
	if world == null or world.player == null:
		return
	world.player.move_speed = player_move_speed
	world.player.jump_velocity = player_jump_velocity
	world.player.gravity_scale = gravity_scale
	if world.player.camera_rig != null:
		world.player.camera_rig.mouse_sensitivity_degrees = mouse_sensitivity_degrees
	for target in world.get_tree().get_nodes_in_group("base_targets"):
		if target.get("hit_flash_seconds") != null:
			target.hit_flash_seconds = hit_flash_seconds
