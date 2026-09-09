## Progress persistence for one mining-sandbox world (SPEC section 5).
##
## Layout (under the world's own user:// root, or under
## CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT when that documented test hook is set):
##
##   <root>/worlds/<sha256(worldId)>/progress.json
##   <root>/worlds/<sha256(worldId)>/progress.json.bak
##   <root>/worlds/<sha256(worldId)>/chunks/<cx>_<cy>.json
##
## Chunk files are written first and progress.json is the commit point. Loading is
## whole-reject: every file and every field is validated before anything is
## applied to the live state.
class_name MiningSaveStore
extends RefCounted

const PROGRESS_FORMAT := "craftmine.godot-mining-sandbox-progress/1"
const PROGRESS_FILE := "progress.json"
const CHUNK_DIR := "chunks"
const AIR := "air"

var world_id: String = ""
var generator: MiningTerrainGenerator
var params: MiningParams
var chunk_store: MiningChunkStore
var material_ids: Dictionary = {}
var materials: Dictionary = {}


func setup(world_id_value: String, generator_value: MiningTerrainGenerator, params_value: MiningParams, chunk_store_value: MiningChunkStore, material_catalog: Array) -> void:
	world_id = world_id_value
	generator = generator_value
	params = params_value
	chunk_store = chunk_store_value
	material_ids.clear()
	materials.clear()
	for entry in material_catalog:
		if entry is Dictionary and entry.get("id") is String:
			material_ids[String(entry.id)] = true
			materials[String(entry.id)] = entry


# ------------------------------------------------------------------- layout

func progress_root() -> String:
	var override := OS.get_environment("CRAFTMINE_MINING_SANDBOX_PROGRESS_ROOT")
	var base := override if not override.is_empty() else "user://"
	return base.path_join("worlds")


func progress_dir() -> String:
	return progress_root().path_join(world_id.sha256_text())


func progress_path() -> String:
	return progress_dir().path_join(PROGRESS_FILE)


func chunks_dir() -> String:
	return progress_dir().path_join(CHUNK_DIR)


# --------------------------------------------------------------------- save

func save(state: MiningWorldState, terrain: MiningTerrainService) -> Dictionary:
	if state == null or world_id.is_empty():
		return {"ok": false, "stage": "index", "error": "world identity is missing"}
	var directory := progress_dir()
	if DirAccess.make_dir_recursive_absolute(directory) != OK:
		return {"ok": false, "stage": "directory", "error": "progress directory could not be created"}
	var chunk_directory := chunks_dir()
	if DirAccess.make_dir_recursive_absolute(chunk_directory) != OK:
		return {"ok": false, "stage": "directory", "error": "chunk directory could not be created"}

	var index: Dictionary = {}
	var hashes: Dictionary = {}
	var written := 0
	for chunk_id in terrain.edited_chunk_ids():
		var coords := chunk_store.parse_chunk_id(String(chunk_id))
		if coords.x < 0:
			continue
		var cells := terrain.cells_of_chunk(coords.x, coords.y)
		if cells.is_empty():
			continue
		var revision := terrain.chunk_revision(coords.x, coords.y)
		var needs_write := terrain.is_dirty(coords.x, coords.y) or not FileAccess.file_exists(chunk_store.path_in(chunk_directory, coords.x, coords.y))
		var sha := ""
		var bytes := 0
		if needs_write:
			var outcome := chunk_store.write_chunk(chunk_directory, coords.x, coords.y, revision, cells, material_ids)
			if not bool(outcome.get("ok", false)):
				return {"ok": false, "stage": String(outcome.get("stage", "chunk")), "error": String(outcome.get("error", "chunk write failed"))}
			sha = String(outcome.sha256)
			bytes = int(outcome.bytes)
			written += 1
		else:
			sha = _file_sha(chunk_store.path_in(chunk_directory, coords.x, coords.y))
			bytes = _file_bytes(chunk_store.path_in(chunk_directory, coords.x, coords.y))
			if sha.is_empty():
				return {"ok": false, "stage": "verify", "error": "chunk file could not be re-read"}
		index[String(chunk_id)] = {"revision": revision, "sha256": sha, "bytes": bytes, "cells": cells.size()}
		hashes[String(chunk_id)] = sha

	var state_dict := state.to_dict()
	state_dict["chunkIndex"] = index.duplicate(true)
	state_dict["editCount"] = terrain.edit_count()
	state_dict["terrainHash"] = terrain.terrain_hash()
	var payload := {
		"format": PROGRESS_FORMAT,
		"worldId": world_id,
		"stateVersion": MiningWorldState.STATE_VERSION,
		"savedAt": Time.get_datetime_string_from_system(true),
		"seed": generator.terrain_seed,
		"mapSize": [generator.map_size.x, generator.map_size.y],
		"worldRevision": state.world_revision,
		"chunks": index,
		"ledgerEvicted": state.ledger_evicted,
		"state": state_dict,
	}
	var text := JSON.stringify(payload, "  ")
	var path := progress_path()
	var sha := text.sha256_text()
	var outcome := _write_index(path, text)
	if not outcome.is_empty():
		return {"ok": false, "stage": String(outcome.get("stage", "index")), "error": String(outcome.get("error", ""))}
	var verify := _verify_file(path, sha)
	if not verify.is_empty():
		return {"ok": false, "stage": "verify", "error": verify}
	_prune_chunk_files(chunk_directory, index)
	return {
		"ok": true,
		"path": ProjectSettings.globalize_path(path),
		"bytes": text.to_utf8_buffer().size(),
		"sha256": sha,
		"chunks": index.size(),
		"written": written,
		"chunkHashes": hashes,
		"chunkIndex": index,
	}


