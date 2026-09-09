extends RefCounted
const BASE_ID := "first-person"
const BASE_VERSION := "0.1.0"
const Guard = preload("res://craftmine_shared/state_guard.gd")

# Managed gameplay may only drive the base through its ordinary operations.
# Identity, progress restore and state installation stay with the host, and the
# same bounded set is declared in desktop/godot/shared/observation.mjs.
const ALLOWED_OPERATIONS := ["walk", "wait", "look", "equip", "next-equipment", "attack", "fire", "reload", "interact", "snapshot", "crosshair", "hud", "probe-aim", "state"]
const HOST_ONLY_OPERATIONS := ["set-world-id", "restore", "restore-state", "save", "load"]
const MAX_TICKS := 600

func world() -> Node:
	return Engine.get_main_loop().current_scene

func is_ready() -> bool:
	return world() != null and world().get("world_state") != null

func bind_world(id: String) -> String:
	world().set_world_id(id)
	return ""

func capture() -> Dictionary:
	return world().world_state.capture()

func restore(body: Dictionary) -> String:
	var before := capture()
	var failure: String = world().world_state.apply(body)
	if not failure.is_empty():
		return failure
	var omitted := Guard.omitted(body, capture())
	if not omitted.is_empty():
		var rollback: String = world().world_state.apply(before)
		return "Unsupported native state field: " + omitted + ("; rollback: " + rollback if not rollback.is_empty() else "")
	return ""

func observe() -> Dictionary:
	return world().snapshot()

func command(op: String, args: Dictionary) -> Dictionary:
	if op in HOST_ONLY_OPERATIONS:
		return {"error": "Managed identity and progress are controlled by the host"}
	if not op in ALLOWED_OPERATIONS:
		return {"error": "Unsupported managed first-person operation"}
	if op in ["walk", "wait"]:
		var frames: Variant = args.get("frames", 30 if op == "walk" else 1)
		if not (frames is int or frames is float) or not is_finite(float(frames)) or float(frames) != floorf(float(frames)) or frames < 1 or frames > MAX_TICKS:
			return {"error": "Control is limited to 600 physics ticks"}
	if op == "walk":
		for key in ["forward", "right"]:
			var axis: Variant = args.get(key, 0.0)
			if not (axis is int or axis is float) or not is_finite(float(axis)) or absf(float(axis)) > 1:
				return {"error": "Control axis must be finite and within -1 to 1"}
	return await BaseOps.new(world()).execute(op, args)
