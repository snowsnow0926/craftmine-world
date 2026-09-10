extends RefCounted
const BASE_ID := "creation-sandbox"
const BASE_VERSION := "1.0.0"
const Guard = preload("res://craftmine_shared/state_guard.gd")
const Contract = preload("res://scripts/scene_contract.gd")

func world() -> Node:
	return Engine.get_main_loop().current_scene

func is_ready() -> bool:
	return world() != null and world().get("ready_for_play") == true

func bind_world(id: String) -> String:
	var pattern := RegEx.new()
	pattern.compile("^[a-z0-9][a-z0-9-]{1,47}$")
	var match_id := pattern.search(id)
	if match_id == null or match_id.get_string() != id:
		return "Invalid creation world ID"
	world().world_id = id
	return ""

func capture() -> Dictionary:
	return world().capture()

func restore(body: Dictionary) -> String:
	var before := capture()
	var failure: String = world().restore(body)
	if not failure.is_empty():
		return failure
	var missing := Guard.omitted(body, capture())
	if not missing.is_empty():
		world().restore(before)
		return "Unsupported creation progress field: " + missing
	return ""

func observe() -> Dictionary:
	return world().observe()

func command(op: String, args: Dictionary) -> Dictionary:
	var allowed := {"walk": ["forward", "right", "frames"], "wait": ["frames"], "look": ["yaw", "pitch"], "interact": [], "set-time": ["hours"]}
	if not allowed.has(op) or not Contract.fields(args, [], allowed[op]):
		return {"error": "Unsupported creation operation or argument"}
	if not is_ready():
		return {"error": "Creation world is not ready"}
	match op:
		"walk", "wait":
			var frames: Variant = args.get("frames", 30 if op == "walk" else 1)
			if not Contract.integer(frames, 1, 600):
				return {"error": "Control requires 1..600 physics ticks"}
			if op == "walk":
				var forward: Variant = args.get("forward", 0)
				var right: Variant = args.get("right", 0)
				if not Contract.finite(forward, -1, 1) or not Contract.finite(right, -1, 1):
					return {"error": "Control axes must be finite -1..1"}
				await world().player.walk(Vector2(float(right), -float(forward)), int(frames))
			else:
				for _frame in int(frames):
					await world().get_tree().physics_frame
		"look":
			var pose: Dictionary = world().player.look()
			var yaw: Variant = args.get("yaw", pose.yaw)
			var pitch: Variant = args.get("pitch", pose.pitch)
			if not Contract.finite(yaw, -PI, PI) or not Contract.finite(pitch, -1.55, 1.55):
				return {"error": "Look angles must be bounded radians"}
			world().player.set_look(float(yaw), float(pitch))
		"interact":
			return {"result": world().interact_target()}
		"set-time":
			if not args.has("hours") or not Contract.finite(args.hours, 0, 24):
				return {"error": "Time requires finite hours 0..24"}
			world().set_time(float(args.hours))
	return {"result": world().observe()}
