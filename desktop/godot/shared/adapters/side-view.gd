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

func command(_op: String, _args: Dictionary) -> Dictionary:
	return {"error": "Unsupported side-view operation"}
