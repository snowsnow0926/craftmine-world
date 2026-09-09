## Terrain mutation and observation (SPEC sections 2, 3 and 5).
##
## `set_tile` is the only path that writes a tile; `dig` and `place` are the
## validated front doors that call it. Every rejection reason below is part of the
## frozen contract, and the order of the checks is observable, so it is spelled
## out explicitly.
class_name MiningTerrainService
extends RefCounted

const AIR := "air"

var generator: MiningTerrainGenerator
var state: MiningWorldState
var inventory: MiningInventoryService
var params: MiningParams
var materials: Dictionary = {}
var tile_size: int = 16
var reach_pixels: float = 80.0
var bury_margin: float = 1.0
var adjacency_required: bool = true

## Returns the player's centre in world pixels (feet position + half body up).
var player_center_provider: Callable = Callable()

var _edits: Dictionary = {}       # chunk_id -> {Vector2i: material}
var _revisions: Dictionary = {}   # chunk_id -> int
var _dirty: Dictionary = {}       # chunk_id -> true
var _saved_sha: Dictionary = {}   # chunk_id -> sha256 of the last written file


func setup(generator_value: MiningTerrainGenerator, state_value: MiningWorldState, inventory_value: MiningInventoryService, params_value: MiningParams, material_catalog: Array) -> void:
	generator = generator_value
	state = state_value
	inventory = inventory_value
	params = params_value
	tile_size = params.tile_size()
	reach_pixels = params.reach_pixels()
	bury_margin = params.bury_margin()
	adjacency_required = params.adjacency_required()
	materials.clear()
	for entry in material_catalog:
		if entry is Dictionary and entry.get("id") is String:
			materials[String(entry.id)] = entry


func material_data(material_id: String) -> Dictionary:
	var entry: Variant = materials.get(material_id, {})
	return entry if entry is Dictionary else {}


# -------------------------------------------------------------- observation

func in_bounds(tx: int, ty: int) -> bool:
	return generator != null and generator.in_bounds(tx, ty)


func get_tile(tx: int, ty: int) -> String:
	if not in_bounds(tx, ty):
		return ""
	var chunk_id := generator.chunk_id_of(tx, ty)
	var chunk: Variant = _edits.get(chunk_id, null)
	if chunk is Dictionary and chunk.has(Vector2i(tx, ty)):
		return String(chunk[Vector2i(tx, ty)])
	return generator.generate_cell(tx, ty)


func is_solid(tx: int, ty: int) -> bool:
	var material := get_tile(tx, ty)
	if material.is_empty() or material == AIR:
		return false
	return bool(material_data(material).get("solid", false))


func chunk_revision(cx: int, cy: int) -> int:
	return int(_revisions.get(_chunk_id(cx, cy), 0))


func is_dirty(cx: int, cy: int) -> bool:
	return _dirty.has(_chunk_id(cx, cy))


func saved_sha(cx: int, cy: int) -> String:
	return String(_saved_sha.get(_chunk_id(cx, cy), ""))


func edited_chunk_ids() -> Array:
	var ids: Array = []
	for chunk_id in _edits.keys():
		var chunk: Variant = _edits[chunk_id]
		if chunk is Dictionary and not chunk.is_empty():
			ids.append(chunk_id)
	ids.sort()
	return ids


func edit_count() -> int:
	var total := 0
	for chunk_id in _edits.keys():
		var chunk: Variant = _edits[chunk_id]
		if chunk is Dictionary:
			total += chunk.size()
	return total


## Cells that differ from the generated terrain, sorted ascending by (ty, tx).
func cells_of_chunk(cx: int, cy: int) -> Array:
	var cells: Array = []
	var chunk: Variant = _edits.get(_chunk_id(cx, cy), null)
	if not chunk is Dictionary:
		return cells
	var keys: Array = chunk.keys()
	keys.sort_custom(func(a, b): return a.y < b.y or (a.y == b.y and a.x < b.x))
	for key: Vector2i in keys:
		cells.append([key.x, key.y, String(chunk[key])])
	return cells


func chunk_report(cx: int, cy: int) -> Dictionary:
	var cells := cells_of_chunk(cx, cy)
	var chunk_id := _chunk_id(cx, cy)
	var sha := saved_sha(cx, cy)
	if sha.is_empty():
		sha = JSON.stringify(cells).sha256_text()
	return {
		"ok": true,
		"chunk": chunk_id,
		"cx": cx,
		"cy": cy,
		"edited": not cells.is_empty(),
		"revision": chunk_revision(cx, cy),
		"cells": cells.size(),
		"hash": sha,
	}


