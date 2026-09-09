## Authoritative runtime state for one mining-sandbox world instance.
##
## Every field here is persisted; the loader is whole-reject and validates every
## field strictly, because a progress file is untrusted input. Gameplay never
## mutates this object directly: the terrain, inventory and crafting services do,
## through the same methods the probe calls.
class_name MiningWorldState
extends RefCounted

const STATE_VERSION := 1
const STATE_FORMAT := "craftmine.godot-mining-sandbox-state/1"
const FACINGS := ["left", "right"]
const DEFAULT_LEDGER_LIMIT := 1024

var world_id: String = ""
var player: Dictionary = {
	"tile": [0, 0],
	"position": [0.0, 0.0],
	"facing": "right",
	"health": 3,
}
var inventory: Dictionary = {}
var tools: Array = []
var equipped: String = ""
var flags: Dictionary = {}
var chunk_index: Dictionary = {}
var edit_count: int = 0
var terrain_hash: String = ""
var world_revision: int = 0
var ledger: Dictionary = {}
var ledger_evicted: int = 0


func player_tile() -> Vector2i:
	var tile: Variant = player.get("tile", [0, 0])
	return Vector2i(int(tile[0]), int(tile[1]))


func player_position() -> Vector2:
	var position: Variant = player.get("position", [0.0, 0.0])
	return Vector2(float(position[0]), float(position[1]))


func set_player(tile: Vector2i, position: Vector2, facing: String, health: int) -> void:
	player = {
		"tile": [tile.x, tile.y],
		"position": [position.x, position.y],
		"facing": facing if FACINGS.has(facing) else "right",
		"health": maxi(0, health),
	}


func count_of(item_id: String) -> int:
	return int(inventory.get(item_id, 0))


# -------------------------------------------------------------------- ledger

## Returns the recorded entry for a request id, or an empty dictionary.
## `auto:` ids are generated per process and must never be deduplicated across
## restarts (SPEC 4), so they are not stored in the persistent ledger at all.
func ledger_lookup(request_id: String) -> Dictionary:
	if request_id.is_empty() or request_id.begins_with("auto:") or not ledger.has(request_id):
		return {}
	var entry: Variant = ledger[request_id]
	return entry if entry is Dictionary else {}


## FIFO-bounded ledger. Re-recording an id refreshes its position so that the
## bound evicts genuinely stale ids first; evictions are counted for the save.
func ledger_record(request_id: String, op: String, result: Dictionary, applied: bool, limit: int) -> void:
	if request_id.is_empty() or request_id.begins_with("auto:"):
		return
	if ledger.has(request_id):
		ledger.erase(request_id)
	ledger[request_id] = {"op": op, "result": result.duplicate(true), "applied": applied}
	var bound := maxi(1, limit)
	while ledger.size() > bound:
		var oldest: Variant = ledger.keys()[0]
		ledger.erase(oldest)
		ledger_evicted += 1


func ledger_clear() -> void:
	ledger.clear()
	ledger_evicted = 0


# ----------------------------------------------------------- initialisation

## Applies the authored initial progress of a brand new world. Values are
## sanitised so a template cannot ship a save the strict loader would reject.
func apply_initial(initial: Dictionary, max_stack: int) -> void:
	inventory.clear()
	for entry in _as_array(initial.get("inventory", [])):
		if entry is Dictionary and entry.get("id") is String:
			var count := int(_safe_int(entry.get("count"), 0))
			if count > 0:
				inventory[String(entry.id)] = count
	tools.clear()
	for entry in _as_array(initial.get("tools", [])):
		if entry is String and not tools.has(entry):
			tools.append(entry)
	flags.clear()
	for entry in _as_array(initial.get("flags", [])):
		if entry is Dictionary and entry.get("id") is String:
			var value: Variant = entry.get("value", true)
			if value is bool or value is String or value is int or value is float:
				flags[String(entry.id)] = value
	equipped = tools[0] if not tools.is_empty() else ""
	var raw_player: Dictionary = initial.get("player", {}) if initial.get("player") is Dictionary else {}
	var health := maxi(0, int(_safe_int(raw_player.get("health"), 3)))
	var facing := String(raw_player.get("facing", "right"))
	set_player(Vector2i.ZERO, Vector2.ZERO, facing, health)
	chunk_index.clear()
	edit_count = 0
	terrain_hash = ""
	world_revision = 0
	ledger_clear()


