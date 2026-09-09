extends Node2D

# Minimal fixed test game for the managed-executor full chain.
#
# It implements only the runtime operations the isolated check uses: register a
# callback with the host bridge, answer `capabilities`, apply `load`, answer
# `snapshot` with exactly the state it was given, and accept pause/resume/exit.
# It is a test fixture, not a product base.

var browser: JavaScriptObject
var receiver: JavaScriptObject
var loaded_state: Variant = null

func _ready() -> void:
	browser = JavaScriptBridge.get_interface("CraftmineGame")
	if browser == null:
		return
	receiver = JavaScriptBridge.create_callback(receive)
	browser.register(receiver)

func receive(args: Array) -> void:
	if args.size() != 1 or not args[0] is String:
		return
	var request: Variant = JSON.parse_string(args[0])
	if not request is Dictionary:
		return
	var op := str(request.get("op", ""))
	var result: Dictionary = {}
	match op:
		"capabilities":
			result = {"result": {"protocol": "craftmine.godot-runtime/2",
				"ops": ["capabilities", "load", "snapshot", "pause", "resume", "exit"]}}
		"load":
			loaded_state = request.get("args", {}).get("snapshot")
			result = {"result": {"loaded": true, "snapshot": loaded_state}}
		"resume":
			result = {"result": {"paused": false}}
		"pause":
			result = {"result": {"paused": true}}
		"snapshot":
			if loaded_state == null:
				result = {"result": {"format": "craftmine.godot-progress/1",
					"worldId": str(request.get("worldId", "")), "baseId": "first-person",
					"baseVersion": "1.0.0", "stateVersion": 1, "body": {"coins": 0}}}
			else:
				result = {"result": loaded_state}
		"exit":
			result = {"result": {"exitCode": 0}}
		_:
			result = {"error": "Unsupported operation: " + op}
	result["id"] = request.get("id")
	browser.complete(JSON.stringify(result))
