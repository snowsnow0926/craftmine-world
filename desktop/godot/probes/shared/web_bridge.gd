extends Node

# Trusted fixture adapter. Native build/import isolation is a separate gate.
var browser: JavaScriptObject
var receiver: JavaScriptObject
var queue: Array[Dictionary] = []
var busy := false
var world_id := ""

func _ready() -> void:
	name = "WebBridge"
	browser = JavaScriptBridge.get_interface("CraftmineGame")
	receiver = JavaScriptBridge.create_callback(receive)
	browser.register(receiver)

func receive(args: Array) -> void:
	if args.size() != 1 or not args[0] is String:
		return
	var request: Variant = JSON.parse_string(args[0])
	if request is Dictionary and queue.size() < 16:
		queue.append(request)

func progress_path() -> String:
	return "user://worlds/" + world_id.sha256_text() + "/progress.json"

func write_progress(state: Dictionary) -> String:
	if world_id.is_empty():
		return "World identity is missing"
	var location := progress_path()
	if DirAccess.make_dir_recursive_absolute(location.get_base_dir()) != OK:
		return "Progress directory could not be created"
	var file := FileAccess.open(location, FileAccess.WRITE)
	if file == null:
		return "Progress could not be saved"
	file.store_string(JSON.stringify({"format": "craftmine.godot-probe-progress/1", "worldId": world_id, "state": state}))
	var status := file.get_error()
	file.close()
	return "" if status == OK else "Progress write failed"

func read_progress() -> Dictionary:
	var file := FileAccess.open(progress_path(), FileAccess.READ)
	if file == null:
		return {"error": "Progress is missing"}
	var saved: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if not saved is Dictionary or saved.get("format") != "craftmine.godot-probe-progress/1" or saved.get("worldId") != world_id or not saved.get("state") is Dictionary:
		return {"error": "Progress is invalid"}
	return {"state": saved.state}

func _process(_delta: float) -> void:
	if busy or queue.is_empty():
		return
	busy = true
	var request: Dictionary = queue.pop_front()
	var result: Dictionary
	if not request.get("worldId") is String or str(request.worldId).is_empty() or str(request.worldId).length() > 128:
		result = {"error": "World identity is invalid"}
	elif not world_id.is_empty() and world_id != request.worldId:
		result = {"error": "World identity changed"}
	elif not request.get("args", {}) is Dictionary:
		result = {"error": "Operation arguments must be an object"}
	else:
		world_id = request.worldId
		result = await get_parent().web_command(str(request.op), request.get("args", {}))
	result["id"] = request.id
	browser.complete(JSON.stringify(result))
	busy = false
