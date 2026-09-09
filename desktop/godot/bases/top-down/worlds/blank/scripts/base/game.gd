# Autoloaded as `Game`. Owns the single authoritative WorldState for this world
# instance, loads data-driven catalogs, binds scenes and persists progress.
#
# There is deliberately no second state store: the probe interface, the shop, the
# quest manager and the UI all mutate the same object.
extends Node

signal scene_bound(scene_id: String)

const WORLD_PATH := "res://world.json"

var state: WorldState
var world: Dictionary = {}
var boot_error: String = ""

var _items: Dictionary = {}
var _shops: Dictionary = {}
var _quests: Dictionary = {}
var _npcs: Dictionary = {}
var _scene_root: Node = null
var _scene_id: String = ""
var _pending_spawn: String = ""
var _entities: Dictionary = {}
var _duplicate_entity_ids: Array = []
var _dirty := false
var _dirty_timer := 0.0
var _pending_restore: Dictionary = {}
var _resume_attempted := false

const AUTOSAVE_INTERVAL := 1.0


func _ready() -> void:
	_ensure_input_actions()
	_load_world()
	state = WorldState.create(String(world.get("worldId", "")), world.get("initialProgress", {}))
	if state.world_id.is_empty():
		boot_error = "World manifest has no worldId"
		push_error(boot_error)
	var restored := SaveSystem.restore_into(state)
	if not restored.get("ok", false):
		boot_error = String(restored.get("error", "Progress could not be restored"))
		push_error(boot_error)
	elif restored.get("restored", false):
		_pending_restore = {"sceneId": state.scene_id, "position": state.player_position, "facing": state.player_facing}
	if OS.get_cmdline_user_args().has("--probe"):
		_start_probe.call_deferred()


func _start_probe() -> void:
	await Probe.run(self)


# Input actions are declared in code so the base works even if a world project is
# authored from scratch or edited by hand; a world may still override them in
# project.godot.
func _ensure_input_actions() -> void:
	_add_action("move_left", [KEY_A, KEY_LEFT])
	_add_action("move_right", [KEY_D, KEY_RIGHT])
	_add_action("move_up", [KEY_W, KEY_UP])
	_add_action("move_down", [KEY_S, KEY_DOWN])
	_add_action("interact", [KEY_E, KEY_SPACE, KEY_ENTER])


func _add_action(action: String, keys: Array) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	for key in keys:
		var event := InputEventKey.new()
		event.physical_keycode = key
		if not InputMap.action_has_event(action, event):
			InputMap.action_add_event(action, event)


# --------------------------------------------------------------- data loading

func _load_world() -> void:
	world = _read_json(WORLD_PATH, {})
	_items = _read_json_map("res://data/items.json")
	_shops = _read_json_dir("res://data/shops")
	_quests = _read_json_dir("res://data/quests")
	_npcs = _read_json_dir("res://data/npcs")


func _read_json(path: String, fallback: Variant) -> Variant:
	if not FileAccess.file_exists(path):
		return fallback
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return fallback
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	return parsed if parsed != null else fallback


func _read_json_map(path: String) -> Dictionary:
	var parsed: Variant = _read_json(path, {})
	if parsed is Dictionary:
		return parsed
	if parsed is Array:
		var mapped: Dictionary = {}
		for entry in parsed:
			if entry is Dictionary and entry.get("id") is String:
				mapped[String(entry.id)] = entry
		return mapped
	return {}


func _read_json_dir(directory: String) -> Dictionary:
	var result: Dictionary = {}
	var handle := DirAccess.open(directory)
	if handle == null:
		return result
	handle.list_dir_begin()
	var name := handle.get_next()
	while not name.is_empty():
		if not handle.current_is_dir() and name.ends_with(".json"):
			var parsed: Variant = _read_json(directory.path_join(name), null)
			if parsed is Dictionary and parsed.get("id") is String:
				result[String(parsed.id)] = parsed
		name = handle.get_next()
	handle.list_dir_end()
	return result


func shop_catalog(shop_id: String) -> Array:
	var entry: Dictionary = _shops.get(shop_id, {})
	return entry.get("items", []) if entry.get("items") is Array else []


func shop_data(shop_id: String) -> Dictionary:
	return _shops.get(shop_id, {})


func quest_data(quest_id: String) -> Dictionary:
	return _quests.get(quest_id, {})


func npc_data(npc_id: String) -> Dictionary:
	return _npcs.get(npc_id, {})


