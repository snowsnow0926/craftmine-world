## Headless probe interface (SPEC section 7).
##
## Enabled only with `-- --probe --probe-request=<file> --probe-response=<file>`.
## It never injects OS input, never creates a window and never requests pointer
## lock. Every op calls the same method gameplay uses; the probe cannot write a
## result directly and cannot bypass a geometric or economic guard.
##
## Request:  {"format": "...probe/1", "commands": [{"op": ..., "args": {...}}]}
## Response: {"format": "...probe/1", "ok": bool, "results": [...],
##            "finalSnapshot": {...}, "save": {...}}
## Exit code: 0 ran and wrote the response, 64 missing args, 65 unreadable
## request, 66 response not written.
class_name MiningProbe
extends RefCounted

const KEY_OK := "ok"


static func run(game: Node) -> void:
	var args := OS.get_cmdline_user_args()
	var request_path := _arg_value(args, "--probe-request=")
	var response_path := _arg_value(args, "--probe-response=")
	if request_path.is_empty() or response_path.is_empty():
		push_error("Probe requires --probe-request=<file> and --probe-response=<file>")
		game.get_tree().quit(64)
		return
	var request: Variant = _read_json(request_path)
	if not request is Dictionary:
		_write_json(response_path, {
			"format": MiningBaseContract.PROBE_FORMAT,
			"ok": false,
			"error": "Probe request could not be read",
		})
		game.get_tree().quit(65)
		return
	var request_data: Dictionary = request

	# Boot may restore progress before the world is fully bound. Observe the
	# final state, never a transient one.
	for _frame in range(300):
		await game.get_tree().process_frame
		if game.scene_root() != null or not game.boot_error.is_empty():
			break
	await game.get_tree().physics_frame

	var results: Array = []
	var ok := true
	for command in request_data.get("commands", []):
		if not command is Dictionary:
			continue
		var op := String(command.get("op", ""))
		var op_args: Dictionary = command.get("args", {}) if command.get("args") is Dictionary else {}
		var outcome: Dictionary = await _dispatch(game, op, op_args)
		results.append({"op": op, "args": op_args, "result": outcome})
		if not bool(outcome.get(KEY_OK, false)):
			ok = false
			if bool(command.get("stopOnError", false)):
				break

	var response := {
		"format": MiningBaseContract.PROBE_FORMAT,
		"ok": ok,
		"baseId": MiningBaseContract.BASE_ID,
		"baseVersion": MiningBaseContract.BASE_VERSION,
		"worldId": game.state.world_id,
		"results": results,
		"finalSnapshot": game.snapshot(),
	}
	# The probe mirrors the game's autosave-on-exit behaviour so a restart test
	# observes exactly what a player would. `saveOnExit: false` skips the
	# explicit save; the world's own autosaveOnExit still runs on process exit.
	if bool(request_data.get("saveOnExit", true)):
		response["save"] = game.save()
	var written := _write_json(response_path, response)
	game.get_tree().quit(0 if written else 66)


static func _dispatch(game: Node, op: String, args: Dictionary) -> Dictionary:
	match op:
		"snapshot":
			var snap: Dictionary = game.snapshot()
			snap[KEY_OK] = true
			return snap
		"wait":
			var frames := maxi(1, int(args.get("frames", 1)))
			for _index in range(frames):
				await game.get_tree().physics_frame
			return _ok({"frames": frames})
		"move":
			return await _move(game, args)
		"set-position":
			return await _set_position(game, args)
		"tile":
			return _tile(game, args)
		"dig":
			return game.terrain.dig(int(args.get("tx", 0)), int(args.get("ty", 0)), game.request_id(String(args.get("requestId", ""))))
		"place":
			return game.terrain.place(int(args.get("tx", 0)), int(args.get("ty", 0)), String(args.get("materialId", "")), game.request_id(String(args.get("requestId", ""))))
		"craft":
			return game.crafting.craft(String(args.get("recipeId", "")), game.request_id(String(args.get("requestId", ""))), String(args.get("stationId", "")))
		"cancel":
			return game.inventory.cancel(String(args.get("requestId", "")))
		"inventory":
			return game.inventory.report()
		"chunk":
			return game.terrain.chunk_report(int(args.get("cx", 0)), int(args.get("cy", 0)))
		"hash":
			return _ok({"hash": game.terrain.terrain_hash()})
		"save":
			var saved: Dictionary = game.save()
			saved["snapshot"] = game.snapshot()
			return saved
		"restore":
			var restored: Dictionary = game.restore()
			restored["snapshot"] = game.snapshot()
			return restored
		"reset-to-initial":
			return game.reset_to_initial()
		"capture-managed":
			var managed: Dictionary = game.capture_managed()
			if managed.has("error"):
				return {
					"ok": false,
					"reason": String(managed.error),
					"detail": String(managed.error),
					"bytes": int(managed.get("bytes", 0)),
				}
			var envelope: Dictionary = managed.duplicate(true)
			envelope[KEY_OK] = true
			return envelope
		"restore-managed":
			var body: Variant = args.get("body", {})
			if not body is Dictionary:
				return {"ok": false, "reason": "bad_state", "detail": "Managed body is not an object"}
			return game.restore_managed(body)
		"quit":
			return _ok()
	return {"ok": false, "reason": "unsupported_op", "op": op}