## An unmodified chunk must not leave a file behind (SPEC 5.1), so any chunk file
## that the freshly committed index does not reference is removed.
func _prune_chunk_files(directory: String, index: Dictionary) -> void:
	var handle := DirAccess.open(directory)
	if handle == null:
		return
	handle.list_dir_begin()
	var name := handle.get_next()
	while not name.is_empty():
		if not handle.current_is_dir() and name.ends_with(".json"):
			var chunk_id := name.substr(0, name.length() - 5)
			if not index.has(chunk_id):
				DirAccess.remove_absolute(directory.path_join(name))
		elif not handle.current_is_dir() and name.ends_with(".json.tmp"):
			DirAccess.remove_absolute(directory.path_join(name))
		name = handle.get_next()
	handle.list_dir_end()


func _write_index(path: String, text: String) -> Dictionary:
	var temporary := path + ".tmp"
	var backup := path + ".bak"
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		return {"stage": "index", "error": "progress file could not be opened for writing"}
	file.store_string(text)
	file.flush()
	var status := file.get_error()
	file.close()
	if status != OK:
		return {"stage": "index", "error": "progress file write failed"}
	var previous := FileAccess.file_exists(path)
	if previous and FileAccess.file_exists(backup) and DirAccess.remove_absolute(backup) != OK:
		return {"stage": "index", "error": "progress backup could not be replaced"}
	if previous and DirAccess.rename_absolute(path, backup) != OK:
		return {"stage": "index", "error": "previous progress could not be backed up"}
	if DirAccess.rename_absolute(temporary, path) != OK:
		if previous:
			DirAccess.rename_absolute(backup, path)
		return {"stage": "index", "error": "progress could not be committed"}
	return {}


func _file_sha(path: String) -> String:
	if not FileAccess.file_exists(path):
		return ""
	return FileAccess.get_file_as_string(path).sha256_text()


func _file_bytes(path: String) -> int:
	if not FileAccess.file_exists(path):
		return 0
	return FileAccess.get_file_as_string(path).to_utf8_buffer().size()


func _verify_file(path: String, expected_sha: String) -> String:
	if not FileAccess.file_exists(path):
		return "progress file vanished after writing"
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		return "progress file could not be re-read"
	if text.sha256_text() != expected_sha:
		return "progress file hash changed after writing"
	return ""


# ------------------------------------------------------------------ restore

