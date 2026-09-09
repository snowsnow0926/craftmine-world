## Root runtime for one mining-sandbox world.
##
## Owns the single authoritative MiningWorldState, assembles the terrain,
## inventory, crafting and save services, builds the player/entities and exposes
## the read-only snapshot plus the save/restore verbs. The headless probe drives
## exactly these objects; there is no second state store and no test-only path.
class_name MiningGame
extends Node2D

const WORLD_PATH := "res://world.json"

var world: Dictionary = {}
var params: MiningParams
var generator: MiningTerrainGenerator
var terrain: MiningTerrainService
var inventory: MiningInventoryService
var crafting: MiningCraftingService
var save_store: MiningSaveStore
var chunk_store: MiningChunkStore
var state: MiningWorldState

var player: MiningPlayer
var renderer: MiningTerrainRenderer
var collider: MiningTerrainCollider
var world_root: Node2D

var boot_error: String = ""
var rescue: Dictionary = {
	"resolved": false,
	"from": [],
	"to": [],
	"reason": "",
	"resolvedTiles": [],
}
var last_save: Dictionary = {}

var _entities: Dictionary = {}
var _entity_tiles: Dictionary = {}
var _auto_request_counter: int = 0
var cursor_tile: Vector2i = Vector2i.ZERO
var _cursor_initialized: bool = false
var last_action: Dictionary = {}
var _exit_saved: bool = false


func _ready() -> void:
	_register_input_actions()
	_load_world()
	params = MiningParams.load_default()
	if not params.is_valid():
		push_error("mining-sandbox params: %s" % params.load_error)
	generator = MiningTerrainGenerator.new()
	generator.configure(world.get("generation", {}), params.chunk_tiles())
	if not generator.is_valid():
		boot_error = "terrain generation is invalid: %s" % generator.load_error
	state = MiningWorldState.new()
	state.world_id = String(world.get("worldId", ""))
	_build_services()
	_apply_initial_progress()
	_build_nodes()
	_restore_on_boot()
	_sync_nodes_from_state()
	if OS.get_cmdline_user_args().has("--probe"):
		_start_probe.call_deferred()


func _start_probe() -> void:
	await MiningProbe.run(self)


func _load_world() -> void:
	var parsed: Variant = _read_json(WORLD_PATH)
	if not parsed is Dictionary:
		boot_error = "world.json is missing or not a JSON object"
		world = {}
		return
	world = parsed
	if String(world.get("format", "")) != MiningBaseContract.WORLD_FORMAT:
		boot_error = "world.json format is not supported"


func _build_services() -> void:
	inventory = MiningInventoryService.new()
	inventory.setup(state, _as_array(world.get("items", [])), params.max_stack(), params.ledger_limit())

	terrain = MiningTerrainService.new()
	terrain.setup(generator, state, inventory, params, _as_array(world.get("materials", [])))
	terrain.player_center_provider = Callable(self, "_player_center")

	crafting = MiningCraftingService.new()
	crafting.setup(state, inventory, params, _as_array(world.get("recipes", [])))
	crafting.entity_provider = Callable(self, "find_entity")
	crafting.player_center_provider = Callable(self, "_player_center")

	chunk_store = MiningChunkStore.new()
	chunk_store.setup(state.world_id, generator.terrain_seed, MiningWorldState.STATE_VERSION, params.chunk_tiles(), generator.map_size, int(params.limits.get("maxChunkBytes", 1048576)), params.max_edited_cells_per_chunk())
	save_store = MiningSaveStore.new()
	save_store.setup(state.world_id, generator, params, chunk_store, _as_array(world.get("materials", [])))


# ------------------------------------------------------------------ assembly

