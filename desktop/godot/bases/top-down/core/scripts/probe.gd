# Headless probe interface (the "internal test interface" of the plan).
#
# Enabled only when the process is started with `-- --probe` plus
# `--probe-request=<file>` and `--probe-response=<file>`. It drives the same
# objects the game uses; it never injects OS mouse or keyboard input, and it
# cannot bypass the geometric or economic guards because every operation calls the
# real method (`Shop.buy`, `QuestManager.deliver`, `GatherZone.gather`).
#
# Request:  {"format": "craftmine.godot-topdown-probe/1", "commands": [{"op":..., "args":{...}}]}
# Response: {"format": ..., "ok": bool, "results": [...], "finalSnapshot": {...}}
class_name Probe
extends RefCounted


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
			"format": BaseContract.PROBE_FORMAT,
			"ok": false,
			"error": "Probe request could not be read",
		})
		game.get_tree().quit(65)
		return

	# Boot may route from the entry scene to a different saved room. Observe only
	# the final bound scene, never a transient entry scene that will be discarded.
	for _frame in range(300):
		await game.get_tree().process_frame
		if game.scene_root() != null or not game.boot_error.is_empty():
			break
	await game.get_tree().physics_frame

	var results: Array = []
	var ok := true
	for command in request.get("commands", []):
		if not command is Dictionary:
			continue
		var op := String(command.get("op", ""))
		var op_args: Dictionary = command.get("args", {}) if command.get("args") is Dictionary else {}
		var outcome: Dictionary = await _dispatch(game, op, op_args)
		results.append({"op": op, "args": op_args, "result": outcome})
		if not bool(outcome.get("ok", false)):
			ok = false
			if bool(command.get("stopOnError", false)):
				break

	var response := {
		"format": BaseContract.PROBE_FORMAT,
		"ok": ok,
		"baseId": BaseContract.BASE_ID,
		"baseVersion": BaseContract.BASE_VERSION,
		"worldId": game.state.world_id,
		"results": results,
		"finalSnapshot": game.snapshot(),
	}
	# The probe mirrors the game's autosave-on-exit behaviour so a restart test
	# observes exactly what a player would. Set "saveOnExit": false to inspect a
	# run that deliberately ends without saving.
	if bool(request.get("saveOnExit", true)):
		response["save"] = game.save()
	var written := _write_json(response_path, response)
	# The process exits 0 once the probe ran and the response was written; whether
	# the *gameplay* assertions passed is decided by the acceptance runner from
	# the response file, so expected rejections are not process failures.
	game.get_tree().quit(0 if written else 66)


static func _dispatch(game: Node, op: String, args: Dictionary) -> Dictionary:
	match op:
		"snapshot":
			return {"ok": true, "snapshot": game.snapshot()}
		"wait":
			var frames := maxi(1, int(args.get("frames", 1)))
			for index in range(frames):
				await game.get_tree().physics_frame
			return {"ok": true, "frames": frames}
		"move":
			return await _move(game, args)
		"move-capture":
			return await _move_capture(game, args)
		"set-position":
			return await _set_position(game, args)
		"buy":
			return _buy(game, args)
		"deliver":
			return _deliver(game, args)
		"talk":
			return _talk(game, args)
		"gather":
			return _gather(game, args)
		"interact":
			return _interact(game, args)
		"focus":
			var actor: Node = game.player()
			var focus: Node = actor.focus_interactable() if actor != null else null
			return {"ok": true, "focus": _entity_id_of(focus)}
		"change-scene":
			return await _change_scene(game, args)
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
		"quit":
			return {"ok": true}
	return {"ok": false, "reason": "unsupported_op", "op": op}


static func _move(game: Node, args: Dictionary) -> Dictionary:
	var actor: Node = game.player()
	if actor == null:
		return {"ok": false, "reason": "no_player"}
	var direction := Vector2(float(args.get("dx", 0.0)), float(args.get("dy", 0.0)))
	var steps := maxi(1, int(args.get("steps", 1)))
	var before: Vector2 = actor.global_position
	actor.scripted_mode = true
	actor.scripted_input = direction
	for index in range(steps):
		await game.get_tree().physics_frame
		if not is_instance_valid(actor) or not actor.is_inside_tree():
			break
	if is_instance_valid(actor):
		actor.scripted_input = Vector2.ZERO
	await game.get_tree().process_frame
	await game.get_tree().physics_frame
	var current: Node = game.player()
	if current == null:
		return {"ok": false, "reason": "scene_not_bound"}
	var after: Vector2 = current.global_position
	return {
		"ok": true,
		"before": [before.x, before.y],
		"after": [after.x, after.y],
		"distance": before.distance_to(after),
		"blocked": before.distance_to(after) <= 0.01,
		"facing": current.facing,
		"sceneId": game.scene_id(),
		"steps": steps,
	}


