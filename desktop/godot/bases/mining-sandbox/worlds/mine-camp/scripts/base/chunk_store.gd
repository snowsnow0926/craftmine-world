## Chunk file I/O (SPEC section 5).
##
## A chunk file holds only the tiles that differ from the generated terrain. It is
## written atomically (temp file, flush, rename) and every write is verified by
## re-reading the file and comparing its SHA-256 with the value the caller is
## about to store in the progress index.
class_name MiningChunkStore
extends RefCounted

const CHUNK_FORMAT := "craftmine.godot-mining-sandbox-chunk/1"
const AIR := "air"

var world_id: String = ""
var terrain_seed: int = 0
var state_version: int = 1
var chunk_tiles: Vector2i = Vector2i(16, 16)
var map_size: Vector2i = Vector2i.ZERO
var max_bytes: int = 1048576
var max_cells: int = 4096


func setup(world_id_value: String, seed_value: int, state_version_value: int, chunk: Vector2i, size: Vector2i, max_bytes_value: int, max_cells_value: int) -> void:
	world_id = world_id_value
	terrain_seed = seed_value
	state_version = state_version_value
	chunk_tiles = chunk
	map_size = size
	max_bytes = maxi(1024, max_bytes_value)
	max_cells = maxi(1, max_cells_value)


func file_name(cx: int, cy: int) -> String:
	return "%d_%d.json" % [cx, cy]


func path_in(directory: String, cx: int, cy: int) -> String:
	return directory.path_join(file_name(cx, cy))


func chunk_id(cx: int, cy: int) -> String:
	return "%d_%d" % [cx, cy]


func parse_chunk_id(value: String) -> Vector2i:
	var parts := value.split("_", false)
	if parts.size() != 2:
		return Vector2i(-1, -1)
	if not parts[0].is_valid_int() or not parts[1].is_valid_int():
		return Vector2i(-1, -1)
	return Vector2i(int(parts[0]), int(parts[1]))


## Writes one chunk file. Returns {ok, sha256, bytes, path} or
## {ok:false, error, stage} where stage is "chunk" or "verify".
func write_chunk(directory: String, cx: int, cy: int, revision: int, cells: Array, material_ids: Dictionary) -> Dictionary:
	var payload := {
		"format": CHUNK_FORMAT,
		"worldId": world_id,
		"stateVersion": state_version,
		"seed": terrain_seed,
		"chunk": [cx, cy],
		"chunkSize": [chunk_tiles.x, chunk_tiles.y],
		"revision": revision,
		"savedAt": Time.get_datetime_string_from_system(true),
		"cells": cells,
	}
	var text := JSON.stringify(payload, "  ")
	var bytes := text.to_utf8_buffer().size()
	if bytes > max_bytes:
		return {"ok": false, "stage": "chunk", "error": "chunk file exceeds maxChunkBytes"}
	var sha := text.sha256_text()
	var path := path_in(directory, cx, cy)
	var written := _write_atomic(path, text)
	if not written.is_empty():
		return {"ok": false, "stage": "chunk", "error": written}
	var verify := _verify(path, sha)
	if not verify.is_empty():
		return {"ok": false, "stage": "verify", "error": verify}
	return {"ok": true, "path": path, "sha256": sha, "bytes": bytes}


