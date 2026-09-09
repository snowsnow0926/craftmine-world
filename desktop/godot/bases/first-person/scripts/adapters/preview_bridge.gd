extends Node

## Thin adapter between a shared Web preview transport and this base.
##
## The shared run protocol is not frozen yet, so the entire coupling lives here
## and in BaseOps: the base scenes never reference a transport, and task C can
## replace this file without touching gameplay. Wire protocol:
## craftmine.godot-preview/1 (same request/response shape as the GD0 probe).
##
## The bridge has no filesystem or desktop authority. It never requests pointer
## lock or focus; a real click in the game window is still what captures the
## mouse, so an automated run cannot capture input.

const PROTOCOL_LIMIT := 16

var browser: JavaScriptObject
var receiver: JavaScriptObject
var queue: Array[Dictionary] = []
var busy := false
var ops: BaseOps
var world_id := ""


func _ready() -> void:
	if ProjectSettings.get_setting("craftmine/runtime/enabled", false):
		set_process(false)
		return
	name = "PreviewBridge"
	var root := get_parent()
	if root is BaseWorld:
		ops = BaseOps.new(root)
	if not OS.has_feature("web"):
		set_process(false)
		return
	browser = JavaScriptBridge.get_interface("CraftmineGame")
	if browser == null:
		set_process(false)
		return
	receiver = JavaScriptBridge.create_callback(receive)
	browser.register(receiver)


func receive(args: Array) -> void:
	if args.size() != 1 or not args[0] is String:
		return
	var request: Variant = JSON.parse_string(args[0])
	if request is Dictionary and queue.size() < PROTOCOL_LIMIT:
		queue.append(request)


func _process(_delta: float) -> void:
	if busy or queue.is_empty() or ops == null:
		return
	busy = true
	var request: Dictionary = queue.pop_front()
	var identity = request.get("worldId")
	var result: Dictionary
	if not identity is String or str(identity).is_empty() or str(identity).length() > 128:
		result = {"error": "World identity is invalid"}
	elif not world_id.is_empty() and world_id != str(identity):
		result = {"error": "World identity changed"}
	elif not request.get("args", {}) is Dictionary:
		result = {"error": "Operation arguments must be an object"}
	else:
		world_id = str(identity)
		var root := get_parent()
		if root is BaseWorld:
			root.set_world_id(world_id)
		result = await ops.execute(str(request.get("op", "")), request.get("args", {}))
	result["id"] = request.get("id")
	browser.complete(JSON.stringify(result))
	busy = false
