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

func observe() -> Dictionary:
	return game().snapshot()

func command(op: String, args: Dictionary) -> Dictionary:
	# Scene teleport/reset helpers belong to standalone acceptance, not managed tools.
	if not op in ["move", "wait", "buy", "deliver", "talk", "gather", "interact", "focus"]:
		return {"error": "Unsupported managed top-down operation"}
	if op in ["move", "wait"]:
		var count: Variant = args.get("steps" if op == "move" else "frames", 1)
		if not (count is int or count is float) or not is_finite(float(count)) or float(count) != floorf(float(count)) or count < 1 or count > 600:
			return {"error": "Control is limited to 600 physics ticks"}
	if op == "move":
		for key in ["dx", "dy"]:
			var axis: Variant = args.get(key, 0.0)
			if not (axis is int or axis is float) or not is_finite(float(axis)) or absf(float(axis)) > 1:
				return {"error": "Control axis must be finite and within -1 to 1"}
	var result: Dictionary = await load("res://scripts/base/probe.gd")._dispatch(game(), op, args)
	return {"result": result} if result.get("ok", false) else {"error": str(result.get("error", result.get("reason", "Operation failed")))}