## SHA-256 over the *current* terrain (generated terrain plus edits), in the same
## format as the generator fingerprint.
func terrain_hash() -> String:
	var parts := PackedStringArray()
	var width := generator.map_size.x
	var height := generator.map_size.y
	for ty in range(height):
		for tx in range(width):
			parts.append("%d,%d,%s" % [tx, ty, get_tile(tx, ty)])
	return "\n".join(parts).sha256_text()


# ------------------------------------------------------------------ mutation

func dig(tx: int, ty: int, request_id: String) -> Dictionary:
	var rid := _resolve(request_id)
	var prior := _gate(rid)
	if not prior.is_empty():
		return prior
	if not in_bounds(tx, ty):
		return _reject(rid, "dig", "out_of_bounds", tx, ty)
	var material := get_tile(tx, ty)
	var data := material_data(material)
	if material.is_empty() or material == AIR or not bool(data.get("solid", false)):
		return _reject(rid, "dig", "not_solid", tx, ty)
	if not bool(data.get("breakable", false)):
		return _reject(rid, "dig", "unbreakable", tx, ty)
	if inventory.tool_tier() < int(data.get("requiredTier", 0)):
		return _reject(rid, "dig", "tool_tier_too_low", tx, ty)
	if not within_reach(tx, ty):
		return _reject(rid, "dig", "out_of_range", tx, ty)

	var chunk_id := generator.chunk_id_of(tx, ty)
	var revision := _commit(tx, ty, AIR)
	var dropped := {"id": "", "count": 0}
	var drop: Variant = data.get("drop", {})
	if bool(data.get("dropOnDig", true)) and drop is Dictionary and int(drop.get("count", 0)) > 0:
		var drop_id := String(drop.get("id", ""))
		var drop_count := int(drop.get("count", 0))
		if not drop_id.is_empty():
			inventory._apply_grant(drop_id, drop_count)
			dropped = {"id": drop_id, "count": drop_count}
	var result := {
		"ok": true,
		"op": "dig",
		"tx": tx,
		"ty": ty,
		"material": material,
		"dropped": dropped,
		"chunk": chunk_id,
		"revision": revision,
	}
	_record(rid, "dig", result, true)
	return result


func place(tx: int, ty: int, material_id: String, request_id: String) -> Dictionary:
	var rid := _resolve(request_id)
	var prior := _gate(rid)
	if not prior.is_empty():
		return prior
	if not in_bounds(tx, ty):
		return _reject(rid, "place", "out_of_bounds", tx, ty)
	if get_tile(tx, ty) != AIR:
		return _reject(rid, "place", "cell_occupied", tx, ty)
	var data := material_data(material_id)
	if data.is_empty() or not bool(data.get("placeable", false)):
		return _reject(rid, "place", "material_not_placeable", tx, ty)
	var item_id := String(data.get("item", ""))
	var cost := int(data.get("placeCost", 0))
	if cost > 0 and (item_id.is_empty() or inventory.count(item_id) < cost):
		return _reject(rid, "place", "insufficient_materials", tx, ty)
	if not within_reach(tx, ty):
		return _reject(rid, "place", "out_of_range", tx, ty)
	if would_bury_player(tx, ty):
		return _reject(rid, "place", "would_bury_player", tx, ty)
	if adjacency_required and not has_support(tx, ty):
		return _reject(rid, "place", "not_adjacent", tx, ty)

	var chunk_id := generator.chunk_id_of(tx, ty)
	var revision := _commit(tx, ty, material_id)
	if cost > 0:
		inventory._apply_consume(item_id, cost)
	var result := {
		"ok": true,
		"op": "place",
		"tx": tx,
		"ty": ty,
		"material": material_id,
		"consumed": {"id": item_id, "count": cost},
		"chunk": chunk_id,
		"revision": revision,
	}
	_record(rid, "place", result, true)
	return result


## The only tile mutation path in the project. `dig` and `place` validate first
## and then funnel their write through here.
func set_tile(tx: int, ty: int, material_id: String, request_id: String) -> Dictionary:
	var rid := _resolve(request_id)
	var prior := _gate(rid)
	if not prior.is_empty():
		return prior
	if not in_bounds(tx, ty):
		return _reject(rid, "set_tile", "out_of_bounds", tx, ty)
	var previous := get_tile(tx, ty)
	var chunk_id := generator.chunk_id_of(tx, ty)
	var revision := _commit(tx, ty, material_id)
	var result := {
		"ok": true,
		"op": "set_tile",
		"tx": tx,
		"ty": ty,
		"previous": previous,
		"material": material_id,
		"chunk": chunk_id,
		"revision": revision,
	}
	_record(rid, "set_tile", result, true)
	return result