# ------------------------------------------------------------ serialization

func to_dict() -> Dictionary:
	return {
		"format": STATE_FORMAT,
		"stateVersion": STATE_VERSION,
		"worldId": world_id,
		"player": {
			"tile": [int(player.tile[0]), int(player.tile[1])],
			"position": [float(player.position[0]), float(player.position[1])],
			"facing": String(player.facing),
			"health": int(player.health),
		},
		"inventory": inventory.duplicate(true),
		"tools": tools.duplicate(),
		"equipped": equipped,
		"flags": flags.duplicate(true),
		"chunkIndex": chunk_index.duplicate(true),
		"editCount": edit_count,
		"terrainHash": terrain_hash,
		"worldRevision": world_revision,
		"ledger": ledger.duplicate(true),
		"ledgerEvicted": ledger_evicted,
	}


func clone():
	var copy = load("res://scripts/base/world_state.gd").new()
	var applied: Dictionary = copy.from_dict(to_dict(), world_id)
	if not applied.get("ok", false):
		return null
	return copy


## Strict, whole-reject validation. Returns {"ok": true} or
## {"ok": false, "error": <message>} and mutates nothing on failure.
func from_dict(data: Dictionary, expected_world_id: String) -> Dictionary:
	if not data.get("format") is String or String(data.get("format")) != STATE_FORMAT:
		return _invalid("State format is not supported")
	if _as_int(data.get("stateVersion")) != STATE_VERSION:
		return _invalid("State version is not supported")
	if not data.get("worldId") is String or String(data.get("worldId")) != expected_world_id:
		return _invalid("State belongs to another world")

	var raw_player: Variant = data.get("player")
	if not raw_player is Dictionary:
		return _invalid("Player state is invalid")
	var next_player: Dictionary = raw_player
	var raw_tile: Variant = next_player.get("tile")
	if not raw_tile is Array or raw_tile.size() != 2:
		return _invalid("Player tile is invalid")
	var tile_x: Variant = _as_int(raw_tile[0])
	var tile_y: Variant = _as_int(raw_tile[1])
	if tile_x == null or tile_y == null:
		return _invalid("Player tile is invalid")
	var raw_position: Variant = next_player.get("position")
	if not raw_position is Array or raw_position.size() != 2:
		return _invalid("Player position is invalid")
	var pos_x: Variant = _as_float(raw_position[0])
	var pos_y: Variant = _as_float(raw_position[1])
	if pos_x == null or pos_y == null:
		return _invalid("Player position is invalid")
	if not next_player.get("facing") is String or not FACINGS.has(String(next_player.facing)):
		return _invalid("Player facing is invalid")
	var health: Variant = _as_int(next_player.get("health"))
	if health == null or health < 0:
		return _invalid("Player health is invalid")

	var next_inventory: Dictionary = {}
	var raw_inventory: Variant = data.get("inventory")
	if not raw_inventory is Dictionary:
		return _invalid("Inventory is invalid")
	for key in raw_inventory.keys():
		if not key is String:
			return _invalid("Inventory key is invalid")
		var amount: Variant = _as_int(raw_inventory[key])
		if amount == null or amount < 0:
			return _invalid("Inventory amount is invalid")
		if amount > 0:
			next_inventory[String(key)] = amount

	var next_tools: Array = []
	var raw_tools: Variant = data.get("tools")
	if not raw_tools is Array:
		return _invalid("Tool list is invalid")
	for entry in raw_tools:
		if not entry is String:
			return _invalid("Tool entry is invalid")
		if not next_tools.has(entry):
			next_tools.append(String(entry))

	if not data.get("equipped") is String:
		return _invalid("Equipped tool is invalid")
	var next_equipped := String(data.equipped)
	if not next_equipped.is_empty() and not next_tools.has(next_equipped):
		return _invalid("Equipped tool is not owned")

	var next_flags: Dictionary = {}
	var raw_flags: Variant = data.get("flags")
	if not raw_flags is Dictionary:
		return _invalid("Flags are invalid")
	for key in raw_flags.keys():
		if not key is String:
			return _invalid("Flag key is invalid")
		var value: Variant = raw_flags[key]
		if not (value is bool or value is String or value is int or value is float):
			return _invalid("Flag value is invalid")
		next_flags[String(key)] = value

	var raw_index: Variant = data.get("chunkIndex")
	if not raw_index is Dictionary:
		return _invalid("Chunk index is invalid")
	var next_index: Dictionary = {}
	for key in raw_index.keys():
		if not key is String:
			return _invalid("Chunk index key is invalid")
		var entry: Variant = raw_index[key]
		if not entry is Dictionary:
			return _invalid("Chunk index entry is invalid")
		var revision: Variant = _as_int(entry.get("revision"))
		if revision == null or revision < 0:
			return _invalid("Chunk revision is invalid")
		var sha := String(entry.get("sha256", ""))
		if sha.length() != 64:
			return _invalid("Chunk hash is invalid")
		var bytes: Variant = _as_int(entry.get("bytes"))
		if bytes == null or bytes < 0:
			return _invalid("Chunk size is invalid")
		var cells: Variant = _as_int(entry.get("cells"))
		if cells == null or cells < 0:
			return _invalid("Chunk cell count is invalid")
		next_index[String(key)] = {"revision": revision, "sha256": sha, "bytes": bytes, "cells": cells}

	var edit_count_value: Variant = _as_int(data.get("editCount"))
	if edit_count_value == null or edit_count_value < 0:
		return _invalid("Edit count is invalid")
	if not data.get("terrainHash") is String:
		return _invalid("Terrain hash is invalid")
	var revision_value: Variant = _as_int(data.get("worldRevision"))
	if revision_value == null or revision_value < 0:
		return _invalid("World revision is invalid")

	var next_ledger: Dictionary = {}
	var raw_ledger: Variant = data.get("ledger", {})
	if not raw_ledger is Dictionary:
		return _invalid("Ledger is invalid")
	for key in raw_ledger.keys():
		if not key is String:
			return _invalid("Ledger key is invalid")
		var entry: Variant = raw_ledger[key]
		if not entry is Dictionary or not entry.get("op") is String or not entry.get("applied") is bool:
			return _invalid("Ledger entry is invalid")
		if not entry.get("result") is Dictionary:
			return _invalid("Ledger result is invalid")
		next_ledger[String(key)] = {
			"op": String(entry.op),
			"result": entry.result.duplicate(true),
			"applied": bool(entry.applied),
		}
	var evicted: Variant = _as_int(data.get("ledgerEvicted", 0))
	if evicted == null or evicted < 0:
		return _invalid("Ledger eviction count is invalid")

	# Everything validated: apply.
	world_id = expected_world_id
	player = {
		"tile": [int(tile_x), int(tile_y)],
		"position": [float(pos_x), float(pos_y)],
		"facing": String(next_player.facing),
		"health": int(health),
	}
	inventory = next_inventory
	tools = next_tools
	equipped = next_equipped
	flags = next_flags
	chunk_index = next_index
	edit_count = int(edit_count_value)
	terrain_hash = String(data.terrainHash)
	world_revision = int(revision_value)
	ledger = next_ledger
	ledger_evicted = int(evicted)
	return {"ok": true}


static func _invalid(message: String) -> Dictionary:
	return {"ok": false, "error": message}


static func _as_array(value: Variant) -> Array:
	return value if value is Array else []


static func _safe_int(value: Variant, fallback: int) -> int:
	var parsed: Variant = _as_int(value)
	return fallback if parsed == null else int(parsed)


static func _as_int(value: Variant) -> Variant:
	if value is int:
		return value
	if value is float and is_finite(value) and float(value) == floorf(float(value)):
		return int(value)
	return null


static func _as_float(value: Variant) -> Variant:
	if value is int or value is float:
		if is_finite(float(value)):
			return float(value)
	return null