func item_name(item_id: String) -> String:
	var entry: Dictionary = _items.get(item_id, {})
	return String(entry.get("name", item_id))


# ------------------------------------------------------------ scene binding

func bind_scene(root: Node, scene_id_value: String) -> Dictionary:
	if not _pending_restore.is_empty() and _pending_restore.sceneId != scene_id_value:
		# The project entry scene can differ from the player's saved room. Do not
		# publish or simulate it while routing to the authored saved-scene mapping.
		root.process_mode = Node.PROCESS_MODE_DISABLED
		if _resume_attempted:
			boot_error = "Saved scene mapping points to a different scene identity"
			return {"ok": false, "error": boot_error}
		_resume_attempted = true
		var catalog: Variant = world.get("scenes", {})
		var target: Variant = catalog.get(_pending_restore.sceneId, "") if catalog is Dictionary else ""
		if not target is String or not target.begins_with("res://scenes/") or not target.ends_with(".tscn") or not ResourceLoader.exists(target):
			boot_error = "Saved scene is unavailable in the world scene catalog"
			return {"ok": false, "error": boot_error}
		_resume_saved_scene.call_deferred(target)
		return {"ok": true, "restoring": true}
	_entities.clear()
	_duplicate_entity_ids.clear()
	_scene_root = root
	_scene_id = scene_id_value
	state.scene_id = scene_id_value
	for node in get_tree().get_nodes_in_group("entities"):
		var id := _entity_id_of(node)
		if id.is_empty():
			continue
		if _entities.has(id):
			_duplicate_entity_ids.append(id)
		else:
			_entities[id] = node
	if not _duplicate_entity_ids.is_empty():
		push_error("Duplicate entity ids in scene: %s" % str(_duplicate_entity_ids))
	_place_player()
	scene_bound.emit(scene_id_value)
	return {"ok": _duplicate_entity_ids.is_empty(), "duplicates": _duplicate_entity_ids}

func _resume_saved_scene(scene_path: String) -> void:
	var result := get_tree().change_scene_to_file(scene_path)
	if result != OK:
		boot_error = "Saved scene could not be loaded: %d" % result


func _entity_id_of(node: Node) -> String:
	if node == null or node.get_script() == null:
		return ""
	var value: Variant = node.get("entity_id")
	return String(value) if value is String else ""


func scene_root() -> Node:
	return _scene_root


func scene_id() -> String:
	return _scene_id


func find_entity(entity_id: String) -> Node:
	return _entities.get(entity_id, null)


func player() -> Node:
	if not is_inside_tree():
		return null
	return get_tree().get_first_node_in_group("player")


func _find_spawn(spawn_id: String) -> Node:
	if not is_inside_tree():
		return null
	for node in get_tree().get_nodes_in_group("spawns"):
		var value: Variant = node.get("spawn_id")
		if value is String and String(value) == spawn_id:
			return node
	return null


func _place_player() -> void:
	var actor := player()
	var body := actor as Node2D
	if body == null:
		return
	var target: Vector2 = body.global_position
	if not _pending_restore.is_empty():
		target = _pending_restore.position
		if actor.has_method("set_facing"):
			actor.set_facing(_pending_restore.facing)
		_pending_restore.clear()
	elif not _pending_spawn.is_empty():
		var marker := _find_spawn(_pending_spawn)
		var marker_body := marker as Node2D
		if marker_body != null:
			target = marker_body.global_position
	elif state.scene_positions.has(_scene_id):
		var saved: Array = state.scene_positions[_scene_id]
		if saved.size() == 2:
			target = Vector2(float(saved[0]), float(saved[1]))
	body.global_position = target
	_pending_spawn = ""
	state.player_position = target
	state.player_facing = _facing_of(actor)


func change_scene(scene_path: String, spawn_id: String = "") -> Dictionary:
	if scene_path.is_empty():
		return {"ok": false, "error": "Scene path is empty"}
	if not ResourceLoader.exists(scene_path):
		return {"ok": false, "error": "Scene does not exist: %s" % scene_path}
	_record_scene_position()
	# Drop references to the outgoing scene immediately: if the new scene never
	# binds, lookups must fail cleanly instead of returning freed nodes.
	_scene_root = null
	_entities.clear()
	_pending_spawn = spawn_id
	var code := get_tree().change_scene_to_file(scene_path)
	if code != OK:
		return {"ok": false, "error": "Scene change failed with code %d" % code}
	return {"ok": true, "scenePath": scene_path, "spawn": spawn_id}


