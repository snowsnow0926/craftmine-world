## Room lifecycle: one room is alive at a time, the player is persistent.
##
## A transition frees the old room, builds the new one from world data, places
## the player at the named spawn, marks the room visited and saves. Nothing about
## the player's abilities, rewards or checkpoints is stored in the room nodes, so
## rebuilding a room cannot lose or duplicate them.
## Keep rooms in the Rooms canvas subtree so their background cannot overdraw
## the later Player sibling through a detached CanvasItem root.
class_name SideViewRoomManager
extends Node2D

signal room_entered(room_id: String, spawn_id: String)

var world: Dictionary = {}
var config: SideViewConfig
var state: WorldState
var runtime: Node
var player: SideViewPlayer
var current_room: SideViewRoom
var switching: bool = false
var transition_count: int = 0
var _pending_transition: bool = false

func setup(world_data: Dictionary, config_value: SideViewConfig, state_value: WorldState, runtime_node: Node, player_node: SideViewPlayer) -> void:
	world = world_data
	config = config_value
	state = state_value
	runtime = runtime_node
	player = player_node

func room_ids() -> Array:
	var ids := []
	for raw_room: Variant in world.get("rooms", []):
		if typeof(raw_room) == TYPE_DICTIONARY:
			ids.append(str((raw_room as Dictionary).get("id", "")))
	return ids

func room_data(room_id: String) -> Dictionary:
	for raw_room: Variant in world.get("rooms", []):
		if typeof(raw_room) != TYPE_DICTIONARY:
			continue
		var room: Dictionary = raw_room
		if str(room.get("id", "")) == room_id:
			return room
	return {}

## Boot: resume the saved room when it still exists, otherwise use the world start.
func start() -> void:
	var start_room := str(world.get("startRoom", ""))
	var start_spawn := str(world.get("startSpawn", "spawn_start"))
	var saved_room := str(state.player.get("room", ""))
	var placement := {}
	if saved_room != "" and room_data(saved_room).size() > 0:
		start_room = saved_room
		placement = {
			"x": float(state.player.get("x", 0.0)),
			"y": float(state.player.get("y", 0.0)),
			"facing": int(state.player.get("facing", 1)),
		}
		# A checkpoint is authoritative over a stale mid-air position.
		if state.active_checkpoint != "":
			start_spawn = ""
	if start_room == "":
		push_error("SideView: world has no startRoom")
		return
	enter_room(start_room, start_spawn, placement)

func request_transition(target_room: String, target_spawn: String) -> void:
	if switching or _pending_transition:
		return
	if room_data(target_room).size() == 0:
		push_error("SideView: transition target room not found: %s" % target_room)
		return
	_pending_transition = true
	# Never build or free rooms inside the physics flush.
	call_deferred("enter_room", target_room, target_spawn, {})

func enter_room(room_id: String, spawn_id: String, placement: Dictionary, restoring: bool = false) -> void:
	switching = true
	_pending_transition = false
	if current_room != null:
		if current_room.transition_requested.is_connected(_on_transition_requested):
			current_room.transition_requested.disconnect(_on_transition_requested)
		remove_child(current_room)
		current_room.queue_free()
		current_room = null

	var data := room_data(room_id)
	if data.size() == 0:
		push_error("SideView: room not found: %s" % room_id)
		switching = false
		return
	var room := SideViewRoom.new()
	add_child(room)
	room.build(data, config, state, runtime)
	room.transition_requested.connect(_on_transition_requested)
	current_room = room
	transition_count += 1

	var point := Vector2.ZERO
	var facing := 1
	if placement.size() > 0:
		point = Vector2(float(placement.get("x", 0.0)), float(placement.get("y", 0.0)))
		facing = int(placement.get("facing", 1))
	else:
		var spawn := room.spawn_point(spawn_id)
		point = Vector2(float(spawn.get("x", 0.0)), float(spawn.get("y", 0.0)))
		facing = int(spawn.get("facing", 1))
	player.set_spawn_point(point)
	player.place_at(point, facing)

	state.player["room"] = room_id
	state.player["x"] = point.x
	state.player["y"] = point.y
	state.player["facing"] = facing
	if not restoring:
		state.mark_room_visited(room_id)
	_update_camera_limits()

	if runtime != null:
		runtime.current_room_id = room_id
		runtime.emit_event("room_entered", {
			"roomId": room_id,
			"spawnId": spawn_id,
			"x": point.x,
			"y": point.y,
			"visited": state.room_visited(room_id),
		})
		if not restoring:
			runtime.save_now("room_entered")
	room_entered.emit(room_id, spawn_id)
	switching = false
	_arm_doors_soon()

func _on_transition_requested(target_room: String, target_spawn: String) -> void:
	request_transition(target_room, target_spawn)

## Spawn points sit away from doors, but arming after a couple of physics frames
## removes any chance of an immediate bounce back through the door we just used.
func _arm_doors_soon() -> void:
	var room := current_room
	await get_tree().physics_frame
	await get_tree().physics_frame
	if room == null or not is_instance_valid(room) or room != current_room:
		return
	for child: Node in room.get_children():
		if child is SideViewDoor:
			(child as SideViewDoor).set("_armed", true)

func _update_camera_limits() -> void:
	if player == null or player.camera == null or current_room == null:
		return
	var bounds: Rect2 = current_room.get_room_bounds()
	if config.clamp_camera_to_room():
		player.camera.limit_left = int(bounds.position.x)
		player.camera.limit_top = int(bounds.position.y)
		player.camera.limit_right = int(bounds.position.x + bounds.size.x)
		player.camera.limit_bottom = int(bounds.position.y + bounds.size.y)
	else:
		player.camera.limit_left = -10000000
		player.camera.limit_top = -10000000
		player.camera.limit_right = 10000000
		player.camera.limit_bottom = 10000000

func get_room_bounds() -> Rect2:
	if current_room == null:
		return Rect2()
	return current_room.get_room_bounds()

func respawn_point(checkpoint_id: String) -> Vector2:
	if current_room == null:
		return Vector2.ZERO
	return current_room.respawn_point(checkpoint_id)

## Which room a given world position belongs to, for diagnostics.
func room_at(point: Vector2) -> String:
	for raw_room: Variant in world.get("rooms", []):
		if typeof(raw_room) != TYPE_DICTIONARY:
			continue
		var room: Dictionary = raw_room
		var raw_bounds: Dictionary = room.get("bounds", {})
		var rect := Rect2(
			float(raw_bounds.get("x", 0.0)),
			float(raw_bounds.get("y", 0.0)),
			float(raw_bounds.get("w", 0.0)),
			float(raw_bounds.get("h", 0.0))
		)
		if rect.has_point(point):
			return str(room.get("id", ""))
	return ""