func _apply_initial_progress() -> void:
	var initial: Dictionary = world.get("initialProgress", {}) if world.get("initialProgress") is Dictionary else {}
	state.apply_initial(initial, params.max_stack())
	var declared: Variant = initial.get("player", {})
	var tile := Vector2i(0, 0)
	if declared is Dictionary and declared.get("tile") is Array and declared.tile.size() == 2:
		tile = Vector2i(int(declared.tile[0]), int(declared.tile[1]))
	var resolved := _resolve_spawn_tile(tile)
	if not bool(resolved.get("ok", false)):
		boot_error = "spawn tile cannot be resolved: %s" % String(resolved.get("detail", ""))
		return
	if bool(resolved.get("moved", false)):
		rescue["resolvedTiles"].append({
			"kind": "player",
			"id": "player",
			"from": [tile.x, tile.y],
			"to": [int(resolved.tile.x), int(resolved.tile.y)],
		})
	var spawn: Vector2i = resolved.tile
	state.set_player(spawn, _feet_for_tile(spawn), String(state.player.facing), int(state.player.health))


## SPEC 1: a declared tile is resolved to the first non-solid tile in the same
## column at or above it, with enough head-room for the 12x26 body.
func _resolve_spawn_tile(tile: Vector2i) -> Dictionary:
	if not generator.in_bounds(tile.x, tile.y):
		return {"ok": false, "detail": "declared tile is outside the map"}
	var ty := tile.y
	while ty >= 0:
		if not terrain.is_solid(tile.x, ty) and not _body_overlaps_solid(tile.x, ty):
			return {"ok": true, "tile": Vector2i(tile.x, ty), "moved": ty != tile.y}
		ty -= 1
	return {"ok": false, "detail": "the whole column above %d,%d is solid" % [tile.x, tile.y]}


func _body_overlaps_solid(tx: int, ty: int) -> bool:
	var feet := _feet_for_tile(Vector2i(tx, ty))
	var half := params.half_width()
	var height := params.body_height()
	var rect := Rect2(feet.x - half, feet.y - height, half * 2.0, height)
	return _solid_tiles_in_rect(rect) > 0


func _build_nodes() -> void:
	world_root = Node2D.new()
	world_root.name = "World"
	add_child(world_root)

	renderer = MiningTerrainRenderer.new()
	renderer.name = "Terrain"
	renderer.setup(terrain, generator, _as_array(world.get("materials", [])))
	world_root.add_child(renderer)

	collider = MiningTerrainCollider.new()
	collider.name = "TerrainBody"
	collider.setup(terrain, generator)
	world_root.add_child(collider)

	for entry in _as_array(world.get("entities", [])):
		if not entry is Dictionary or not entry.get("id") is String:
			continue
		var entity_id := String(entry.id)
		var declared_tile := Vector2i.ZERO
		if entry.get("tile") is Array and entry.tile.size() == 2:
			declared_tile = Vector2i(int(entry.tile[0]), int(entry.tile[1]))
		var resolved := _resolve_spawn_tile(declared_tile)
		if not bool(resolved.get("ok", false)):
			boot_error = "entity %s cannot be placed: %s" % [entity_id, String(resolved.get("detail", ""))]
			push_error("mining-sandbox %s" % boot_error)
			continue
		var resolved_tile: Vector2i = resolved.tile
		if bool(resolved.get("moved", false)):
			rescue["resolvedTiles"].append({
				"kind": "entity",
				"id": entity_id,
				"from": [declared_tile.x, declared_tile.y],
				"to": [resolved_tile.x, resolved_tile.y],
			})
		var station := MiningStation.new()
		station.name = entity_id
		station.setup(entry, resolved_tile, params.tile_size())
		world_root.add_child(station)
		_entities[entity_id] = station
		_entity_tiles[entity_id] = resolved_tile

	player = MiningPlayer.new()
	player.name = "Player"
	player.setup(self, params, state, Vector2(generator.map_size * params.tile_size()))
	world_root.add_child(player)
	terrain.chunk_changed.connect(_on_chunk_changed)


## A tile change must be reflected in physics and on screen right away.
func _on_chunk_changed(cx: int, cy: int) -> void:
	if collider != null:
		collider.invalidate(cx, cy)
	if renderer != null:
		renderer.invalidate()