# Walks while sampling the sprite frame, so the walk cycle itself can be checked
# instead of only the resting frame after a move.
static func _move_capture(game: Node, args: Dictionary) -> Dictionary:
	var actor: Node = game.player()
	if actor == null:
		return {"ok": false, "reason": "no_player"}
	var direction := Vector2(float(args.get("dx", 0.0)), float(args.get("dy", 0.0)))
	var steps := maxi(1, int(args.get("steps", 1)))
	var sprite: Node = actor.get_node_or_null("Sprite")
	var frames: Array = []
	actor.scripted_mode = true
	actor.scripted_input = direction
	for index in range(steps):
		await game.get_tree().physics_frame
		if sprite != null:
			frames.append(int(sprite.get("frame")))
	actor.scripted_input = Vector2.ZERO
	await game.get_tree().physics_frame
	var distinct: Dictionary = {}
	for frame in frames:
		distinct[frame] = true
	return {
		"ok": true,
		"frames": frames,
		"distinctFrames": distinct.size(),
		"facing": actor.facing,
		"steps": steps,
	}


# Setup helper for acceptance scenarios: place the player next to a target.
# It is a teleport, so no gameplay rule may depend on it; every action still
# re-checks the real overlap afterwards.
static func _set_position(game: Node, args: Dictionary) -> Dictionary:
	var actor: Node = game.player()
	if actor == null:
		return {"ok": false, "reason": "no_player"}
	actor.global_position = Vector2(float(args.get("x", 0.0)), float(args.get("y", 0.0)))
	if args.get("facing") is String:
		actor.set_facing(String(args.facing))
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	game.tick(game.scene_root())
	return {
		"ok": true,
		"position": [actor.global_position.x, actor.global_position.y],
		"facing": actor.facing,
		"overlaps": game.snapshot().physical.overlaps,
	}


static func _buy(game: Node, args: Dictionary) -> Dictionary:
	var shop: Node = game.find_entity(String(args.get("shopId", "")))
	if shop == null or not shop.has_method("buy"):
		return {"ok": false, "reason": "unknown_shop"}
	var outcome: Dictionary = shop.buy(String(args.get("itemId", "")), game.player())
	outcome["snapshot"] = game.snapshot()
	return outcome


static func _deliver(game: Node, args: Dictionary) -> Dictionary:
	var giver: Node = game.find_entity(String(args.get("npcId", "")))
	if giver == null or not giver.has_method("talk"):
		return {"ok": false, "reason": "unknown_npc"}
	var quest_id := String(args.get("questId", ""))
	if quest_id.is_empty() and giver.get("quest_id") is String:
		quest_id = String(giver.get("quest_id"))
	var outcome: Dictionary = QuestManager.deliver(quest_id, giver, game.player())
	outcome["snapshot"] = game.snapshot()
	return outcome


static func _talk(game: Node, args: Dictionary) -> Dictionary:
	var npc: Node = game.find_entity(String(args.get("npcId", "")))
	if npc == null or not npc.has_method("talk"):
		return {"ok": false, "reason": "unknown_npc"}
	var outcome: Dictionary = npc.talk(game.player())
	outcome["snapshot"] = game.snapshot()
	return outcome


static func _gather(game: Node, args: Dictionary) -> Dictionary:
	var zone: Node = game.find_entity(String(args.get("zoneId", "")))
	if zone == null or not zone.has_method("gather"):
		return {"ok": false, "reason": "unknown_zone"}
	var outcome: Dictionary = zone.gather(game.player())
	outcome["snapshot"] = game.snapshot()
	return outcome


static func _interact(game: Node, args: Dictionary) -> Dictionary:
	var target: Node = game.find_entity(String(args.get("entityId", "")))
	if target == null or not target.has_method("interact"):
		return {"ok": false, "reason": "unknown_interactable"}
	var outcome: Dictionary = target.interact(game.player())
	outcome["snapshot"] = game.snapshot()
	return outcome


static func _change_scene(game: Node, args: Dictionary) -> Dictionary:
	var previous: Node = game.scene_root()
	var previous_id: int = previous.get_instance_id() if previous != null else 0
	var outcome: Dictionary = game.change_scene(String(args.get("scene", "")), String(args.get("spawn", "")))
	if not bool(outcome.get("ok", false)):
		return outcome
	var bound := false
	for index in range(900):
		await game.get_tree().process_frame
		var current: Node = game.scene_root()
		if current != null and current.get_instance_id() != previous_id:
			bound = true
			break
	if not bound:
		return {"ok": false, "reason": "scene_not_bound", "scenePath": outcome.scenePath}
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	outcome["sceneId"] = game.scene_id()
	outcome["snapshot"] = game.snapshot()
	return outcome


static func _entity_id_of(node: Node) -> String:
	if node == null or node.get_script() == null:
		return ""
	var value: Variant = node.get("entity_id")
	return String(value) if value is String else ""


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
