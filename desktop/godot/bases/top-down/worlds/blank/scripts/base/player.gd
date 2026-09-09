# Player character for the top-down base.
#
# Movement always goes through the real `CharacterBody2D.move_and_slide()` and the
# real physics server, so wall collision is genuine. Input is either the real
# action map (play) or a scripted vector (headless probe). The probe never sends
# OS mouse/keyboard events; it only supplies the same vector a player would.
class_name TopDownPlayer
extends CharacterBody2D

signal facing_changed(facing: String)
signal position_changed(position: Vector2)

@export var entity_id: String = "player"
@export var move_speed: float = 88.0
@export var input_enabled: bool = true

var facing: String = "down"
var scripted_input: Vector2 = Vector2.ZERO
var scripted_mode: bool = false

var _sprite: DirectionalSprite
var _interact_range: Area2D


func _ready() -> void:
	add_to_group("player")
	add_to_group("entities")
	_sprite = get_node_or_null("Sprite") as DirectionalSprite
	_interact_range = get_node_or_null("InteractRange") as Area2D
	set_facing(facing)


func _physics_process(delta: float) -> void:
	var direction := Vector2.ZERO
	if scripted_mode:
		direction = scripted_input
	elif input_enabled:
		direction = Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if direction.length() > 1.0:
		direction = direction.normalized()
	velocity = direction * move_speed
	if direction != Vector2.ZERO:
		set_facing(facing_for_vector(direction))
	var before := global_position
	move_and_slide()
	if _sprite != null:
		_sprite.set_moving(direction != Vector2.ZERO)
		_sprite.advance(delta)
	if global_position != before:
		position_changed.emit(global_position)


func set_facing(value: String) -> void:
	if not WorldState.FACINGS.has(value):
		value = "down"
	if facing == value:
		if _sprite != null:
			_sprite.set_facing(value)
		return
	facing = value
	if _sprite != null:
		_sprite.set_facing(value)
	facing_changed.emit(value)


static func facing_for_vector(direction: Vector2) -> String:
	if absf(direction.x) >= absf(direction.y):
		return "right" if direction.x > 0.0 else "left"
	return "down" if direction.y > 0.0 else "up"


# Nearest interactable currently overlapping the player's interaction area.
# Used only to decide what the prompt points at; every interactable re-checks the
# real geometric overlap before it mutates anything.
func focus_interactable() -> Node:
	if _interact_range == null:
		return null
	var best: Node = null
	var best_distance := INF
	for area in _interact_range.get_overlapping_areas():
		if not area.has_method("can_interact"):
			continue
		if not area.can_interact(self):
			continue
		var distance := global_position.distance_squared_to((area as Node2D).global_position)
		if distance < best_distance:
			best_distance = distance
			best = area
	return best


func interacting_areas() -> Array:
	if _interact_range == null:
		return []
	var result: Array = []
	for area in _interact_range.get_overlapping_areas():
		if area.has_method("can_interact") and area.can_interact(self):
			result.append(area)
	return result