func _restore_on_boot() -> void:
	if state.world_id.is_empty():
		boot_error = "world manifest has no worldId"
		return
	var outcome := save_store.restore_into(state, terrain)
	if not bool(outcome.get("ok", false)):
		boot_error = "%s: %s" % [String(outcome.get("reason", "bad_state")), String(outcome.get("detail", ""))]
		push_error("mining-sandbox progress rejected: %s" % boot_error)
		return
	if bool(outcome.get("restored", false)):
		var reported: Dictionary = outcome.get("rescue", {})
		rescue["resolved"] = bool(reported.get("resolved", false))
		rescue["from"] = reported.get("from", [])
		rescue["to"] = reported.get("to", [])
		rescue["reason"] = String(reported.get("reason", ""))
		collider.rebuild_all()


func _sync_nodes_from_state() -> void:
	if player == null:
		return
	var facing := -1 if String(state.player.facing) == "left" else 1
	player.place_at(state.player_position(), facing)
	player.health = int(state.player.health)
	collider.ensure_around(player.position)


# -------------------------------------------------------------------- runtime

func _physics_process(_delta: float) -> void:
	if player != null and collider != null:
		collider.ensure_around(player.position)
	if _paused or player == null:
		return
	if not _cursor_initialized:
		cursor_tile = state.player_tile()
		_cursor_initialized = true
		if renderer != null:
			renderer.set_cursor(cursor_tile)
	_handle_human_input()


## Human play drives the same services the probe drives. The keyboard cursor is
## moved with IJKL and the actions are F (dig), G (place) and E (craft); no mouse
## button, pointer lock or OS-level input capture is involved.
func _handle_human_input() -> void:
	if player.scripted_mode:
		return
	var moved := false
	if Input.is_action_just_pressed("ms_cursor_left"):
		cursor_tile.x -= 1
		moved = true
	if Input.is_action_just_pressed("ms_cursor_right"):
		cursor_tile.x += 1
		moved = true
	if Input.is_action_just_pressed("ms_cursor_up"):
		cursor_tile.y -= 1
		moved = true
	if Input.is_action_just_pressed("ms_cursor_down"):
		cursor_tile.y += 1
		moved = true
	if moved:
		cursor_tile = Vector2i(
			clampi(cursor_tile.x, 0, generator.map_size.x - 1),
			clampi(cursor_tile.y, 0, generator.map_size.y - 1))
		if renderer != null:
			renderer.set_cursor(cursor_tile)
	if Input.is_action_just_pressed("ms_dig"):
		last_action = dig(cursor_tile.x, cursor_tile.y, "")
	elif Input.is_action_just_pressed("ms_place"):
		last_action = place(cursor_tile.x, cursor_tile.y, _selected_material(), "")
	elif Input.is_action_just_pressed("ms_craft"):
		last_action = _craft_available()


## The material a player would place: the first placeable material the inventory
## can pay for, in the world's declaration order. The service still validates.
func _selected_material() -> String:
	for entry in _as_array(world.get("materials", [])):
		if not entry is Dictionary or not bool(entry.get("placeable", false)):
			continue
		var item := String(entry.get("item", ""))
		if item.is_empty():
			continue
		if int(state.inventory.get(item, 0)) > 0:
			return String(entry.id)
	return ""


## E tries the world's recipes in order and reports the first craft that succeeds;
## if none does, it reports the last real rejection so the player sees why.
func _craft_available() -> Dictionary:
	var recipes: Array = _as_array(world.get("recipes", []))
	var last: Dictionary = {"ok": false, "reason": "unknown_recipe", "detail": "This world declares no recipes"}
	for entry in recipes:
		if not entry is Dictionary or not entry.get("id") is String:
			continue
		var outcome := craft(String(entry.id), "")
		if bool(outcome.get("ok", false)):
			return outcome
		last = outcome
	return last


## Keeps the authoritative state in sync with the physics body. Called every
## physics tick by the player and by the probe after a setup teleport.
func tick(_root: Node = null) -> void:
	if player != null:
		player._sync_state()


func find_entity(entity_id: String) -> Node:
	return _entities.get(entity_id, null)


func scene_root() -> Node:
	return world_root


func player_node() -> Node:
	return player


func entity_tile(entity_id: String) -> Vector2i:
	return _entity_tiles.get(entity_id, Vector2i.ZERO)


func map_size() -> Vector2i:
	return generator.map_size


