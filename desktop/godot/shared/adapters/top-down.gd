extends RefCounted
const BASE_ID := "top-down"
const BASE_VERSION := "1.0.0"
const Guard = preload("res://craftmine_shared/state_guard.gd")

func game() -> Node:
	return Engine.get_main_loop().root.get_node("Game")

func is_ready() -> bool:
	return game().scene_root() != null and game().boot_error.is_empty()

func bind_world(id: String) -> String:
	return "" if game().state.world_id == id else "Base project belongs to another world"

func capture() -> Dictionary:
	game()._record_scene_position()
	return game().state.to_dict()

func restore(body: Dictionary) -> String:
	var candidate = load("res://scripts/base/world_state.gd").create(game().state.world_id, {})
	var applied: Dictionary = candidate.from_dict(body, game().state.world_id)
	if not applied.ok:
		return applied.error
	var omitted := Guard.omitted(body, candidate.to_dict())
	if not omitted.is_empty():
		return "Unsupported native state field: " + omitted
	return game().restore_runtime_state(candidate)

func command(op: String, args: Dictionary) -> Dictionary:
	if op in ["reset-to-initial", "restore"]:
		return {"error": "Managed progress is controlled by the host"}
	var result: Dictionary = await load("res://scripts/base/probe.gd")._dispatch(game(), op, args)
	return {"result": result} if result.get("ok", false) else {"error": str(result.get("error", result.get("reason", "Operation failed")))}