## Reads and validates one chunk file against the index entry. Whole-reject:
## returns {ok:true, cells, revision} or {ok:false, reason, detail}.
func read_chunk(path: String, cx: int, cy: int, expected_sha: String, material_ids: Dictionary) -> Dictionary:
	if not FileAccess.file_exists(path):
		return _reject("missing_chunk", "chunk file %d_%d is indexed but missing" % [cx, cy])
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		return _reject("chunk_corrupt", "chunk file %d_%d could not be read" % [cx, cy])
	if not expected_sha.is_empty() and text.sha256_text() != expected_sha:
		return _reject("chunk_hash_mismatch", "chunk file %d_%d does not match the index hash" % [cx, cy])
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary:
		return _reject("chunk_corrupt", "chunk file %d_%d is not valid JSON" % [cx, cy])
	var data: Dictionary = parsed
	if not data.get("format") is String or String(data.format) != CHUNK_FORMAT:
		return _reject("chunk_corrupt", "chunk file %d_%d has an unsupported format" % [cx, cy])
	if not data.get("worldId") is String or String(data.worldId) != world_id:
		return _reject("chunk_world_mismatch", "chunk file %d_%d belongs to another world" % [cx, cy])
	if _as_int(data.get("stateVersion")) != state_version:
		return _reject("bad_state_version", "chunk file %d_%d has a different state version" % [cx, cy])
	if _as_int(data.get("seed")) != terrain_seed:
		return _reject("chunk_world_mismatch", "chunk file %d_%d has a different seed" % [cx, cy])
	var raw_chunk: Variant = data.get("chunk")
	if not raw_chunk is Array or raw_chunk.size() != 2 or _as_int(raw_chunk[0]) != cx or _as_int(raw_chunk[1]) != cy:
		return _reject("chunk_world_mismatch", "chunk file %d_%d declares another chunk" % [cx, cy])
	var revision: Variant = _as_int(data.get("revision"))
	if revision == null or revision < 0:
		return _reject("chunk_corrupt", "chunk file %d_%d has an invalid revision" % [cx, cy])
	var raw_cells: Variant = data.get("cells")
	if not raw_cells is Array:
		return _reject("chunk_corrupt", "chunk file %d_%d has no cell list" % [cx, cy])
	var x0 := cx * chunk_tiles.x
	var y0 := cy * chunk_tiles.y
	var x1 := mini(x0 + chunk_tiles.x, map_size.x)
	var y1 := mini(y0 + chunk_tiles.y, map_size.y)
	var cells: Array = []
	for entry in raw_cells:
		if not entry is Array or entry.size() != 3:
			return _reject("chunk_corrupt", "chunk file %d_%d has a malformed cell" % [cx, cy])
		var tx: Variant = _as_int(entry[0])
		var ty: Variant = _as_int(entry[1])
		if tx == null or ty == null:
			return _reject("chunk_corrupt", "chunk file %d_%d has a malformed cell" % [cx, cy])
		if int(tx) < x0 or int(tx) >= x1 or int(ty) < y0 or int(ty) >= y1:
			return _reject("chunk_out_of_range", "chunk file %d_%d has a cell outside the chunk" % [cx, cy])
		if not entry[2] is String:
			return _reject("chunk_corrupt", "chunk file %d_%d has a malformed cell material" % [cx, cy])
		var material := String(entry[2])
		if material != AIR and not material_ids.has(material):
			return _reject("chunk_corrupt", "chunk file %d_%d names an undeclared material %s" % [cx, cy, material])
		cells.append([int(tx), int(ty), material])
	if cells.size() > max_cells:
		return _reject("chunk_corrupt", "chunk file %d_%d has too many cells" % [cx, cy])
	return {"ok": true, "cells": cells, "revision": int(revision)}


func _write_atomic(path: String, text: String) -> String:
	var temporary := path + ".tmp"
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		return "chunk file could not be opened for writing: %s" % temporary
	file.store_string(text)
	file.flush()
	var status := file.get_error()
	file.close()
	if status != OK:
		return "chunk file write failed: %s" % temporary
	var renamed := DirAccess.rename_absolute(temporary, path)
	if renamed != OK:
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(path)
		renamed = DirAccess.rename_absolute(temporary, path)
	if renamed != OK:
		return "chunk file could not be committed: %s" % path
	return ""


func _verify(path: String, expected_sha: String) -> String:
	if not FileAccess.file_exists(path):
		return "chunk file vanished after writing: %s" % path
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		return "chunk file could not be re-read: %s" % path
	if text.sha256_text() != expected_sha:
		return "chunk file hash changed after writing: %s" % path
	return ""


func _reject(reason: String, detail: String) -> Dictionary:
	return {"ok": false, "reason": reason, "detail": detail}


static func _as_int(value: Variant) -> Variant:
	if value is int:
		return value
	if value is float and is_finite(value) and float(value) == floorf(float(value)):
		return int(value)
	return null