func _player_center() -> Vector2:
	if player != null:
		return player.position + Vector2(0.0, -params.body_height() * 0.5)
	return state.player_position() + Vector2(0.0, -params.body_height() * 0.5)


func _feet_for_tile(tile: Vector2i) -> Vector2:
	var size := float(params.tile_size())
	return Vector2(float(tile.x) * size + size * 0.5, float(tile.y + 1) * size)


func _solid_tiles_in_rect(rect: Rect2) -> int:
	var size := float(params.tile_size())
	var x0 := int(floor(rect.position.x / size))
	var y0 := int(floor(rect.position.y / size))
	var x1 := int(floor((rect.end.x - 0.001) / size))
	var y1 := int(floor((rect.end.y - 0.001) / size))
	var count := 0
	for ty in range(y0, y1 + 1):
		for tx in range(x0, x1 + 1):
			if terrain.is_solid(tx, ty):
				count += 1
	return count


# ------------------------------------------------------------------ snapshot

func snapshot() -> Dictionary:
	var player_tile: Array = state.player.tile.duplicate()
	var position: Array = state.player.position.duplicate()
	var chunks: Dictionary = {}
	for chunk_id in terrain.known_chunk_ids():
		var coords := chunk_store.parse_chunk_id(String(chunk_id))
		var report := terrain.chunk_report(coords.x, coords.y)
		chunks[String(chunk_id)] = {
			"revision": int(report.revision),
			"edited": bool(report.edited),
			"cells": int(report.cells),
			"sha256": String(report.hash),
		}
	var overlaps: Array = []
	if player != null:
		var rect := player.body_rect()
		var size := float(params.tile_size())
		var x0 := int(floor(rect.position.x / size))
		var y0 := int(floor(rect.position.y / size))
		var x1 := int(floor((rect.end.x - 0.001) / size))
		var y1 := int(floor((rect.end.y - 0.001) / size))
		for ty in range(y0, y1 + 1):
			for tx in range(x0, x1 + 1):
				if terrain.is_solid(tx, ty):
					overlaps.append("%d,%d" % [tx, ty])
		for entity_id in _entities.keys():
			var station: Node = _entities[entity_id]
			if station is Area2D and (station as Area2D).overlaps_body(player):
				overlaps.append(String(entity_id))
	return {
		"format": MiningBaseContract.SNAPSHOT_FORMAT,
		"worldId": state.world_id,
		"baseId": MiningBaseContract.BASE_ID,
		"baseVersion": MiningBaseContract.BASE_VERSION,
		"stateVersion": MiningWorldState.STATE_VERSION,
		"mapSize": [generator.map_size.x, generator.map_size.y],
		"chunkTiles": [generator.chunk_tiles.x, generator.chunk_tiles.y],
		"tileSize": params.tile_size(),
		"seed": generator.terrain_seed,
		"player": {
			"tile": player_tile,
			"position": position,
			"facing": String(state.player.facing),
			"health": int(state.player.health),
			"toolTier": inventory.tool_tier(),
			"equipped": state.equipped,
			"onFloor": player.is_on_floor() if player != null else false,
		},
		"inventory": _snapshot_inventory(),
		"tools": state.tools.duplicate(),
		"chunks": chunks,
		"editCount": terrain.edit_count(),
		"terrainHash": terrain.terrain_hash(),
		"worldRevision": state.world_revision,
		"rescue": rescue.duplicate(true),
		"physical": {
			"overlaps": overlaps,
			"solidTilesInPlayerRect": _solid_tiles_in_rect(player.body_rect()) if player != null else 0,
		},
		"save": {"lastSave": last_save.duplicate(true)},
		"bootError": boot_error,
		"cursor": [cursor_tile.x, cursor_tile.y],
		"lastAction": last_action.duplicate(true),
	}


func _snapshot_inventory() -> Dictionary:
	var out: Dictionary = {}
	var keys: Array = state.inventory.keys()
	keys.sort()
	for key in keys:
		if int(state.inventory[key]) > 0:
			out[String(key)] = int(state.inventory[key])
	return out


# --------------------------------------------------------------- persistence

