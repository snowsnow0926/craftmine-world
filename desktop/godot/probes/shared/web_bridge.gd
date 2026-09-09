extends Node

# Unified Godot Web runtime protocol `craftmine.godot-runtime/2`.
#
# The host (Electron main, or a page-script adapter in acceptance tests) drives
# a running world through this node. The node owns the operations that are the
# same for every base — identity, progress persistence, pause/resume,
# acknowledgement and shutdown — and forwards everything else to the base's
# `web_command(op, args)`, which is where a base implements its own state and
# gameplay (see docs/GODOT_WEB_RUNTIME_PROTOCOL.md).
#
# Identity: the first accepted request binds this runtime to one
# worldId/buildId/instanceId triple. A later request with a different triple is
# rejected, so a stale page, a reloaded instance or another world can never
# write here. The page-side bridge applies the same rule before a message
# reaches GDScript.
#
# Persistence is reported in three separate stages so the host can tell them
# apart: the write request the host sent, the runner confirmation this node
# returns (`status: "confirmed"` plus a runner receipt), and the durable
# receipt the host reports back with `acknowledge` once its own progress
# transaction committed.
const PROGRESS_FORMAT := "craftmine.godot-progress/2"
const LEGACY_PROGRESS_FORMAT := "craftmine.godot-probe-progress/1"
const RUNTIME_OPS := ["capabilities", "load", "snapshot", "save", "pause", "resume", "acknowledge", "cancel", "exit"]

var browser: JavaScriptObject
var receiver: JavaScriptObject
var queue: Array[Dictionary] = []
var busy := false
var world_id := ""
var build_id := ""
var instance_id := ""
var paused := false
var exited := false
var runner_receipt: Dictionary = {}
var persisted_receipt: Dictionary = {}

func _ready() -> void:
	name = "WebBridge"
	# The bridge must keep answering while the world is paused, otherwise a
	# pause request could never be followed by a resume or a snapshot.
	process_mode = Node.PROCESS_MODE_ALWAYS
	browser = JavaScriptBridge.get_interface("CraftmineGame")
	receiver = JavaScriptBridge.create_callback(receive)
	browser.register(receiver)

func receive(args: Array) -> void:
	if args.size() != 1 or not args[0] is String or exited:
		return
	var request: Variant = JSON.parse_string(args[0])
	if request is Dictionary and queue.size() < 16:
		queue.append(request)

func identity_error(request: Dictionary) -> String:
	# `worldId` is required by both transports. `buildId`/`instanceId` are the
	# runtime protocol's additions; the older preview transport omits them, so a
	# missing value is bound as empty rather than rejected.
	var world_value: Variant = request.get("worldId")
	if not world_value is String or str(world_value).is_empty() or str(world_value).length() > 128:
		return "World identity is invalid"
	for key in ["buildId", "instanceId"]:
		var value: Variant = request.get(key)
		if value == null:
			continue
		if not value is String or str(value).length() > 128:
			return "Runtime identity is invalid"
	if world_id.is_empty():
		return ""
	if world_id != request.worldId:
		return "World identity changed"
	if not build_id.is_empty() and request.has("buildId") and build_id != request.buildId:
		return "Build identity changed"
	if not instance_id.is_empty() and request.has("instanceId") and instance_id != request.instanceId:
		return "Runtime instance changed"
	return ""

func progress_path() -> String:
	return "user://worlds/" + world_id.sha256_text() + "/progress.json"

func write_progress(state: Dictionary) -> String:
	# Legacy fixture API: the authored probes call this directly and expect an
	# empty string on success. Returns the failure message, or "".
	var receipt := write_receipt(state)
	return str(receipt.get("error", ""))

func write_receipt(state: Dictionary) -> Dictionary:
	if world_id.is_empty():
		return {"error": "World identity is missing"}
	var location := progress_path()
	if DirAccess.make_dir_recursive_absolute(location.get_base_dir()) != OK:
		return {"error": "Progress directory could not be created"}
	var payload := {
		"format": PROGRESS_FORMAT,
		"worldId": world_id,
		"buildId": build_id,
		"instanceId": instance_id,
		"state": state,
		"savedAt": Time.get_unix_time_from_system(),
	}
	var text := JSON.stringify(payload)
	var file := FileAccess.open(location, FileAccess.WRITE)
	if file == null:
		return {"error": "Progress could not be saved"}
	file.store_string(text)
	var status := file.get_error()
	file.close()
	if status != OK:
		return {"error": "Progress write failed"}
	return {
		"format": PROGRESS_FORMAT,
		"worldId": world_id,
		"buildId": build_id,
		"instanceId": instance_id,
		"path": location,
		"bytes": text.to_utf8_buffer().size(),
		"sha256": text.sha256_text(),
		"savedAt": payload.savedAt,
	}

