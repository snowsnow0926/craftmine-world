class_name BaseOps
extends RefCounted

## Operation set of the first-person base, expressed once and shared by both
## run adapters: the Web preview bridge and the headless probe runner.
##
## Every operation drives real nodes. There is no shortcut that writes expected
## results directly into state, so a passing check means the runtime actually
## moved, collided, consumed ammunition, damaged a target or wrote a file.

var world: BaseWorld


func _init(target: BaseWorld) -> void:
	world = target


func execute(op: String, args: Dictionary = {}) -> Dictionary:
	match op:
		"snapshot":
			return {"result": world.snapshot()}
		"damage-player":
			if world.player == null or not _is_finite_number(args.get("amount", 0.0)):
				return {"error": "Invalid player damage"}
			var applied := world.player.take_damage(float(args.amount))
			return {"result": {"applied": applied, "dead": world.player.dead, "snapshot": world.snapshot()}}
		"revive-player":
			if world.player == null:
				return {"error": "No player"}
			world.player.revive()
			return {"result": world.snapshot()}
		"respawn-target":
			var wanted := str(args.get("id", ""))
			for node in world.get_tree().get_nodes_in_group("base_targets"):
				if node.has_method("respawn") and String(node.state_id()) == wanted:
					return {"result": {"respawned": node.respawn(), "snapshot": world.snapshot()}}
			return {"error": "Target cannot respawn"}
		"equip":
			return await _equip(args)
		"next-equipment":
			if world.equipment_state == null:
				return {"error": "No equipment state"}
			world.equipment_state.equip_next()
			return {"result": world.snapshot()}
		"look":
			return await _look(args)
		"attack", "fire":
			if world.attack_dispatcher == null:
				return {"error": "No attack dispatcher"}
			var attack: Dictionary = await world.attack_dispatcher.try_attack()
			attack["snapshot"] = world.snapshot()
			return {"result": attack}
		"reload":
			if world.equipment_state == null:
				return {"error": "No equipment state"}
			var requested: bool = world.equipment_state.request_reload()
			await world.get_tree().physics_frame
			return {"result": {"reloaded": requested, "snapshot": world.snapshot()}}
		"interact":
			if world.aim_query == null:
				return {"error": "No aim query"}
			var interaction: Dictionary = world.aim_query.interact()
			interaction["snapshot"] = world.snapshot()
			return {"result": interaction}
		"walk":
			return await _walk(args)
		"wait":
			var frames := int(args.get("frames", 1))
			for _step in maxi(1, frames):
				await world.get_tree().physics_frame
			return {"result": world.snapshot()}
		"resize":
			return await _resize(args)
		"crosshair":
			if world.crosshair == null:
				return {"error": "No crosshair"}
			return {"result": world.crosshair.measure()}
		"hud":
			if world.hud == null:
				return {"error": "No HUD"}
			return {"result": world.hud.snapshot()}
		"state":
			if world.world_state == null:
				return {"error": "No world state"}
			return {"result": world.world_state.capture()}
		"save":
			return _save()
		"restore":
			return await _restore()
		"restore-state":
			return await _restore_state(args)
		"set-world-id":
			if not args.get("value") is String:
				return {"error": "World identity must be a string"}
			world.set_world_id(str(args.value))
			return {"result": {"worldId": world.world_id}}
		"probe-aim":
			if world.aim_query == null:
				return {"error": "No aim query"}
			return {"result": world.aim_query.probe()}
		_:
			return {"error": "Unsupported base operation: " + op}


func _equip(args: Dictionary) -> Dictionary:
	if world.equipment_state == null:
		return {"error": "No equipment state"}
	var value = args.get("value", args.get("id", ""))
	if not value is String:
		return {"error": "Equipment value must be a string"}
	if not world.equipment_state.equip(StringName(value)):
		return {"error": "Unknown equipment: " + str(value)}
	await world.get_tree().physics_frame
	return {"result": world.snapshot()}


func _look(args: Dictionary) -> Dictionary:
	if world.player == null:
		return {"error": "No player"}
	var yaw = args.get("yaw", world.player.look().yaw)
	var pitch = args.get("pitch", world.player.look().pitch)
	if not _is_finite_number(yaw) or absf(float(yaw)) > PI + 0.001:
		return {"error": "Invalid yaw"}
	if not _is_finite_number(pitch) or absf(float(pitch)) > PI * 0.5 + 0.001:
		return {"error": "Invalid pitch"}
	world.player.set_look(float(yaw), float(pitch))
	await world.get_tree().physics_frame
	return {"result": world.snapshot()}


func _walk(args: Dictionary) -> Dictionary:
	if world.player == null:
		return {"error": "No player"}
	var forward = args.get("forward", 0.0)
	var right = args.get("right", 0.0)
	var frames := int(args.get("frames", 30))
	if not _is_finite_number(forward) or not _is_finite_number(right):
		return {"error": "Walk axis must be finite"}
	if frames < 1 or frames > 600:
		return {"error": "Walk frames must be between 1 and 600"}
	var before := world.player.snapshot()
	await world.player.walk(Vector2(float(right), -float(forward)), frames)
	await world.get_tree().physics_frame
	return {"result": {"before": before, "after": world.player.snapshot(), "frames": frames, "snapshot": world.snapshot()}}


func _resize(args: Dictionary) -> Dictionary:
	var width := int(args.get("width", 0))
	var height := int(args.get("height", 0))
	if width < 320 or height < 240 or width > 7680 or height > 4320:
		return {"error": "Resolution is out of range"}
	world.get_window().size = Vector2i(width, height)
	await world.get_tree().process_frame
	await world.get_tree().process_frame
	await world.get_tree().physics_frame
	return {"result": {"viewportSize": [world.get_viewport().get_visible_rect().size.x, world.get_viewport().get_visible_rect().size.y], "crosshair": world.crosshair.measure() if world.crosshair != null else {}}}


func _save() -> Dictionary:
	if world.world_state == null or world.save_store == null:
		return {"error": "No save system"}
	var failure := world.save_store.save(world.world_state.capture())
	if not failure.is_empty():
		return {"error": failure}
	return {"result": {"written": true, "path": world.save_store.state_file(), "snapshot": world.snapshot()}}


func _restore() -> Dictionary:
	if world.world_state == null or world.save_store == null:
		return {"error": "No save system"}
	var loaded := world.save_store.load_state()
	if loaded.has("error"):
		return loaded
	return await _restore_state({"state": loaded.state})


func _restore_state(args: Dictionary) -> Dictionary:
	if world.world_state == null:
		return {"error": "No world state"}
	var state = args.get("state")
	if not state is Dictionary:
		return {"error": "State must be an object"}
	var failure := world.world_state.apply(state)
	if not failure.is_empty():
		return {"error": failure}
	await world.get_tree().physics_frame
	return {"result": world.snapshot()}


static func _is_finite_number(value) -> bool:
	return (value is float or value is int) and is_finite(float(value))