func _record_scene_position() -> void:
	var actor := player()
	var body := actor as Node2D
	if body == null:
		return
	state.scene_positions[_scene_id] = [body.global_position.x, body.global_position.y]
	state.player_position = body.global_position
	state.player_facing = _facing_of(actor)


func tick(_root: Node) -> void:
	if not _pending_restore.is_empty() or not boot_error.is_empty():
		return
	var actor := player()
	var body := actor as Node2D
	if body == null:
		return
	state.player_position = body.global_position
	state.player_facing = _facing_of(actor)


func _facing_of(actor: Node) -> String:
	var value := _string_property(actor, &"facing")
	return value if WorldState.FACINGS.has(value) else state.player_facing


static func _string_property(node: Node, property: StringName) -> String:
	if node == null:
		return ""
	var value: Variant = node.get(property)
	return String(value) if value is String else ""


static func _int_property(node: Node, property: StringName, fallback: int) -> int:
	if node == null:
		return fallback
	var value: Variant = node.get(property)
	if value is int:
		return value
	if value is float and is_finite(value):
		return int(value)
	return fallback


# --------------------------------------------------------- persistence verbs

func save() -> Dictionary:
	if not boot_error.is_empty():
		return {"ok": false, "error": boot_error}
	if not _pending_restore.is_empty():
		return {"ok": false, "error": "Saved scene is still restoring"}
	_record_scene_position()
	var result := SaveSystem.save(state)
	if result.get("ok", false):
		_dirty = false
		_dirty_timer = 0.0
	return result


func restore() -> Dictionary:
	var outcome := SaveSystem.restore_into(state)
	if not outcome.get("ok", false):
		return outcome
	_place_player()
	return outcome


func reset_to_initial() -> Dictionary:
	SaveSystem.erase(state.world_id)
	state = WorldState.create(String(world.get("worldId", "")), world.get("initialProgress", {}))
	# Resetting progress must not claim the player is in a scene that is not
	# loaded, so keep the currently bound scene and drop remembered positions.
	state.scene_id = _scene_id
	state.scene_positions.clear()
	_place_player()
	return {"ok": true, "snapshot": snapshot()}


# ------------------------------------------------------------- observations

func snapshot() -> Dictionary:
	var result := state.snapshot()
	var actor := player()
	result["sceneId"] = _scene_id
	result["duplicateEntityIds"] = _duplicate_entity_ids.duplicate()
	result["bootError"] = boot_error
	result["physical"] = {
		"playerPosition": [actor.global_position.x, actor.global_position.y] if actor != null else [],
		"facing": actor.facing if actor != null else "",
		"overlaps": _overlap_report(actor),
	}
	result["maps"] = _map_reports()
	var sprite: Node = actor.get_node_or_null("Sprite") if actor != null else null
	var moving: Variant = sprite.get(&"moving") if sprite != null else null
	result["sprite"] = {
		"frame": _int_property(sprite, &"frame", -1),
		"facing": _string_property(sprite, &"facing"),
		"moving": moving if moving is bool else false,
	}
	return result


func _map_reports() -> Dictionary:
	var reports: Dictionary = {}
	if not is_inside_tree():
		return reports
	for node in get_tree().get_nodes_in_group("maps"):
		var value: Variant = node.get("build_report")
		var id: Variant = node.get("map_id")
		if value is Dictionary and id is String:
			reports[String(id)] = value
	return reports


func _overlap_report(actor: Node) -> Dictionary:
	var report: Dictionary = {}
	if actor == null:
		return report
	for id in _entities.keys():
		var node = _entities[id]
		if node is Area2D:
			report[id] = (node as Area2D).overlaps_body(actor)
	return report


func _exit_tree() -> void:
	_autosave()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE:
		_autosave()


# Write-through safety net: gameplay marks the state dirty and the autoload
# flushes it at most once per second, so a world survives an unexpected process
# end as well as an explicit save.
func mark_dirty() -> void:
	_dirty = true


func _process(delta: float) -> void:
	if not _dirty:
		return
	_dirty_timer += delta
	if _dirty_timer < AUTOSAVE_INTERVAL:
		return
	save()


func _autosave() -> void:
	# Also runs from NOTIFICATION_PREDELETE, where the node is already outside the
	# tree; SaveSystem only touches the filesystem, so saving there is still valid.
	if state == null or state.world_id.is_empty():
		return
	if not bool(world.get("autosaveOnExit", true)):
		return
	save()
