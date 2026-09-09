extends RefCounted
const BASE_ID := "first-person"
const BASE_VERSION := "0.1.0"
const Guard = preload("res://craftmine_shared/state_guard.gd")

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
	if op in ["set-world-id", "restore"]:
		return {"error": "Managed identity and progress are controlled by the host"}
	return await BaseOps.new(world()).execute(op, args)
