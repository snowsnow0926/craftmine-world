extends "res://craftmine_shared/runtime_bridge_base.gd"
## Explicit opt-in extension. The original runtime bridge remains a separate pinned file.
const EngineCollector = preload("res://craftmine_shared/engine_performance.gd")
const ENGINE_PROFILE := "engine-monitor/1"
const ENGINE_ENVELOPE := "craftmine.godot-engine-performance-envelope/1"
var _engine_collector := EngineCollector.new()
var _engine_identity_pattern := RegEx.create_from_string("^[a-zA-Z0-9._-]{1,128}$")
var _engine_nonce_pattern := RegEx.create_from_string("^[a-f0-9]{64}$")

func handle_request(request: Dictionary) -> Dictionary:
	if request.get("op") == "engine-performance":
		return _engine_performance(request)
	var response := await super.handle_request(request)
	if request.get("op") == "capabilities" and response.get("result") is Dictionary:
		var result: Dictionary = response.result.duplicate(true)
		var operations: Array = result.ops.duplicate()
		operations.append("engine-performance")
		result["ops"] = operations
		result["enginePerformanceProfile"] = ENGINE_PROFILE
		result["enginePerformanceFormat"] = ENGINE_ENVELOPE
		result["enginePerformanceNonce"] = "hex-64"
		return {"result": result}
	return response

func _engine_performance(request: Dictionary) -> Dictionary:
	if request.size() != 6:
		return {"error": "ENGINE_PERFORMANCE_REQUEST_FIELDS"}
	for key in ["id", "op", "args", "worldId", "buildId", "instanceId"]:
		if not request.has(key):
			return {"error": "ENGINE_PERFORMANCE_REQUEST_FIELDS"}
	# Web JSON parses numeric request IDs as floats; accept only positive safe integers.
	if not (request.id is int or request.id is float) or not is_finite(float(request.id)) or request.id < 1 or request.id > 9007199254740991 or floor(float(request.id)) != float(request.id):
		return {"error": "ENGINE_PERFORMANCE_REQUEST_ID"}
	if not request.args is Dictionary or request.args.size() != 1 or not request.args.get("nonce") is String or _engine_nonce_pattern.search(request.args.nonce) == null:
		return {"error": "ENGINE_PERFORMANCE_NONCE"}
	if not initialized or not loaded or scope.size() != 3:
		return {"error": "ENGINE_PERFORMANCE_NOT_LOADED"}
	for key in ["worldId", "buildId", "instanceId"]:
		if not request[key] is String or _engine_identity_pattern.search(request[key]) == null or not scope.has(key) or scope[key] != request[key]:
			return {"error": "ENGINE_PERFORMANCE_IDENTITY"}
	if request.worldId != ProjectSettings.get_setting("craftmine/runtime/world_id"):
		return {"error": "ENGINE_PERFORMANCE_PROJECT_WORLD"}
	return {"result": {"format": ENGINE_ENVELOPE, "profile": ENGINE_PROFILE,
		"worldId": scope.worldId, "buildId": scope.buildId, "instanceId": scope.instanceId,
		"nonce": request.args.nonce, "sample": _engine_collector.sample()}}