func read_progress() -> Dictionary:
	var file := FileAccess.open(progress_path(), FileAccess.READ)
	if file == null:
		return {"error": "Progress is missing"}
	var saved: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if not saved is Dictionary or not saved.get("state") is Dictionary:
		return {"error": "Progress is invalid"}
	if saved.get("format") == LEGACY_PROGRESS_FORMAT:
		if saved.get("worldId") != world_id:
			return {"error": "Progress is invalid"}
		return {"state": saved.state, "legacy": true}
	if saved.get("format") != PROGRESS_FORMAT or saved.get("worldId") != world_id:
		return {"error": "Progress is invalid"}
	# A different build of the same world is still the same world: the runner
	# copy is offered back and the host's own progress transaction stays
	# authoritative for what the new build should actually load.
	if saved.get("buildId") != build_id:
		return {"state": saved.state, "buildMismatch": true}
	return {"state": saved.state}

func full_snapshot() -> Dictionary:
	var response: Dictionary = await get_parent().web_command("snapshot", {})
	if response.has("error"):
		return response
	var result: Variant = response.get("result", {})
	if not result is Dictionary:
		return {"error": "Snapshot is invalid"}
	return result

func handle_save(args: Dictionary) -> Dictionary:
	if world_id.is_empty():
		return {"error": "World identity is missing"}
	var current := await full_snapshot()
	if current.has("error"):
		return current
	var state: Dictionary = current.state if current.get("state") is Dictionary else {}
	var receipt := write_receipt(state)
	if receipt.has("error"):
		return receipt
	runner_receipt = receipt
	return {"status": "confirmed", "runnerReceipt": receipt, "snapshot": current, "state": state}

func handle_internal(op: String, args: Dictionary) -> Dictionary:
	match op:
		"capabilities":
			return {"result": {"protocol": "craftmine.godot-runtime/2", "ops": RUNTIME_OPS,
				"worldId": world_id, "buildId": build_id, "instanceId": instance_id,
				"paused": paused, "persistentStorage": OS.is_userfs_persistent()}}
		"load":
			var loaded: Dictionary = await get_parent().web_command("load", args)
			if not loaded.has("error"):
				return loaded
			# A base that has not implemented `load` yet can still be restored
			# through its own state-restore operation. This is a fallback, not a
			# substitute: bases should implement `load` so a build and a snapshot
			# are applied together.
			if not str(loaded.error).contains("Unsupported"):
				return loaded
			var restored: Dictionary = await get_parent().web_command("restore-state", {"state": args.get("snapshot")})
			if restored.has("error"):
				return restored
			return {"result": {"loaded": true, "fallback": "restore-state", "snapshot": restored.get("result", {})}}
		"save":
			return {"result": await handle_save(args)}
		"pause":
			paused = true
			get_tree().paused = true
			var paused_result: Dictionary = await get_parent().web_command("pause", args)
			return {"result": {"paused": true, "engine": true, "baseError": str(paused_result.get("error", ""))}}
		"resume":
			paused = false
			get_tree().paused = false
			var resumed_result: Dictionary = await get_parent().web_command("resume", args)
			return {"result": {"paused": false, "engine": true, "baseError": str(resumed_result.get("error", ""))}}
		"acknowledge":
			if args.get("failed") == true:
				persisted_receipt = {}
				return {"result": {"acknowledged": false, "error": str(args.get("error", "Progress was not persisted"))}}
			var receipt: Variant = args.get("receipt")
			if not receipt is Dictionary or receipt.get("format") != "craftmine.progress-receipt/1":
				return {"error": "Persisted receipt is invalid"}
			if str(receipt.get("worldId", "")) != world_id or str(receipt.get("buildId", "")) != build_id:
				return {"error": "Persisted receipt belongs to another world"}
			persisted_receipt = receipt
			return {"result": {"acknowledged": true, "receipt": receipt}}
		"exit":
			exited = true
			get_tree().call_deferred("quit", 0)
			return {"result": {"exitCode": 0}}
		_:
			return {}

func _process(_delta: float) -> void:
	if busy or queue.is_empty() or exited:
		return
	busy = true
	var request: Dictionary = queue.pop_front()
	var result: Dictionary
	var failure := identity_error(request)
	if not failure.is_empty():
		result = {"error": failure}
	elif not request.get("args", {}) is Dictionary:
		result = {"error": "Operation arguments must be an object"}
	else:
		world_id = str(request.worldId)
		if request.has("buildId"):
			build_id = str(request.buildId)
		if request.has("instanceId"):
			instance_id = str(request.instanceId)
		var op := str(request.op)
		result = await handle_internal(op, request.get("args", {}))
		if result.is_empty():
			result = await get_parent().web_command(op, request.get("args", {}))
	result["id"] = request.id
	if not result.has("error"):
		result["identity"] = {"worldId": world_id, "buildId": build_id, "instanceId": instance_id}
	browser.complete(JSON.stringify(result))
	busy = false