func _commit(tx: int, ty: int, material_id: String) -> int:
	var chunk_id := generator.chunk_id_of(tx, ty)
	var generated := generator.generate_cell(tx, ty)
	if material_id == generated:
		if _edits.has(chunk_id):
			var chunk: Dictionary = _edits[chunk_id]
			chunk.erase(Vector2i(tx, ty))
			if chunk.is_empty():
				_edits.erase(chunk_id)
	else:
		if not _edits.has(chunk_id):
			_edits[chunk_id] = {}
		_edits[chunk_id][Vector2i(tx, ty)] = material_id
	_revisions[chunk_id] = int(_revisions.get(chunk_id, 0)) + 1
	_dirty[chunk_id] = true
	if state != null:
		state.world_revision += 1
	return int(_revisions[chunk_id])


# --------------------------------------------------------------- validation

func within_reach(tx: int, ty: int) -> bool:
	var centre := player_center()
	var target := Vector2(tx * tile_size + tile_size * 0.5, ty * tile_size + tile_size * 0.5)
	return centre.distance_to(target) <= reach_pixels


## A placement must not land on the tile the player occupies. The player body is
## 12x26 px, so a full AABB test would also reject a tile that only clips the top
## of the head; the contract's acceptance drives this from the player's occupied
## tile, which is what `bury_margin` widens.
func would_bury_player(tx: int, ty: int) -> bool:
	var centre := player_center()
	var margin := bury_margin
	var rect := Rect2(
		tx * tile_size - margin,
		ty * tile_size - margin,
		tile_size + margin * 2.0,
		tile_size + margin * 2.0,
	)
	return rect.has_point(centre)


func has_support(tx: int, ty: int) -> bool:
	if ty >= generator.map_size.y - 1:
		return true
	for offset in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		if is_solid(tx + offset.x, ty + offset.y):
			return true
	return false


func player_center() -> Vector2:
	if player_center_provider.is_valid():
		return player_center_provider.call()
	if state != null:
		var position := state.player_position()
		return position + Vector2(0.0, -params.body_height() * 0.5)
	return Vector2.ZERO


# -------------------------------------------------------- persistence hooks

func apply_chunk(cx: int, cy: int, cells: Array, revision: int) -> void:
	var chunk_id := _chunk_id(cx, cy)
	var chunk: Dictionary = {}
	for entry in cells:
		if entry is Array and entry.size() == 3:
			chunk[Vector2i(int(entry[0]), int(entry[1]))] = String(entry[2])
	if chunk.is_empty():
		_edits.erase(chunk_id)
	else:
		_edits[chunk_id] = chunk
	_revisions[chunk_id] = maxi(0, revision)
	_dirty[chunk_id] = false


func mark_clean(hashes: Dictionary) -> void:
	for chunk_id in hashes.keys():
		_dirty.erase(chunk_id)
		_saved_sha[chunk_id] = String(hashes[chunk_id])


func clear_edits() -> void:
	_edits.clear()
	_revisions.clear()
	_dirty.clear()
	_saved_sha.clear()
	if state != null:
		state.chunk_index.clear()
		state.edit_count = 0
		state.terrain_hash = ""


func _chunk_id(cx: int, cy: int) -> String:
	return "%d_%d" % [cx, cy]


# ------------------------------------------------------------------- ledger

func _resolve(request_id: String) -> String:
	return String(request_id)


func _gate(rid: String) -> Dictionary:
	if rid.is_empty() or state == null:
		return {}
	var entry := state.ledger_lookup(rid)
	if entry.is_empty():
		return {}
	if String(entry.get("op", "")) == "cancel":
		return {"ok": false, "reason": "cancelled_request", "duplicate": true, "requestId": rid}
	var recorded: Variant = entry.get("result", {})
	var out: Dictionary = recorded.duplicate(true) if recorded is Dictionary else {}
	out["duplicate"] = true
	out["requestId"] = rid
	return out


func _record(rid: String, op: String, result: Dictionary, applied: bool) -> void:
	if rid.is_empty() or state == null:
		return
	state.ledger_record(rid, op, result, applied, params.ledger_limit())


func _reject(rid: String, op: String, reason: String, tx: int, ty: int) -> Dictionary:
	var out: Dictionary = {"ok": false, "op": op, "reason": reason, "tx": tx, "ty": ty}
	if not rid.is_empty():
		out["requestId"] = rid
		_record(rid, op, out.duplicate(true), false)
	return out