func save() -> Dictionary:
	if state == null or state.world_id.is_empty():
		return {"ok": false, "error": "world identity is missing", "stage": "index"}
	if not boot_error.is_empty():
		return {"ok": false, "error": boot_error}
	if player != null and is_instance_valid(player):
		player._sync_state()
	state.edit_count = terrain.edit_count()
	state.terrain_hash = terrain.terrain_hash()
	var outcome := save_store.save(state, terrain)
	if bool(outcome.get("ok", false)):
		last_save = {"ok": true, "bytes": int(outcome.bytes), "sha256": String(outcome.sha256), "chunks": int(outcome.chunks)}
		var hashes: Variant = outcome.get("chunkHashes", {})
		if hashes is Dictionary:
			terrain.mark_clean(hashes)
		var index: Variant = outcome.get("chunkIndex", {})
		if index is Dictionary:
			state.chunk_index = index.duplicate(true)
	else:
		last_save = {"ok": false, "error": String(outcome.get("error", "")), "stage": String(outcome.get("stage", ""))}
	return outcome


func restore() -> Dictionary:
	if state == null or state.world_id.is_empty():
		return {"ok": false, "reason": "bad_state", "detail": "world identity is missing"}
	var outcome := save_store.restore_into(state, terrain)
	if bool(outcome.get("ok", false)):
		if bool(outcome.get("restored", false)):
			var reported: Dictionary = outcome.get("rescue", {})
			rescue["resolved"] = bool(reported.get("resolved", false))
			rescue["from"] = reported.get("from", [])
			rescue["to"] = reported.get("to", [])
			rescue["reason"] = String(reported.get("reason", ""))
			collider.rebuild_all()
			_sync_nodes_from_state()
		boot_error = ""
	return outcome


func reset_to_initial() -> Dictionary:
	save_store.erase()
	terrain.clear_edits()
	collider.rebuild_all()
	rescue = {"resolved": false, "from": [], "to": [], "reason": "", "resolvedTiles": []}
	last_save = {}
	boot_error = ""
	state.world_id = String(world.get("worldId", ""))
	_apply_initial_progress()
	_sync_nodes_from_state()
	if renderer != null:
		renderer.invalidate()
	return {"ok": true, "snapshot": snapshot()}


func request_id(explicit: String) -> String:
	if not explicit.is_empty():
		return explicit
	_auto_request_counter += 1
	return "auto:%d" % _auto_request_counter


func _exit_tree() -> void:
	if _exit_saved:
		return
	_exit_saved = true
	if state == null or state.world_id.is_empty():
		return
	if not bool(world.get("autosaveOnExit", true)):
		return
	if not boot_error.is_empty():
		return
	save()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		_exit_tree()


# ------------------------------------------------------------ host integration
# SPEC section 9: the only members the shared adapter and host scripts may use.

const MANAGED_FORMAT := "craftmine.godot-mining-sandbox-managed/1"
const MANAGED_LIMIT := 1048576  # shared state_guard body limit
## A saved player tile may sit this many rows above the top row: the player can
## legitimately stand on the surface edge, but must not be restored far off-map.
const PLAYER_TILE_MARGIN := 8

var _paused: bool = false


## A host must not drive a world project it did not create.
func bind_world(world_id: String) -> String:
	if state == null or state.world_id.is_empty():
		return "Mining sandbox has no world identity"
	if world_id.is_empty():
		return "Requested world identity is empty"
	if world_id != state.world_id:
		return "World identity mismatch: the project belongs to %s" % state.world_id
	return ""


func terrain_hash() -> String:
	return terrain.terrain_hash() if terrain != null else ""


func tile_at(tx: int, ty: int) -> Dictionary:
	if terrain == null or not generator.in_bounds(tx, ty):
		return {"ok": false, "reason": "out_of_bounds", "tx": tx, "ty": ty}
	var material := terrain.get_tile(tx, ty)
	var data := terrain.material_data(material)
	return {
		"ok": true,
		"tx": tx,
		"ty": ty,
		"material": material,
		"solid": terrain.is_solid(tx, ty),
		"breakable": bool(data.get("breakable", false)),
		"requiredTier": int(data.get("requiredTier", 0)),
		"chunk": generator.chunk_id_of(tx, ty),
	}


