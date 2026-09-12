extends Node

const Guard = preload("res://craftmine_shared/state_guard.gd")
const PROTOCOL := "craftmine.godot-runtime/2"
const OPS := ["capabilities", "observe", "observe-envelope", "load", "restore-state", "snapshot", "save", "pause", "resume", "acknowledge", "exit"]
var adapter: RefCounted
var browser: JavaScriptObject
var receiver: JavaScriptObject
var queue: Array[Dictionary] = []
var scope: Dictionary = {}
var initialized := false
var loaded := false
var busy := false
var persisted_receipt: Dictionary = {}
var latest_runner_receipt: Dictionary = {}

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	adapter = load(ProjectSettings.get_setting("craftmine/runtime/adapter")).new()
	_bootstrap.call_deferred()

func _bootstrap() -> void:
	for _frame in range(300):
		await get_tree().process_frame
		if adapter.is_ready():
			initialized = true
			get_tree().paused = true
			if OS.has_feature("web"):
				browser = JavaScriptBridge.get_interface("CraftmineGame")
				if browser != null:
					receiver = JavaScriptBridge.create_callback(receive)
					browser.register(receiver)
			return

func receive(arguments: Array) -> void:
	if arguments.size() != 1 or not arguments[0] is String:
		return
	var request: Variant = JSON.parse_string(arguments[0])
	if request is Dictionary and queue.size() < 16:
		queue.append(request)
		# A detached or hidden Web view may stop producing animation frames
		# after ready. Host state loading must not wait for the next _process.
		# Drain on receipt, retaining the same serial queue for async gameplay.
		_drain_queue()

func _process(_delta: float) -> void:
	_drain_queue()

func _drain_queue() -> void:
	if busy or queue.is_empty() or browser == null:
		return
	busy = true
	while not queue.is_empty():
		var request: Dictionary = queue.pop_front()
		var result := await handle_request(request)
		result["id"] = request.get("id")
		browser.complete(JSON.stringify(result))
	busy = false

func handle_request(request: Dictionary) -> Dictionary:
	if not initialized:
		return {"error": "Base is not ready"}
	for key in ["worldId", "buildId", "instanceId"]:
		if not request.get(key) is String or request[key].is_empty() or request[key].length() > 128:
			return {"error": "Runtime identity is invalid"}
		if not scope.is_empty() and scope[key] != request[key]:
			return {"error": "Runtime identity changed"}
	if request.worldId != ProjectSettings.get_setting("craftmine/runtime/world_id"):
		return {"error": "Runtime project belongs to another world"}
	if not request.get("args", {}) is Dictionary:
		return {"error": "Operation arguments must be an object"}
	if scope.is_empty():
		var problem: String = adapter.bind_world(request.worldId)
		if not problem.is_empty():
			return {"error": problem}
		scope = {"worldId": request.worldId, "buildId": request.buildId, "instanceId": request.instanceId}
	var args: Dictionary = request.get("args", {})
	match str(request.get("op", "")):
		"capabilities":
			return {"result": {"protocol": PROTOCOL, "ops": OPS, "baseId": adapter.BASE_ID, "baseVersion": adapter.BASE_VERSION, "progressFormat": Guard.FORMAT, "loaded": loaded, "paused": get_tree().paused}}
		"load", "restore-state":
			var state: Variant = args.get("snapshot", args.get("state"))
			if state != null:
				var failure := Guard.validate(state, scope.worldId, adapter.BASE_ID, adapter.BASE_VERSION)
				if not failure.is_empty():
					return {"error": failure}
				failure = await adapter.restore(state.body)
				if not failure.is_empty():
					return {"error": failure}
			loaded = true
			latest_runner_receipt = {}
			return {"result": {"loaded": true, "snapshot": snapshot()}}
		"observe":
			return {"result": adapter.observe()}
		"observe-envelope":
			# Read-only observation with the identity and sampling time that make it
			# trustworthy. Additive: the plain "observe" shape is unchanged.
			var payload: Dictionary = adapter.observe().duplicate(true)
			var surface_size: Vector2i = DisplayServer.window_get_size()
			var logical_size: Vector2 = get_viewport().get_visible_rect().size
			payload["surfaceSize"] = [surface_size.x, surface_size.y]
			payload["logicalViewportSize"] = [logical_size.x, logical_size.y]
			return {"result": {"format": "craftmine.godot-observation/1", "worldId": scope.worldId, "buildId": scope.buildId, "instanceId": scope.instanceId, "baseId": adapter.BASE_ID, "baseVersion": adapter.BASE_VERSION, "sampledAt": Time.get_datetime_string_from_system(true) + "Z", "protocol": PROTOCOL, "payload": payload}}
		"snapshot":
			var current := snapshot()
			var failure := Guard.validate(current.state, scope.worldId, adapter.BASE_ID, adapter.BASE_VERSION)
			return {"result": current} if failure.is_empty() else {"error": failure}
		"save":
			if not loaded:
				return {"error": "Load the world before confirming progress"}
			var current := snapshot()
			var text := JSON.stringify(current.state)
			if text.to_utf8_buffer().size() > Guard.LIMIT:
				return {"error": "Complete progress exceeds 1 MiB"}
			var receipt := {"format": "craftmine.godot-runner-receipt/1", "worldId": scope.worldId, "buildId": scope.buildId, "instanceId": scope.instanceId, "snapshotText": text, "snapshotSha256": text.sha256_text(), "bytes": text.to_utf8_buffer().size()}
			latest_runner_receipt = receipt.duplicate(true)
			return {"result": {"status": "confirmed", "runnerReceipt": receipt, "snapshot": current, "state": current.state}}
		"pause":
			get_tree().paused = true
			return {"result": {"paused": true}}
		"resume":
			if not loaded:
				return {"error": "Load the world before resuming"}
			get_tree().paused = false
			return {"result": {"paused": false}}
		"acknowledge":
			if args.get("failed") == true:
				persisted_receipt = {}
				return {"result": {"acknowledged": false}}
			var receipt: Variant = args.get("receipt")
			if not receipt is Dictionary or receipt.get("format") != "craftmine.godot-progress-receipt/1" or receipt.get("worldId") != scope.worldId or receipt.get("buildId") != scope.buildId:
				return {"error": "Durable progress receipt identity is invalid"}
			if latest_runner_receipt.is_empty() or receipt.get("instanceId") != scope.instanceId or receipt.get("snapshotSha256") != latest_runner_receipt.snapshotSha256:
				return {"error": "Durable receipt does not acknowledge the latest confirmed snapshot"}
			persisted_receipt = receipt.duplicate(true)
			return {"result": {"acknowledged": true}}
		"exit":
			get_tree().call_deferred("quit", 0)
			return {"result": {"exitCode": 0}}
		_:
			if get_tree().paused:
				return {"error": "Resume before gameplay operations"}
			return await adapter.command(str(request.get("op", "")), args)

func snapshot() -> Dictionary:
	return {"base": adapter.BASE_ID, "worldId": scope.get("worldId", ""), "state": {"format": Guard.FORMAT, "worldId": scope.get("worldId", ""), "baseId": adapter.BASE_ID, "baseVersion": adapter.BASE_VERSION, "stateVersion": 1, "body": adapter.capture()}}
