## Managed adapter for the mining-sandbox base.
##
## Copied by shared/materialize.mjs to res://craftmine_shared/base_adapter.gd.
## It exposes exactly the operations declared in shared/observation.mjs
## (BOUNDED_OPERATIONS['mining-sandbox']) and nothing else: there is no teleport,
## no state setter and no progress restore path a host could use to write an
## arbitrary state. Digging, placing and crafting go through the game's real
## validation (reach, target, occupancy, adjacency, tool tier, inventory).
extends RefCounted

const BASE_ID := "mining-sandbox"
const BASE_VERSION := "1.0.0"
const Guard = preload("res://craftmine_shared/state_guard.gd")

## Kept in sync with observation.mjs; the shared observation test compares them.
const ALLOWED_OPERATIONS := ["cancel", "chunk", "craft", "dig", "hash", "inventory", "move", "place", "tile", "wait"]

const MAX_STEPS := 600
const MAX_ID_LENGTH := 128
const MAX_NAME_LENGTH := 64


func runtime() -> Node:
	var loop := Engine.get_main_loop()
	if loop == null or loop.root == null:
		return null
	return loop.root.get_node_or_null("Main")


func is_ready() -> bool:
	var game := runtime()
	if game == null:
		return false
	if not game.has_method("capture_managed") or not game.has_method("snapshot"):
		return false
	return String(game.get("boot_error")) == ""


func bind_world(id: String) -> String:
	var game := runtime()
	if game == null:
		return "Mining sandbox is not loaded"
	if not game.has_method("bind_world"):
		return "Mining sandbox does not expose bind_world"
	return String(game.bind_world(id))


## The native body for `craftmine.godot-progress/1`. It carries the chunk edits,
## so a managed receipt cannot lose terrain. An oversized body is reported as an
## error instead of being truncated.
func capture() -> Dictionary:
	var game := runtime()
	if game == null:
		return {"error": "Mining sandbox is not loaded"}
	var body: Variant = game.capture_managed()
	if not body is Dictionary:
		return {"error": "Mining sandbox capture failed"}
	return body


## Whole-reject restore of a managed body. The game validates every field, every
## chunk id and every cell before it applies anything.
func restore(body: Dictionary) -> String:
	var game := runtime()
	if game == null:
		return "Mining sandbox is not loaded"
	if not game.has_method("restore_managed"):
		return "Mining sandbox does not expose restore_managed"
	var outcome: Variant = game.restore_managed(body)
	if not outcome is Dictionary:
		return "Mining sandbox restore returned an unexpected value"
	if not bool(outcome.get("ok", false)):
		return String(outcome.get("error", outcome.get("reason", "Mining sandbox restore was rejected")))
	# Nothing the host sent may be silently dropped by the native restore.
	var after: Variant = game.capture_managed()
	if not after is Dictionary or after.has("error"):
		return "Mining sandbox could not re-read its state after restore"
	var dropped := Guard.omitted(body, after)
	if dropped != "":
		return "Unsupported native state field: " + dropped
	return ""


## Read-only, identity-carrying sample for the model tooling. Every entity is
## reported with its stable id; nothing here can change the world.
func observe() -> Dictionary:
	var game := runtime()
	if game == null:
		return {"error": "Mining sandbox is not loaded"}
	var snapshot: Dictionary = game.snapshot()
	var stations: Array = []
	if game.has_method("find_entity"):
		for entity_id in game.world.get("entities", []):
			if entity_id is Dictionary and entity_id.get("id") is String:
				var node: Node = game.find_entity(String(entity_id.id))
				stations.append({
					"id": String(entity_id.id),
					"type": String(entity_id.get("type", "")),
					"tile": [int(node.get("tile").x), int(node.get("tile").y)] if node != null and node.get("tile") is Vector2i else entity_id.get("tile", []),
					"recipes": entity_id.get("recipes", []),
					"present": node != null,
				})
	var chunk_ids: Array = snapshot.get("chunks", {}).keys()
	chunk_ids.sort()
	return {
		"worldId": snapshot.get("worldId", ""),
		"baseId": BASE_ID,
		"baseVersion": BASE_VERSION,
		"player": snapshot.get("player", {}),
		"inventory": snapshot.get("inventory", {}),
		"tools": snapshot.get("tools", []),
		"equipped": snapshot.get("player", {}).get("equipped", ""),
		"toolTier": snapshot.get("player", {}).get("toolTier", 0),
		"stations": stations,
		"chunks": chunk_ids,
		"editCount": snapshot.get("editCount", 0),
		"terrainHash": snapshot.get("terrainHash", ""),
		"worldRevision": snapshot.get("worldRevision", 0),
		"cursor": snapshot.get("cursor", []),
		"lastAction": snapshot.get("lastAction", {}),
		"bootError": snapshot.get("bootError", ""),
	}