## Whole-reject restore. Returns
##   {ok:true, restored:false, reason:"missing_progress"} for a fresh start,
##   {ok:true, restored:true, rescue:{...}, ...} on success,
##   {ok:false, reason, detail, error} on any rejection.
## The live state and terrain are untouched unless everything validated.
func restore_into(state: MiningWorldState, terrain: MiningTerrainService) -> Dictionary:
	var path := progress_path()
	var from_backup := false
	if not FileAccess.file_exists(path):
		if FileAccess.file_exists(path + ".bak"):
			path += ".bak"
			from_backup = true
		else:
			return {"ok": true, "restored": false, "reason": "missing_progress"}
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		return _reject("bad_json", "progress file could not be read", path)
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary:
		return _reject("bad_json", "progress file is not valid JSON", path)
	var data: Dictionary = parsed
	if not data.get("format") is String or String(data.format) != PROGRESS_FORMAT:
		return _reject("bad_format", "progress format is not supported", path)
	if not data.get("worldId") is String or String(data.worldId) != world_id:
		return _reject("bad_world_id", "progress belongs to another world", path)
	if _as_int(data.get("stateVersion")) != MiningWorldState.STATE_VERSION:
		return _reject("bad_state_version", "progress state version is not supported", path)
	if _as_int(data.get("seed")) != generator.terrain_seed:
		return _reject("bad_seed", "progress was generated with another seed", path)
	var raw_size: Variant = data.get("mapSize")
	if not raw_size is Array or raw_size.size() != 2 or _as_int(raw_size[0]) != generator.map_size.x or _as_int(raw_size[1]) != generator.map_size.y:
		return _reject("bad_map_size", "progress map size does not match the world", path)
	var raw_state: Variant = data.get("state")
	if not raw_state is Dictionary:
		return _reject("bad_state", "progress state is missing", path)
	var state_data: Dictionary = raw_state
	if not state_data.get("format") is String or String(state_data.format) != MiningWorldState.STATE_FORMAT:
		return _reject("bad_format", "state format is not supported", path)
	if _as_int(state_data.get("stateVersion")) != MiningWorldState.STATE_VERSION:
		return _reject("bad_state_version", "state version is not supported", path)

	var candidate := MiningWorldState.new()
	var applied := candidate.from_dict(state_data, world_id)
	if not applied.get("ok", false):
		return _reject("bad_state", String(applied.get("error", "state is invalid")), path)

	var raw_chunks: Variant = data.get("chunks", {})
	if not raw_chunks is Dictionary:
		return _reject("bad_state", "chunk index is missing", path)
	var pending: Dictionary = {}
	var overrides: Dictionary = {}
	var index_mirror: Dictionary = {}
	for chunk_key in raw_chunks.keys():
		if not chunk_key is String:
			return _reject("bad_state", "chunk index key is invalid", path)
		var chunk_id := String(chunk_key)
		var coords := chunk_store.parse_chunk_id(chunk_id)
		if coords.x < 0:
			return _reject("chunk_corrupt", "chunk index key %s is malformed" % chunk_id, path)
		if coords.x >= generator.chunk_count().x or coords.y >= generator.chunk_count().y:
			return _reject("chunk_out_of_range", "chunk %s is outside the map" % chunk_id, path)
		var entry: Variant = raw_chunks[chunk_key]
		if not entry is Dictionary:
			return _reject("bad_state", "chunk index entry %s is invalid" % chunk_id, path)
		var expected_sha := String(entry.get("sha256", ""))
		var outcome := chunk_store.read_chunk(chunk_store.path_in(chunks_dir(), coords.x, coords.y), coords.x, coords.y, expected_sha, material_ids)
		if not bool(outcome.get("ok", false)):
			return _reject(String(outcome.get("reason", "chunk_corrupt")), String(outcome.get("detail", "")), path)
		var cells: Array = outcome.cells
		pending[chunk_id] = {"cells": cells, "revision": int(outcome.revision), "coords": coords}
		index_mirror[chunk_id] = entry.duplicate(true)
		for cell in cells:
			overrides[Vector2i(int(cell[0]), int(cell[1]))] = String(cell[2])

	var rescue := _resolve_saved_player(candidate.player_tile(), overrides)
	if not bool(rescue.get("ok", false)):
		return _reject("bad_state", String(rescue.get("detail", "player tile could not be resolved")), path)
	var restored_hash := _hash_with_overrides(overrides)
	if not candidate.terrain_hash.is_empty() and candidate.terrain_hash != restored_hash:
		return _reject("bad_state", "terrain hash does not match the restored chunks", path)

	# Everything validated: apply.
	var rescued := bool(rescue.get("resolved", false))
	if rescued:
		var resolved: Array = rescue.to
		candidate.set_player(Vector2i(int(resolved[0]), int(resolved[1])), _feet_for_tile(Vector2i(int(resolved[0]), int(resolved[1]))), String(candidate.player.facing), int(candidate.player.health))
	state.world_id = candidate.world_id
	state.player = candidate.player.duplicate(true)
	state.inventory = candidate.inventory.duplicate(true)
	state.tools = candidate.tools.duplicate()
	state.equipped = candidate.equipped
	state.flags = candidate.flags.duplicate(true)
	state.ledger = candidate.ledger.duplicate(true)
	state.ledger_evicted = candidate.ledger_evicted
	state.world_revision = candidate.world_revision
	terrain.clear_edits()
	for chunk_id in pending.keys():
		var info: Dictionary = pending[chunk_id]
		var coords: Vector2i = info.coords
		terrain.apply_chunk(coords.x, coords.y, info.cells, int(info.revision))
	state.chunk_index = index_mirror
	state.edit_count = terrain.edit_count()
	state.terrain_hash = terrain.terrain_hash()
	var rescue_report := {
		"resolved": rescued,
		"from": rescue.get("from", []),
		"to": rescue.get("to", []),
		"reason": String(rescue.get("reason", "")),
		"resolvedTiles": [],
	}
	return {
		"ok": true,
		"restored": true,
		"fromBackup": from_backup,
		"sha256": text.sha256_text(),
		"bytes": text.to_utf8_buffer().size(),
		"chunks": pending.size(),
		"rescue": rescue_report,
	}


