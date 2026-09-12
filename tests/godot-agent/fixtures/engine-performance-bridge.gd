extends Node

var bridge: Node
var serial := 0
var checks: Array = []
const NONCE := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func request(op: String, args: Dictionary = {}) -> Dictionary:
	serial += 1
	return {"id": serial, "op": op, "worldId": "bridge-engine-world", "buildId": "build-native", "instanceId": "instance-native", "args": args}

func require_ok(condition: bool, label: String) -> void:
	if not condition:
		push_error("BRIDGE_ASSERT: " + label)
		get_tree().quit(1)
		assert(condition, label)
	checks.append(label)

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_run.call_deferred()

func _run() -> void:
	bridge = get_tree().root.get_node("CraftmineRuntime")
	while not bridge.initialized:
		await get_tree().process_frame
	var before_scope: Dictionary = bridge.scope.duplicate(true)
	var early: Dictionary = await bridge.handle_request(request("engine-performance", {"nonce": NONCE}))
	require_ok(early.get("error") == "ENGINE_PERFORMANCE_NOT_LOADED" and bridge.scope == before_scope, "unloaded read cannot establish identity")
	var capabilities: Dictionary = await bridge.handle_request(request("capabilities"))
	require_ok(capabilities.result.ops.has("engine-performance") and capabilities.result.enginePerformanceProfile == "engine-monitor/1", "explicit capability profile")
	var load_result: Dictionary = await bridge.handle_request(request("load"))
	require_ok(load_result.get("result", {}).get("loaded") == true, "normal base load succeeds")
	var snapshot_before: Dictionary = await bridge.handle_request(request("snapshot"))
	var envelope: Dictionary = await bridge.handle_request(request("engine-performance", {"nonce": NONCE}))
	require_ok(envelope.result.nonce == NONCE and envelope.result.worldId == "bridge-engine-world" and envelope.result.buildId == "build-native" and envelope.result.instanceId == "instance-native", "challenge and bound identity returned")
	require_ok(envelope.result.sample.paused and envelope.result.sample.metrics.processTime.status == "unknown", "paused timing is unknown")
	for field in ["worldId", "buildId", "instanceId"]:
		var foreign := request("engine-performance", {"nonce": NONCE})
		foreign[field] = "foreign"
		require_ok((await bridge.handle_request(foreign)).get("error") == "ENGINE_PERFORMANCE_IDENTITY", "foreign " + field + " refused")
	for args in [{}, {"nonce": "short"}, {"nonce": NONCE, "monitor": "TIME_PROCESS"}]:
		require_ok((await bridge.handle_request(request("engine-performance", args))).get("error") == "ENGINE_PERFORMANCE_NONCE", "invalid challenge shape refused")
	var extra := request("engine-performance", {"nonce": NONCE})
	extra["sample"] = {}
	require_ok((await bridge.handle_request(extra)).get("error") == "ENGINE_PERFORMANCE_REQUEST_FIELDS", "extra request data refused")
	for bad_id in ["1", -1, 1.5, true]:
		var invalid_id := request("engine-performance", {"nonce": NONCE})
		invalid_id["id"] = bad_id
		require_ok((await bridge.handle_request(invalid_id)).get("error") == "ENGINE_PERFORMANCE_REQUEST_ID", "non-protocol request ID refused")
	var wire: Dictionary = JSON.parse_string(JSON.stringify(request("engine-performance", {"nonce": NONCE})))
	require_ok((await bridge.handle_request(wire)).has("result"), "JSON numeric request ID accepted")
	var snapshot_after: Dictionary = await bridge.handle_request(request("snapshot"))
	require_ok(snapshot_after == snapshot_before, "measurement and refusals preserve gameplay snapshot")
	var next: Dictionary = await bridge.handle_request(request("engine-performance", {"nonce": NONCE.replace("a", "b")}))
	require_ok(next.result.sample.sequence == envelope.result.sample.sequence + 2, "invalid requests never sample collector")
	await bridge.handle_request(request("resume"))
	await get_tree().create_timer(1.3).timeout
	var active: Dictionary = await bridge.handle_request(request("engine-performance", {"nonce": NONCE.replace("a", "c")}))
	require_ok(not active.result.sample.paused and active.result.sample.metrics.processTime.status == "measured", "active engine timing available")
	print("ENGINE_BRIDGE_RESULT=" + JSON.stringify({"checks": checks, "capabilities": capabilities.result, "paused": envelope.result, "active": active.result, "snapshotUnchanged": snapshot_after == snapshot_before}))
	get_tree().quit(0)
