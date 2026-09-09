extends RefCounted
const BASE_ID := "side-view"
const BASE_VERSION := "1.0.0"
const Guard = preload("res://craftmine_shared/state_guard.gd")

func runtime() -> Node:
	return Engine.get_main_loop().root.get_node("SideView")

func is_ready() -> bool:
	return runtime().state != null and runtime().room_manager != null and runtime().world_ready_emitted

func bind_world(id: String) -> String:
	return "" if runtime().state.world_id == id else "Base project belongs to another world"

func capture() -> Dictionary:
	runtime().player._sync_state_placement()
	return runtime().state.to_dict()

func restore(body: Dictionary) -> String:
	var host := runtime()
	var candidate = load("res://scripts/runtime/world_state.gd").create(host.state.world_id, host.state.state_version)
	var applied: Dictionary = candidate.apply_dict(body)
	if not applied.ok:
		return applied.error
	var omitted := Guard.omitted(body, candidate.to_dict())
	if not omitted.is_empty():
		return "Unsupported native state field: " + omitted
	var room_id: String = candidate.player.room
	if host.room_manager.room_data(room_id).is_empty():
		return "Saved room is not in the authored world"
	for room in candidate.rooms:
		if host.room_manager.room_data(room).is_empty():
			return "Saved room ledger is incompatible"
	if not candidate.vitals.is_empty() and candidate.vitals.health > host.config.max_health():
		return "Saved health exceeds authored maximum"
	var targets := {}
	for room in host.world_data.rooms:
		for target in room.get("targets", []):
			targets[str(target.id)] = target
	for id in candidate.entities:
		if not targets.has(id) or candidate.entities[id].health > int(targets[id].get("health", 2)):
			return "Saved target is incompatible with authored world"
		var reward_id: String = targets[id].get("rewardId", "")
		if not reward_id.is_empty() and ((candidate.entities[id].health == 0) != candidate.has_reward(reward_id)):
			return "Saved target and reward ledger disagree"
	host.state.apply_dict(body)
	host.room_manager.enter_room(room_id, "", candidate.player, true)
	host.player.restore_vitals()
	return ""

func observe() -> Dictionary:
	var host := runtime()
	var targets := []
	for node in host.room_manager.current_room.get_children():
		if node is SideViewTarget and not node.is_queued_for_deletion():
			targets.append({"id": node.target_id, "health": node.health, "maxHealth": node.max_health})
	return {"player": host.player.snapshot(), "roomId": host.current_room_id, "targets": targets, "tick": host.elapsed_ticks, "visual": {"visible": host.player.visual.is_visible_in_tree(), "playerVisible": host.player.is_visible_in_tree(), "textureWidth": host.player.visual.texture.get_width(), "textureHeight": host.player.visual.texture.get_height(), "screenX": host.player.visual.get_global_transform_with_canvas().origin.x, "screenY": host.player.visual.get_global_transform_with_canvas().origin.y}}

func command(op: String, args: Dictionary) -> Dictionary:
	if op != "control":
		return {"error": "Unsupported side-view operation"}
	if args.size() != 1 or not args.get("segments") is Array or args.segments.is_empty() or args.segments.size() > 64:
		return {"error": "Control requires 1 to 64 bounded segments"}
	var source := ManagedInputSource.new()
	for segment in args.segments:
		if not segment is Dictionary:
			return {"error": "Control segment must be an object"}
		for key in segment:
			if not key in ["ticks", "move", "jump", "attack", "interact"]:
				return {"error": "Unsupported control field"}
		var ticks: Variant = segment.get("ticks")
		if not (ticks is int or ticks is float) or not is_finite(float(ticks)) or float(ticks) != floorf(float(ticks)) or ticks < 1 or ticks > 600 or source.frames.size() + int(ticks) > 600:
			return {"error": "Control is limited to 600 physics ticks"}
		var axis: Variant = segment.get("move", 0.0)
		if not (axis is int or axis is float) or not is_finite(float(axis)) or absf(float(axis)) > 1:
			return {"error": "Control move axis must be finite and within -1 to 1"}
		for key in ["jump", "attack", "interact"]:
			if not segment.get(key, false) is bool:
				return {"error": "Control buttons must be booleans"}
		for _tick in int(ticks):
			source.frames.append(segment.duplicate())
	var host := runtime()
	var previous = host.input_source
	var before := observe()
	host.input_source = source
	var tree = Engine.get_main_loop()
	# The source supplies neutral controls after its final tick. A finite deadline
	# also bounds a dead/stalled player that temporarily stops polling controls.
	for _tick in range(source.frames.size() + 180):
		await tree.physics_frame
		await tree.process_frame
		if source.tick >= source.frames.size():
			break
	host.input_source = previous
	if source.tick < source.frames.size():
		return {"error": "Player did not consume controls before the deadline"}
	return {"result": {"before": before, "after": observe(), "appliedTicks": source.frames.size()}}