func command(op: String, args: Dictionary) -> Dictionary:
	var game := runtime()
	if game == null:
		return {"error": "Mining sandbox is not loaded"}
	if not ALLOWED_OPERATIONS.has(op):
		return {"error": "Unsupported mining-sandbox operation: %s" % op}
	match op:
		"dig":
			var dig_problem := _tile_args(args)
			if dig_problem != "":
				return {"error": dig_problem}
			var dig_request: Variant = _request_id(args)
			if dig_request is String:
				return {"error": dig_request}
			return {"result": game.dig(int(args.get("tx", 0)), int(args.get("ty", 0)), String(args.get("requestId", "")))}
		"place":
			var place_problem := _tile_args(args)
			if place_problem != "":
				return {"error": place_problem}
			if not _is_name(args.get("materialId")):
				return {"error": "place requires a materialId of at most 64 characters"}
			var place_request: Variant = _request_id(args)
			if place_request is String:
				return {"error": place_request}
			return {"result": game.place(int(args.get("tx", 0)), int(args.get("ty", 0)), String(args.get("materialId", "")), String(args.get("requestId", "")))}
		"craft":
			if not _is_name(args.get("recipeId")):
				return {"error": "craft requires a recipeId of at most 64 characters"}
			if args.has("stationId") and not _is_name(args.get("stationId")):
				return {"error": "craft stationId must be at most 64 characters"}
			var craft_request: Variant = _request_id(args)
			if craft_request is String:
				return {"error": craft_request}
			return {"result": game.craft(String(args.get("recipeId", "")), String(args.get("requestId", "")), String(args.get("stationId", "")))}
		"cancel":
			var cancel_request: Variant = _request_id(args, true)
			if cancel_request is String:
				return {"error": cancel_request}
			return {"result": game.inventory.cancel(String(args.get("requestId", "")))}
		"tile":
			var tile_problem := _tile_args(args)
			if tile_problem != "":
				return {"error": tile_problem}
			return {"result": game.tile_at(int(args.get("tx", 0)), int(args.get("ty", 0)))}
		"chunk":
			for key in ["cx", "cy"]:
				if not _is_int(args.get(key)):
					return {"error": "chunk requires integer cx and cy"}
			var coords := Vector2i(int(args.get("cx", 0)), int(args.get("cy", 0)))
			return {"result": game.terrain.chunk_report(coords.x, coords.y)}
		"inventory":
			return {"result": game.inventory_report()}
		"hash":
			return {"result": {"hash": game.terrain_hash()}}
		"move":
			return await _move(game, args)
		"wait":
			var frames: Variant = args.get("frames", 1)
			if not _is_int(frames) or int(frames) < 1 or int(frames) > MAX_STEPS:
				return {"error": "wait frames must be an integer between 1 and 600"}
			for _index in range(int(frames)):
				await game.get_tree().physics_frame
			return {"result": {"frames": int(frames), "after": observe()}}
	return {"error": "Unsupported mining-sandbox operation: %s" % op}


## Bounded scripted movement through the player's own input path; the player still
## collides with the real terrain and cannot be teleported by a host.
func _move(game: Node, args: Dictionary) -> Dictionary:
	var actor: Node = game.player_node()
	if actor == null:
		return {"error": "Mining sandbox has no player"}
	for key in ["dx", "dy"]:
		var value: Variant = args.get(key, 0.0)
		if not (value is int or value is float) or not is_finite(float(value)) or absf(float(value)) > 1.0:
			return {"error": "move axes must be finite and within -1 to 1"}
	var steps: Variant = args.get("steps", 1)
	if not _is_int(steps) or int(steps) < 1 or int(steps) > MAX_STEPS:
		return {"error": "move steps must be an integer between 1 and 600"}
	var direction := Vector2(float(args.get("dx", 0.0)), float(args.get("dy", 0.0)))
	var before: Vector2 = actor.position
	actor.scripted_mode = true
	actor.scripted_input = direction
	for _index in range(int(steps)):
		await game.get_tree().physics_frame
	actor.scripted_input = Vector2.ZERO
	await game.get_tree().physics_frame
	actor.scripted_mode = false
	return {
		"result": {
			"before": [before.x, before.y],
			"after": [actor.position.x, actor.position.y],
			"distance": before.distance_to(actor.position),
			"steps": int(steps),
			"after-state": observe(),
		},
	}


func _tile_args(args: Dictionary) -> String:
	if not _is_int(args.get("tx")) or not _is_int(args.get("ty")):
		return "operation requires integer tx and ty"
	return ""


func _request_id(args: Dictionary, required: bool = false) -> Variant:
	var value: Variant = args.get("requestId", "")
	if value == null:
		value = ""
	if not value is String:
		return "requestId must be a string"
	var text := String(value)
	if text.length() > MAX_ID_LENGTH:
		return "requestId must be at most 128 characters"
	if required and text.is_empty():
		return "cancel requires a requestId"
	return true if not required or not text.is_empty() else "cancel requires a requestId"


func _is_name(value: Variant) -> bool:
	return value is String and not String(value).is_empty() and String(value).length() <= MAX_NAME_LENGTH


func _is_int(value: Variant) -> bool:
	if value is int:
		return true
	return value is float and is_finite(value) and float(value) == floorf(float(value))
