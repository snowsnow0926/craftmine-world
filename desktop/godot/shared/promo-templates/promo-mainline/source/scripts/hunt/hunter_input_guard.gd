extends Node

# Keyboard view control composes with the unchanged first-person controller.
# Pointer capture is only for mouse look, never a movement or combat requirement.
var duel: Node3D
var player: CharacterBody3D

func _ready() -> void:
	duel = get_parent() as Node3D
	player = duel.get_parent().get_node("Player") as CharacterBody3D
	call_deferred("_apply_sign_font")

func _apply_sign_font() -> void:
	var font: Font = duel.get_parent().get("creation_font") as Font
	if font != null:
		for child in duel.get_children():
			if child is Label3D: child.font = font

func _process(delta: float) -> void:
	if not is_instance_valid(player) or not duel.call("combat_running"): return
	# Built-in ui directional actions supply the arrow keys, not WASD movement.
	var axis := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if axis.length_squared() <= 0.0001: return
	var view: Dictionary = player.call("look")
	player.call("set_look", float(view.yaw) - axis.x * deg_to_rad(110.0) * delta, float(view.pitch) - axis.y * deg_to_rad(85.0) * delta)
