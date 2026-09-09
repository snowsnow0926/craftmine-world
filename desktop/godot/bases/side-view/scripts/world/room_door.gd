## Door / room link. Walking into the area asks the room manager to switch
## rooms and place the player at the named spawn. The door itself changes no
## state beyond recording that a transition happened.
class_name SideViewDoor
extends Area2D

signal transition_requested(target_room: String, target_spawn: String)

var door_id: String = ""
var target_room: String = ""
var target_spawn: String = ""
var config: SideViewConfig
var state: WorldState
var runtime: Node
var _armed: bool = false
var _last_body_position: Vector2 = Vector2.ZERO

func build(raw: Dictionary, config_value: SideViewConfig, state_value: WorldState, runtime_node: Node) -> void:
	config = config_value
	state = state_value
	runtime = runtime_node
	door_id = str(raw.get("id", name))
	target_room = str(raw.get("targetRoom", ""))
	target_spawn = str(raw.get("targetSpawn", ""))
	collision_layer = 0
	collision_mask = 1
	monitoring = true
	monitorable = false
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	var w := float(raw.get("w", 24.0))
	var h := float(raw.get("h", 44.0))
	rect.size = Vector2(w, h)
	shape.shape = rect
	shape.position = Vector2(float(raw.get("x", 0.0)) + w * 0.5, float(raw.get("y", 0.0)) + h * 0.5)
	add_child(shape)
	var visual := Polygon2D.new()
	visual.color = Color(0.95, 0.78, 0.32, 0.5)
	visual.polygon = PackedVector2Array([
		Vector2(-w * 0.5, -h * 0.5),
		Vector2(w * 0.5, -h * 0.5),
		Vector2(w * 0.5, h * 0.5),
		Vector2(-w * 0.5, h * 0.5),
	])
	visual.position = shape.position
	add_child(visual)
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node2D) -> void:
	if not (body is SideViewPlayer):
		return
	# The authored gate is checked before the arming window so a refused door
	# stays available once the player returns with the required ability.
	if runtime != null and runtime.room_manager != null and runtime.room_manager.gate_blocks_room(target_room):
		runtime.emit_event("gate_blocked", {
			"doorId": door_id,
			"targetRoom": target_room,
			"requiredAbility": runtime.room_manager.required_ability_for(target_room),
		})
		return
	if not _armed:
		return
	_armed = false
	_last_body_position = body.global_position
	# body_entered fires during the physics flush: freeing the old room or
	# building a new one here is not allowed, so defer the request.
	call_deferred("_emit_transition")

func _emit_transition() -> void:
	if runtime != null:
		runtime.emit_event("door_used", {
			"doorId": door_id,
			"fromRoom": get_parent().room_id if get_parent() != null else "",
			"targetRoom": target_room,
			"targetSpawn": target_spawn,
			"playerX": _last_body_position.x,
			"playerY": _last_body_position.y,
			"doorRect": _collision_rect(),
		})
	transition_requested.emit(target_room, target_spawn)

## Diagnostics: the axis-aligned box this door actually occupies in the room.
func _collision_rect() -> Dictionary:
	for child: Node in get_children():
		if child is CollisionShape2D and (child as CollisionShape2D).shape is RectangleShape2D:
			var rect_shape: RectangleShape2D = (child as CollisionShape2D).shape
			var center: Vector2 = global_position + (child as CollisionShape2D).position
			var top_left: Vector2 = center - rect_shape.size * 0.5
			return {"x": top_left.x, "y": top_left.y, "w": rect_shape.size.x, "h": rect_shape.size.y}
	return {}
