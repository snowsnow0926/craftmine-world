# Reference shared adapter for the mining-sandbox base (for task F).
#
# Task F owns desktop/godot/shared/**; this file is delivered as a contract
# artefact so F can place it at
#   desktop/godot/shared/adapters/mining-sandbox.gd
# (materialize.mjs copies shared/adapters/<baseId>.gd to
#  res://craftmine_shared/base_adapter.gd, so the file name must equal baseId).
#
# It implements the exact member set shared/adapters/side-view.gd implements:
#   runtime(), is_ready(), bind_world(id), capture(), restore(body), command(op,args)
# The native body is the mining-sandbox managed capture from SPEC section 5.10,
# which carries the chunk edits so a managed receipt cannot lose terrain.
extends RefCounted

const BASE_ID := "mining-sandbox"
const BASE_VERSION := "1.0.0"
const Guard = preload("res://craftmine_shared/state_guard.gd")

const COMMANDS := [
	"dig", "place", "craft", "tile", "inventory", "hash", "snapshot",
]


func runtime() -> Node:
	var loop := Engine.get_main_loop()
	if loop == null or loop.root == null:
		return null
	return loop.root.get_node_or_null("Main")


func is_ready() -> bool:
	var game := runtime()
	if game == null:
		return false
	if not game.has_method("capture_managed") or not game.has_method("snapshot"):
		return false
	return String(game.get("boot_error")) == ""


func bind_world(id: String) -> String:
	var game := runtime()
	if game == null:
		return "Mining sandbox is not loaded"
	if not game.has_method("bind_world"):
		return "Mining sandbox does not expose bind_world"
	return String(game.bind_world(id))


# Returns the native body that runtime_bridge.gd wraps as `state.body`. Never
# returns a truncated body: an oversized capture is reported as an error.
func capture() -> Dictionary:
	var game := runtime()
	if game == null:
		return {"error": "Mining sandbox is not loaded"}
	var body: Variant = game.capture_managed()
	if not body is Dictionary:
		return {"error": "Mining sandbox capture failed"}
	if body.has("error"):
		return body
	var problem := Guard.omitted({}, body)
	if problem != "":
		return {"error": problem}
	return body


func restore(body: Dictionary) -> String:
	var game := runtime()
	if game == null:
		return "Mining sandbox is not loaded"
	if not game.has_method("restore_managed"):
		return "Mining sandbox does not expose restore_managed"
	var outcome: Variant = game.restore_managed(body)
	if not outcome is Dictionary:
		return "Mining sandbox restore returned an unexpected value"
	if bool(outcome.get("ok", false)):
		return ""
	return String(outcome.get("error", outcome.get("reason", "Mining sandbox restore was rejected")))


func command(op: String, args: Dictionary) -> Dictionary:
	var game := runtime()
	if game == null:
		return {"error": "Mining sandbox is not loaded"}
	match op:
		"dig":
			return {"result": game.dig(int(args.get("tx", 0)), int(args.get("ty", 0)), String(args.get("requestId", "")))}
		"place":
			return {"result": game.place(int(args.get("tx", 0)), int(args.get("ty", 0)), String(args.get("materialId", "")), String(args.get("requestId", "")))}
		"craft":
			return {"result": game.craft(String(args.get("recipeId", "")), String(args.get("requestId", "")), String(args.get("stationId", "")))}
		"tile":
			return {"result": game.tile_at(int(args.get("tx", 0)), int(args.get("ty", 0)))}
		"inventory":
			return {"result": game.inventory_report()}
		"hash":
			return {"result": {"hash": game.terrain_hash()}}
		"snapshot":
			return {"result": game.snapshot()}
	return {"error": "Unsupported mining-sandbox operation: %s" % op}