func inventory_report() -> Dictionary:
	var report := _snapshot_inventory()
	report["ok"] = true
	return report


func dig(tx: int, ty: int, explicit_request_id: String = "") -> Dictionary:
	return terrain.dig(tx, ty, request_id(explicit_request_id))


func place(tx: int, ty: int, material_id: String, explicit_request_id: String = "") -> Dictionary:
	return terrain.place(tx, ty, material_id, request_id(explicit_request_id))


func craft(recipe_id: String, explicit_request_id: String = "", station_id: String = "") -> Dictionary:
	return crafting.craft(recipe_id, request_id(explicit_request_id), station_id)


func set_paused(paused: bool) -> void:
	_paused = paused
	if player != null:
		player.scripted_input = Vector2.ZERO
		player.set_physics_process(not paused)


func is_paused() -> bool:
	return _paused


## SPEC 5.10: a self-contained body for the shared managed progress receipt. The
## chunk edits are part of the body, so a managed restore cannot lose terrain. An
## oversized body is reported instead of being truncated.
func capture_managed() -> Dictionary:
	if terrain == null or state == null or generator == null:
		return {"error": "Mining sandbox is not ready"}
	var chunks: Dictionary = {}
	for chunk_id in terrain.known_chunk_ids():
		var coords: Vector2i = chunk_store.parse_chunk_id(String(chunk_id))
		chunks[String(chunk_id)] = {
			"revision": terrain.chunk_revision(coords.x, coords.y),
			"cells": terrain.cells_of_chunk(coords.x, coords.y),
		}
	var body := {
		"format": MANAGED_FORMAT,
		"worldId": state.world_id,
		"baseId": MiningBaseContract.BASE_ID,
		"baseVersion": MiningBaseContract.BASE_VERSION,
		"stateVersion": MiningWorldState.STATE_VERSION,
		"seed": generator.terrain_seed,
		"mapSize": [generator.map_size.x, generator.map_size.y],
		"state": state.to_dict(),
		"chunks": chunks,
		"terrainHash": terrain.terrain_hash(),
	}
	var size := JSON.stringify(body).to_utf8_buffer().size()
	if size > MANAGED_LIMIT:
		return {"error": "managed_body_too_large", "bytes": size}
	return body


