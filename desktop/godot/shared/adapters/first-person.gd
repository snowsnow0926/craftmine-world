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
const TARGET_FEEDBACK_FORMAT := "craftmine.target-feedback-observation/1"
const TARGET_FEEDBACK_LIMIT := 256

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
	var result: Dictionary = world().snapshot()
	result["targetFeedback"] = _target_feedback()
	return result

# Fixed read-only source configuration from live nodes. No node path, property
# name, expression or value is accepted from a caller, and progress is untouched.
func _target_feedback() -> Dictionary:
	var host := world()
	var known_script = load("res://scripts/core/target_dummy.gd")
	if known_script == null:
		return _feedback_error("TARGET_FEEDBACK_SCRIPT_UNAVAILABLE")
	var targets := []
	var ids := {}
	var id_pattern := RegEx.new()
	id_pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
	for target in host.get_tree().get_nodes_in_group("base_targets"):
		if not host.is_ancestor_of(target) or target.get_script() != known_script:
			continue
		if targets.size() >= TARGET_FEEDBACK_LIMIT:
			return _feedback_error("TARGET_FEEDBACK_TOO_MANY_TARGETS")
		var identity: Variant = target.get("target_id")
		if not (identity is String or identity is StringName):
			return _feedback_error("TARGET_FEEDBACK_INVALID_ID")
		var id := str(identity)
		var matched := id_pattern.search(id)
		if matched == null or matched.get_string() != id:
			return _feedback_error("TARGET_FEEDBACK_INVALID_ID")
		if ids.has(id):
			return _feedback_error("TARGET_FEEDBACK_DUPLICATE_ID")
		ids[id] = true
		var seconds: Variant = target.get("hit_flash_seconds")
		if not (seconds is float or seconds is int) or not is_finite(float(seconds)):
			return _feedback_error("TARGET_FEEDBACK_INVALID_DURATION")
		var milliseconds := float(seconds) * 1000.0
		if milliseconds < 1.0 or milliseconds > 1000.0 or absf(milliseconds - roundf(milliseconds)) > 0.000001:
			return _feedback_error("TARGET_FEEDBACK_INVALID_DURATION")
		targets.append({"targetId": id, "hitFlashMilliseconds": int(roundf(milliseconds))})
	return {"format": TARGET_FEEDBACK_FORMAT, "targets": targets}

func _feedback_error(code: String) -> Dictionary:
	return {"format": TARGET_FEEDBACK_FORMAT, "targets": [], "error": code}

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