## Saved player tile resolution (SPEC 5.8): the nearest free tile above inside
## the same chunk, with enough head-room for the 12x26 body.
func _resolve_saved_player(tile: Vector2i, overrides: Dictionary) -> Dictionary:
	var material := _material_at(tile.x, tile.y, overrides)
	if not _is_solid(material):
		return {"ok": true, "resolved": false, "from": [tile.x, tile.y], "to": [tile.x, tile.y], "reason": ""}
	var chunk_top := (tile.y / chunk_store.chunk_tiles.y) * chunk_store.chunk_tiles.y
	for ty in range(tile.y, chunk_top - 1, -1):
		var candidate := Vector2i(tile.x, ty)
		var candidate_material := _material_at(candidate.x, candidate.y, overrides)
		if _is_solid(candidate_material):
			continue
		if _body_overlaps_solid(candidate, overrides):
			continue
		return {
			"ok": true,
			"resolved": true,
			"from": [tile.x, tile.y],
			"to": [candidate.x, candidate.y],
			"reason": "saved_player_inside_solid",
		}
	return {"ok": false, "detail": "saved player tile is buried and cannot be rescued inside its chunk"}


func _material_at(tx: int, ty: int, overrides: Dictionary) -> String:
	if tx < 0 or ty < 0 or tx >= generator.map_size.x or ty >= generator.map_size.y:
		return AIR
	var key := Vector2i(tx, ty)
	if overrides.has(key):
		return String(overrides[key])
	return generator.generate_cell(tx, ty)


func _is_solid(material: String) -> bool:
	if material.is_empty() or material == AIR:
		return false
	var entry: Variant = materials.get(material, {})
	return entry is Dictionary and bool(entry.get("solid", false))


func _body_overlaps_solid(tile: Vector2i, overrides: Dictionary) -> bool:
	var position := _feet_for_tile(tile)
	var rect := Rect2(
		position.x - params.half_width(),
		position.y - params.body_height(),
		params.half_width() * 2.0,
		params.body_height(),
	)
	var x0 := int(floor(rect.position.x / float(params.tile_size())))
	var y0 := int(floor(rect.position.y / float(params.tile_size())))
	var x1 := int(floor((rect.end.x - 0.001) / float(params.tile_size())))
	var y1 := int(floor((rect.end.y - 0.001) / float(params.tile_size())))
	for ty in range(y0, y1 + 1):
		for tx in range(x0, x1 + 1):
			if _is_solid(_material_at(tx, ty, overrides)):
				return true
	return false


func _feet_for_tile(tile: Vector2i) -> Vector2:
	return Vector2(float(tile.x * params.tile_size()) + params.tile_size() * 0.5, float((tile.y + 1) * params.tile_size()))


func _hash_with_overrides(overrides: Dictionary) -> String:
	var parts := PackedStringArray()
	var width := generator.map_size.x
	var height := generator.map_size.y
	for ty in range(height):
		for tx in range(width):
			parts.append("%d,%d,%s" % [tx, ty, _material_at(tx, ty, overrides)])
	return "\n".join(parts).sha256_text()


# ------------------------------------------------------------------- erase

func erase() -> Dictionary:
	var removed := 0
	for candidate in [progress_path(), progress_path() + ".tmp", progress_path() + ".bak"]:
		if FileAccess.file_exists(candidate):
			if DirAccess.remove_absolute(candidate) != OK:
				return {"ok": false, "error": "progress file could not be erased"}
			removed += 1
	var handle := DirAccess.open(chunks_dir())
	if handle != null:
		handle.list_dir_begin()
		var name := handle.get_next()
		while not name.is_empty():
			if not handle.current_is_dir() and name.ends_with(".json"):
				DirAccess.remove_absolute(chunks_dir().path_join(name))
				removed += 1
			name = handle.get_next()
		handle.list_dir_end()
	return {"ok": true, "removed": removed}


func _reject(reason: String, detail: String, path: String) -> Dictionary:
	return {"ok": false, "reason": reason, "detail": detail, "error": "%s: %s" % [reason, detail], "path": path}


static func _as_int(value: Variant) -> Variant:
	if value is int:
		return value
	if value is float and is_finite(value) and float(value) == floorf(float(value)):
		return int(value)
	return null
