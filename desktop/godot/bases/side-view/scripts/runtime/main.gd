## Entry scene. Builds the world described by worlds/<id>/world.json.
##
## World selection order:
##   1. CRAFTMINE_SIDEVIEW_WORLD env var
##   2. worlds/default.json pointer, when present
##   3. `ruins`
## The base only reads its own project files and the configured save directory.
extends Node2D

const WORLD_ROOT := "res://worlds"

var room_host: Node2D
var player: SideViewPlayer
var room_manager: SideViewRoomManager
var world_id: String = "ruins"

func _ready() -> void:
	world_id = _resolve_world_id()
	var world_data := _load_world(world_id)
	if world_data.size() == 0:
		push_error("SideView: cannot load world '%s'" % world_id)
		get_tree().quit(2)
		return
	if SideView.config == null or not SideView.config.is_valid():
		SideView.config = SideViewConfig.load_default()
	var state_version := int(world_data.get("stateVersion", 1))
	var instance_id := _resolve_instance_id()
	if RegEx.create_from_string("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$").search(instance_id) == null:
		push_error("SideView: invalid instance identity")
		get_tree().quit(2)
		return
	var state: WorldState = WorldState.create(instance_id, state_version)
	var store: SaveStore = SaveStore.create(instance_id)
	if OS.get_environment("CRAFTMINE_SIDEVIEW_RESET") == "1":
		store.wipe()
	var load_report := {"loaded": false, "created": false, "error": ""} if ProjectSettings.get_setting("craftmine/runtime/enabled", false) else store.load_into(state)
	if not String(load_report.get("error", "")).is_empty():
		push_error("SideView: refusing to overwrite rejected progress: " + String(load_report.error))
		get_tree().quit(3)
		return

	room_host = Node2D.new()
	room_host.name = "Rooms"
	add_child(room_host)

	player = SideViewPlayer.new()
	player.name = "Player"
	# setup() must run before the node enters the tree, because _ready() builds
	# the collision shape from the tuning parameters. Park it far away until the
	# room manager places it, so it cannot overlap a freshly created door volume
	# at the origin and trigger a false transition.
	player.setup(SideView.config, state, SideView)
	player.position = Vector2(-100000.0, -100000.0)
	add_child(player)

	room_manager = SideViewRoomManager.new()
	room_manager.name = "RoomManager"
	room_host.add_child(room_manager)
	room_manager.setup(world_data, SideView.config, state, SideView, player)

	SideView.bind_world(world_data, state, store, {
		"worldId": instance_id,
		"loaded": load_report.get("loaded", false),
		"recoveredFromBackup": load_report.get("created", false),
		"loadError": load_report.get("error", ""),
		"stateVersion": state_version,
	})
	SideView.room_manager = room_manager
	SideView.player = player

	room_manager.start()
	SideView.mark_world_ready()
	SideView.emit_event("world_ready", {
		"worldId": instance_id,
		"roomId": str(state.player.get("room", "")),
		"loaded": load_report.get("loaded", false),
		"stateHash": SideView.persistent_hash(),
	})

func _resolve_world_id() -> String:
	var from_env := OS.get_environment("CRAFTMINE_SIDEVIEW_WORLD")
	if from_env != "":
		return from_env
	var pointer := WORLD_ROOT.path_join("default.json")
	if FileAccess.file_exists(pointer):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(pointer))
		if typeof(parsed) == TYPE_DICTIONARY and (parsed as Dictionary).has("worldId"):
			return str((parsed as Dictionary)["worldId"])
	return "ruins"

func _resolve_instance_id() -> String:
	var from_env := OS.get_environment("CRAFTMINE_SIDEVIEW_INSTANCE_ID")
	if not from_env.is_empty():
		return from_env
	var pointer := WORLD_ROOT.path_join("default.json")
	if FileAccess.file_exists(pointer):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(pointer))
		if parsed is Dictionary and parsed.get("instanceId") is String and not parsed.instanceId.is_empty():
			return parsed.instanceId
	# Direct repository examples keep their existing identities. The materializer
	# always writes a distinct instance identity for newly created worlds.
	return world_id

func _load_world(id: String) -> Dictionary:
	if RegEx.create_from_string("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$").search(id) == null:
		return {}
	var path := WORLD_ROOT.path_join(id).path_join("world.json")
	if not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	var data: Dictionary = parsed
	if str(data.get("format", "")) != "craftmine.godot-sideview-world/1":
		push_error("SideView: unexpected world format in %s" % path)
		return {}
	return data

# --- convenience delegates used by the player ----------------------------

func get_room_bounds() -> Rect2:
	if room_manager == null:
		return Rect2()
	return room_manager.get_room_bounds()

func respawn_point(checkpoint_id: String) -> Vector2:
	if room_manager == null:
		return Vector2.ZERO
	return room_manager.respawn_point(checkpoint_id)
