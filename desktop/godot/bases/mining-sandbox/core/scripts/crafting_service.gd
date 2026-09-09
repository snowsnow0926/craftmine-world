## Crafting (SPEC section 4).
##
## A craft is atomic: every input is checked before anything is consumed, and the
## shared request ledger makes a replay a no-op. The station distance uses the
## same reach as digging and placing, measured from the player's centre to the
## declared station tile.
class_name MiningCraftingService
extends RefCounted

var state: MiningWorldState
var inventory: MiningInventoryService
var params: MiningParams
var recipes: Dictionary = {}
var recipe_order: Array = []

## Callables supplied by the game: station lookup and the player's centre.
var entity_provider: Callable = Callable()
var player_center_provider: Callable = Callable()


func setup(state_value: MiningWorldState, inventory_value: MiningInventoryService, params_value: MiningParams, recipe_catalog: Array) -> void:
	state = state_value
	inventory = inventory_value
	params = params_value
	recipes.clear()
	recipe_order.clear()
	for entry in recipe_catalog:
		if entry is Dictionary and entry.get("id") is String:
			var recipe_id := String(entry.id)
			recipes[recipe_id] = entry
			if not recipe_order.has(recipe_id):
				recipe_order.append(recipe_id)


func craft(recipe_id: String, request_id: String, station_id: String) -> Dictionary:
	var rid := String(request_id)
	var prior := _gate(rid)
	if not prior.is_empty():
		return prior
	var recipe: Variant = recipes.get(recipe_id, null)
	if not recipe is Dictionary:
		return _reject(rid, "unknown_recipe", {"recipeId": recipe_id})
	var declared_station := String(recipe.get("station", ""))
	var required_station := declared_station
	if required_station.is_empty() and not String(station_id).is_empty():
		required_station = String(station_id)
	if not required_station.is_empty():
		var station: Node = entity_provider.call(required_station) if entity_provider.is_valid() else null
		if station == null:
			return _reject(rid, "missing_station", {"recipeId": recipe_id, "station": required_station})
		if not _within_station_reach(station):
			return _reject(rid, "out_of_range", {"recipeId": recipe_id, "station": required_station})
	var inputs: Array = recipe.get("inputs", []) if recipe.get("inputs") is Array else []
	var consumed: Array = []
	for entry in inputs:
		if not entry is Dictionary:
			return _reject(rid, "unknown_recipe", {"recipeId": recipe_id})
		var item_id := String(entry.get("id", ""))
		var needed := int(entry.get("count", 0))
		if item_id.is_empty() or needed <= 0:
			return _reject(rid, "unknown_recipe", {"recipeId": recipe_id})
		if inventory.count(item_id) < needed:
			return _reject(rid, "insufficient_materials", {"recipeId": recipe_id, "itemId": item_id, "required": needed, "held": inventory.count(item_id)})
		consumed.append({"id": item_id, "count": needed})
	# All inputs present: consume atomically, then grant the output once.
	for entry in consumed:
		inventory._apply_consume(String(entry.id), int(entry.count))
	var output: Variant = recipe.get("output", {})
	var output_id := ""
	var output_count := 0
	if output is Dictionary:
		output_id = String(output.get("id", ""))
		output_count = int(output.get("count", 0))
	if not output_id.is_empty() and output_count > 0:
		inventory._apply_grant(output_id, output_count)
	var result := {
		"ok": true,
		"op": "craft",
		"recipeId": recipe_id,
		"station": required_station,
		"consumed": consumed,
		"output": {"id": output_id, "count": output_count},
	}
	_record(rid, result)
	return result


func _within_station_reach(station: Node) -> bool:
	if not player_center_provider.is_valid():
		return false
	var tile: Variant = station.get("tile")
	if not tile is Vector2i:
		return false
	var tile_size := params.tile_size()
	var target := Vector2(float(tile.x * tile_size) + tile_size * 0.5, float(tile.y * tile_size) + tile_size * 0.5)
	return player_center_provider.call().distance_to(target) <= params.reach_pixels()


# ------------------------------------------------------------------- ledger

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


func _record(rid: String, result: Dictionary) -> void:
	if rid.is_empty() or state == null:
		return
	state.ledger_record(rid, "craft", result, true, params.ledger_limit())


func _reject(rid: String, reason: String, extra: Dictionary = {}) -> Dictionary:
	var out: Dictionary = {"ok": false, "op": "craft", "reason": reason}
	for key in extra.keys():
		out[key] = extra[key]
	if not rid.is_empty():
		out["requestId"] = rid
		_record(rid, out.duplicate(true))
	return out