## SPEC 5.10: validate the entire body, then apply it. Nothing is applied when any
## part is rejected.
func restore_managed(body: Dictionary) -> Dictionary:
	if terrain == null or state == null or generator == null:
		return _managed_reject("bad_state", "Mining sandbox is not ready")
	if String(body.get("format", "")) != MANAGED_FORMAT:
		return _managed_reject("bad_format", "Managed body format is not supported")
	if int(body.get("stateVersion", -1)) != MiningWorldState.STATE_VERSION:
		return _managed_reject("bad_state_version", "Managed body state version is not supported")
	if String(body.get("worldId", "")) != state.world_id:
		return _managed_reject("bad_world_id", "Managed body belongs to another world")
	if int(body.get("seed", 0)) != generator.terrain_seed:
		return _managed_reject("bad_seed", "Managed body seed does not match this world")
	var size: Variant = body.get("mapSize", [])
	if not size is Array or size.size() != 2 or int(size[0]) != generator.map_size.x or int(size[1]) != generator.map_size.y:
		return _managed_reject("bad_map_size", "Managed body map size does not match this world")
	var raw_chunks: Variant = body.get("chunks", {})
	if not raw_chunks is Dictionary:
		return _managed_reject("bad_state", "Managed body chunks are invalid")
	var last_chunk := Vector2i(
		ceili(float(generator.map_size.x) / float(params.chunk_tiles().x)) - 1,
		ceili(float(generator.map_size.y) / float(params.chunk_tiles().y)) - 1)
	var validated: Dictionary = {}
	for chunk_key in raw_chunks.keys():
		if not chunk_key is String:
			return _managed_reject("bad_state", "Managed chunk key is invalid")
		var coords: Vector2i = chunk_store.parse_chunk_id(String(chunk_key))
		if coords.x < 0 or coords.y < 0 or coords.x > last_chunk.x or coords.y > last_chunk.y:
			return _managed_reject("chunk_out_of_range", "Managed chunk %s is outside the map" % chunk_key)
		var entry: Variant = raw_chunks[chunk_key]
		if not entry is Dictionary or not entry.get("cells", []) is Array:
			return _managed_reject("bad_state", "Managed chunk %s has no cell list" % chunk_key)
		var cells: Array = []
		for cell in entry.cells:
			if not cell is Array or cell.size() != 3:
				return _managed_reject("bad_state", "Managed chunk %s has a malformed cell" % chunk_key)
			var tx := int(cell[0])
			var ty := int(cell[1])
			var material := String(cell[2])
			if not generator.in_bounds(tx, ty):
				return _managed_reject("chunk_out_of_range", "Managed cell %d,%d is outside the map" % [tx, ty])
			if generator.chunk_id_of(tx, ty) != String(chunk_key):
				return _managed_reject("bad_state", "Managed cell %d,%d is not in chunk %s" % [tx, ty, chunk_key])
			if material != MiningBaseContract.AIR and not terrain.materials.has(material):
				return _managed_reject("bad_state", "Managed cell %d,%d uses unknown material %s" % [tx, ty, material])
			cells.append([tx, ty, material])
		validated[String(chunk_key)] = {
			"revision": maxi(0, int(entry.get("revision", 0))),
			"cells": cells,
		}
	var raw_state: Variant = body.get("state", {})
	if not raw_state is Dictionary:
		return _managed_reject("bad_state", "Managed body state is missing")
	var raw_tile: Variant = (raw_state as Dictionary).get("player", {}).get("tile", []) if (raw_state as Dictionary).get("player") is Dictionary else []
	if not raw_tile is Array or raw_tile.size() != 2 \
			or int(raw_tile[0]) < 0 or int(raw_tile[0]) >= generator.map_size.x \
			or int(raw_tile[1]) < -PLAYER_TILE_MARGIN or int(raw_tile[1]) >= generator.map_size.y:
		return _managed_reject("bad_state", "Managed player tile is outside the map")
	# WorldState.from_dict validates every field before it assigns anything.
	var applied := state.from_dict(raw_state, state.world_id)
	if not bool(applied.get("ok", false)):
		return _managed_reject("bad_state", String(applied.get("error", "Managed state was rejected")))
	terrain.clear_edits()
	for chunk_key in validated.keys():
		var coords: Vector2i = chunk_store.parse_chunk_id(String(chunk_key))
		terrain.apply_chunk(coords.x, coords.y, validated[chunk_key]["cells"], int(validated[chunk_key]["revision"]))
	if collider != null:
		collider.rebuild_all()
	_sync_nodes_from_state()
	if renderer != null:
		renderer.invalidate()
	boot_error = ""
	return {"ok": true, "terrainHash": terrain.terrain_hash(), "chunks": validated.size()}


func _managed_reject(reason: String, detail: String) -> Dictionary:
	return {"ok": false, "reason": reason, "detail": detail, "error": detail}


# ------------------------------------------------------------------- helpers

func _register_input_actions() -> void:
	_add_action("ms_left", [KEY_A, KEY_LEFT])
	_add_action("ms_right", [KEY_D, KEY_RIGHT])
	_add_action("ms_jump", [KEY_SPACE, KEY_W, KEY_UP])
	_add_action("ms_cursor_left", [KEY_J])
	_add_action("ms_cursor_right", [KEY_L])
	_add_action("ms_cursor_up", [KEY_I])
	_add_action("ms_cursor_down", [KEY_K])
	_add_action("ms_dig", [KEY_F])
	_add_action("ms_place", [KEY_G])
	_add_action("ms_craft", [KEY_E])


func _add_action(action: String, keys: Array) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	for key in keys:
		var event := InputEventKey.new()
		event.physical_keycode = key
		if not InputMap.action_has_event(action, event):
			InputMap.action_add_event(action, event)


func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return null
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	return parsed


static func _as_array(value: Variant) -> Array:
	return value if value is Array else []