static func _move(game: Node, args: Dictionary) -> Dictionary:
	var actor: Node = game.player_node()
	if actor == null:
		return {"ok": false, "reason": "no_player"}
	var direction := Vector2(float(args.get("dx", 0.0)), float(args.get("dy", 0.0)))
	var steps := maxi(1, int(args.get("steps", 1)))
	var before: Vector2 = actor.position
	actor.scripted_mode = true
	actor.scripted_input = direction
	for _index in range(steps):
		await game.get_tree().physics_frame
	actor.scripted_input = Vector2.ZERO
	await game.get_tree().physics_frame
	# Hand control back so a later human-input path in the same process is not
	# silently locked out by a previous probe move.
	actor.scripted_mode = false
	var after: Vector2 = actor.position
	return _ok({
		"before": [before.x, before.y],
		"after": [after.x, after.y],
		"distance": before.distance_to(after),
		"blocked": before.distance_to(after) <= 0.01,
		"facing": actor.facing_name(),
		"steps": steps,
	})


## Setup helper for acceptance scenarios: place the player next to a target. It is
## a teleport, so no gameplay rule may depend on it; every action still re-checks
## the real geometry afterwards.
static func _set_position(game: Node, args: Dictionary) -> Dictionary:
	var actor: Node = game.player_node()
	if actor == null:
		return {"ok": false, "reason": "no_player"}
	actor.place_at(Vector2(float(args.get("x", 0.0)), float(args.get("y", 0.0))), -1 if String(args.get("facing", "")) == "left" else 1)
	if args.get("facing") is String and not String(args.facing).is_empty():
		actor.set_facing(String(args.facing))
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	game.tick(game.scene_root())
	var snapshot: Dictionary = game.snapshot()
	return _ok({
		"position": [actor.position.x, actor.position.y],
		"facing": actor.facing_name(),
		"overlaps": snapshot.physical.overlaps,
	})


static func _tile(game: Node, args: Dictionary) -> Dictionary:
	var tx := int(args.get("tx", 0))
	var ty := int(args.get("ty", 0))
	var material: String = game.terrain.get_tile(tx, ty)
	if material.is_empty():
		return {"ok": false, "reason": "out_of_bounds", "tx": tx, "ty": ty}
	var data: Dictionary = game.terrain.material_data(material)
	return _ok({
		"tx": tx,
		"ty": ty,
		"material": material,
		"solid": bool(data.get("solid", false)),
		"breakable": bool(data.get("breakable", false)),
		"requiredTier": int(data.get("requiredTier", 0)),
		"chunk": game.generator.chunk_id_of(tx, ty),
	})


static func _ok(payload: Dictionary = {}) -> Dictionary:
	payload[KEY_OK] = true
	return payload


static func _arg_value(args: PackedStringArray, prefix: String) -> String:
	for entry in args:
		if entry.begins_with(prefix):
			return entry.substr(prefix.length())
	return ""


static func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return null
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	return parsed


static func _write_json(path: String, payload: Dictionary) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(payload, "  "))
	var status := file.get_error()
	file.close()
	return status == OK
