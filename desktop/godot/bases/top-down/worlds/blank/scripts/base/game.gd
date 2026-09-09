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
	return get_tree().get_first_node_in_group("player")


func _find_spawn(spawn_id: String) -> Node:
	for node in get_tree().get_nodes_in_group("spawns"):
		var value: Variant = node.get("spawn_id")
		if value is String and String(value) == spawn_id:
			return node
	return null


func _place_player() -> void:
	var actor := player()
	if actor == null:
		return
	var target: Vector2 = actor.global_position
	if not _pending_spawn.is_empty():
		var marker := _find_spawn(_pending_spawn)
		if marker != null:
			target = (marker as Node2D).global_position
	elif state.scene_positions.has(_scene_id):
		var saved: Array = state.scene_positions[_scene_id]
		if saved.size() == 2:
			target = Vector2(float(saved[0]), float(saved[1]))
	actor.global_position = target
	_pending_spawn = ""
	state.player_position = target
	state.player_facing = actor.facing


func change_scene(scene_path: String, spawn_id: String = "") -> Dictionary:
	if scene_path.is_empty():
		return {"ok": false, "error": "Scene path is empty"}
	if not ResourceLoader.exists(scene_path):
		return {"ok": false, "error": "Scene does not exist: %s" % scene_path}
	_record_scene_position()
	_pending_spawn = spawn_id
	var code := get_tree().change_scene_to_file(scene_path)
	if code != OK:
		return {"ok": false, "error": "Scene change failed with code %d" % code}
	return {"ok": true, "scenePath": scene_path, "spawn": spawn_id}


func _record_scene_position() -> void:
	var actor := player()
	if actor == null:
		return
	state.scene_positions[_scene_id] = [actor.global_position.x, actor.global_position.y]
	state.player_position = actor.global_position
	state.player_facing = actor.facing


func tick(_root: Node) -> void:
	var actor := player()
	if actor == null:
		return
	state.player_position = actor.global_position
	state.player_facing = actor.facing


# --------------------------------------------------------- persistence verbs

func save() -> Dictionary:
	_record_scene_position()
	_dirty = false
	_dirty_timer = 0.0
	return SaveSystem.save(state)


func restore() -> Dictionary:
	var outcome := SaveSystem.restore_into(state)
	if not outcome.get("ok", false):
		return outcome
	_place_player()
	return outcome


func reset_to_initial() -> Dictionary:
	SaveSystem.erase(state.world_id)
	state = WorldState.create(String(world.get("worldId", "")), world.get("initialProgress", {}))
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
	result["sprite"] = {
		"frame": int(sprite.frame) if sprite != null else -1,
		"facing": String(sprite.facing) if sprite != null else "",
		"moving": bool(sprite.moving) if sprite != null else false,
	}
	return result


func _map_reports() -> Dictionary:
	var reports: Dictionary = {}
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
	if state == null or state.world_id.is_empty():
		return
	if not bool(world.get("autosaveOnExit", true)):
		return
	if get_tree() == null:
		return
	save()
