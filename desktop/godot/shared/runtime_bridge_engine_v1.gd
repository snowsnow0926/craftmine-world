extends "res://craftmine_shared/runtime_bridge_base.gd"
## Explicit opt-in extension. The original runtime bridge remains a separate pinned file.
const EngineCollector = preload("res://craftmine_shared/engine_performance.gd")
const ENGINE_PROFILE := "engine-monitor/1"
const ENGINE_ENVELOPE := "craftmine.godot-engine-performance-envelope/1"
var _engine_collector := EngineCollector.new()
var _engine_identity_pattern := RegEx.create_from_string("^[a-zA-Z0-9._-]{1,128}$")
var _engine_nonce_pattern := RegEx.create_from_string("^[a-f0-9]{64}$")

func handle_request(request: Dictionary) -> Dictionary:
	if request.get("op") == "creation-preview":
		return _creation_preview(request)
	if request.get("op") in ["load", "restore-state", "snapshot", "save", "resume", "exit", "observe", "observe-envelope"]:
		_clear_creation_preview()
	if request.get("op") == "engine-performance":
		return _engine_performance(request)
	var response := await super.handle_request(request)
	if request.get("op") == "capabilities" and response.get("result") is Dictionary:
		var result: Dictionary = response.result.duplicate(true)
		var operations: Array = result.ops.duplicate()
		operations.append("engine-performance")
		operations.append("creation-preview")
		result["creationPreviewProfile"] = "stock-transform/1"
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

# A temporary engine-rendered mesh tree. No source, progress, collision or
# authored node is changed; every authoritative observation clears it first.
const PREVIEW_GENERATOR_PINS := ["77f10dffb771464e13f77301fa9dcba180f431b80dc34b1b3e396dc55c84f615","83011755993e07253e3792be98ffc1d731d86cfea7c04089c22e9d1ff5dffcc5"]
var _preview_nodes := 0
var _preview_root: Node3D
var _preview_id := ""
var _preview_sequence := -1
var _preview_until := 0

func _process(delta: float) -> void:
	super._process(delta)
	if _preview_root != null and Time.get_ticks_msec() >= _preview_until:
		_clear_creation_preview()

func _clear_creation_preview() -> void:
	if is_instance_valid(_preview_root):
		_preview_root.free()
	_preview_root = null

func _preview_vector(value: Variant, lower: Vector3, upper: Vector3) -> bool:
	if not value is Array or value.size() != 3: return false
	for axis in range(3):
		if not (value[axis] is float or value[axis] is int) or not is_finite(float(value[axis])) or value[axis] < lower[axis] or value[axis] > upper[axis]: return false
	return true

func _preview_meshes(source: Node, parent_transform: Transform3D, destination: Node3D, tint: Color, depth: int = 0) -> bool:
	_preview_nodes += 1
	if _preview_nodes > 128 or depth > 16: return false
	var local := parent_transform
	if source is Node3D: local = parent_transform * source.transform
	if source is MeshInstance3D and source.mesh != null:
		var copy := MeshInstance3D.new()
		copy.mesh = source.mesh
		copy.transform = local
		var material := StandardMaterial3D.new()
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.albedo_color = tint
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		copy.material_override = material
		copy.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		destination.add_child(copy)
	for child in source.get_children():
		if not _preview_meshes(child, local, destination, tint, depth + 1): return false
	return true

func _creation_preview(request: Dictionary) -> Dictionary:
	if not initialized or not loaded or adapter.BASE_ID != "creation-sandbox" or not get_tree().paused:
		return {"error": "CREATION_PREVIEW_NOT_PAUSED"}
	for key in ["worldId", "buildId", "instanceId"]:
		if not scope.has(key) or request.get(key) != scope[key]: return {"error": "CREATION_PREVIEW_IDENTITY"}
	var args: Variant = request.get("args")
	if not args is Dictionary or not args.get("previewId") is String or _engine_identity_pattern.search(args.previewId) == null or not (args.get("sequence") is int or args.get("sequence") is float) or args.sequence < 0 or floor(float(args.sequence)) != float(args.sequence): return {"error": "CREATION_PREVIEW_INVALID"}
	if args.previewId == _preview_id and args.sequence <= _preview_sequence: return {"error": "CREATION_PREVIEW_SUPERSEDED"}
	if args.get("action") == "cancel":
		if args.previewId == _preview_id:
			_preview_sequence = int(args.sequence)
			_clear_creation_preview()
		return {"result": {"status": "cancelled", "previewId": args.previewId}}
	if args.get("action") not in ["place", "modify"] or not _preview_vector(args.get("position"), Vector3(-28,0,-28), Vector3(28,16,28)) or not _preview_vector(args.get("scale"), Vector3.ONE * 0.25, Vector3.ONE * 4) or not (args.get("rotationY") is float or args.get("rotationY") is int) or not is_finite(float(args.rotationY)) or absf(float(args.rotationY)) > 180: return {"error": "CREATION_PREVIEW_INVALID"}
	play_action.cancel()
	for action in InputMap.get_actions(): Input.action_release(action)
	var world: Node = adapter.world()
	if not world.get_script() is GDScript or world.get_script().get_source_code().sha256_text() not in PREVIEW_GENERATOR_PINS: return {"error": "CREATION_PREVIEW_SOURCE_UNSUPPORTED"}
	var entity_id: String = args.get("targetId", "")
	var definition: Dictionary
	if args.action == "modify":
		if not world.entities.has(entity_id): return {"error": "CREATION_PREVIEW_TARGET_CHANGED"}
		definition = world.entities[entity_id].duplicate(true)
	else:
		if args.get("kind") not in ["tree", "rock", "chest", "door", "marker"]: return {"error": "CREATION_PREVIEW_KIND_UNSUPPORTED"}
		definition = {"id": "visual-preview", "kind": args.kind, "position": [0,0,0], "rotationY": 0, "scale": [1,1,1], "color": "#84A866", "parameters": {}}
	var position := Vector3(args.position[0], args.position[1], args.position[2])
	var scale_value := Vector3(args.scale[0], args.scale[1], args.scale[2])
	var basis := Basis(Vector3.UP, deg_to_rad(float(args.rotationY))).scaled(scale_value)
	var half: Vector3 = world.HALF_EXTENTS[definition.kind]
	var extent := basis.x.abs() * half.x + basis.y.abs() * half.y + basis.z.abs() * half.z
	var center := position + basis * Vector3(0,half.y,0)
	var problem := ""
	if center.x - extent.x < -28 or center.x + extent.x > 28 or center.z - extent.z < -28 or center.z + extent.z > 28 or center.y + extent.y > 16: problem = "CREATION_OUT_OF_BOUNDS"
	var query := PhysicsShapeQueryParameters3D.new()
	var shape := BoxShape3D.new()
	shape.size = half * 2 * scale_value - Vector3.ONE * 0.002
	query.shape = shape
	query.transform = Transform3D(Basis(Vector3.UP, deg_to_rad(float(args.rotationY))), center)
	query.collision_mask = 11
	if args.action == "modify":
		var body: Node = world.entity_nodes[entity_id].get_node_or_null("Body")
		if body is CollisionObject3D: query.exclude = [body.get_rid()]
	if not world.get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty(): problem = "CREATION_OCCUPIED"
	_clear_creation_preview()
	_preview_id = args.previewId
	_preview_sequence = int(args.sequence)
	_preview_until = Time.get_ticks_msec() + 60000
	_preview_root = Node3D.new()
	_preview_root.name = "CraftmineTemporaryPlacementPreview"
	_preview_root.transform = Transform3D(basis, position)
	var tint := Color(0.2,0.9,1,0.42) if problem.is_empty() else Color(1,0.2,0.15,0.5)
	_preview_nodes = 0
	var copied := true
	if args.action == "modify":
		for child in world.entity_nodes[entity_id].get_children():
			if not _preview_meshes(child, Transform3D.IDENTITY, _preview_root, tint): copied = false; break
	else:
		# Main verifies the exact shipped stock generator before granting this op.
		# The holder never enters the scene tree, so _ready/input/physics do not run.
		var holder := Node3D.new()
		holder.set_script(world.get_script())
		holder.creation_font = world.creation_font
		holder._create_entity(definition)
		for child in holder.entity_nodes[definition.id].get_children():
			if not _preview_meshes(child, Transform3D.IDENTITY, _preview_root, tint): copied = false; break
		holder.free()
	if not copied:
		_clear_creation_preview()
		return {"error": "CREATION_PREVIEW_GEOMETRY_LIMIT"}
	world.add_child(_preview_root)
	return {"result": {"format": "craftmine.creation-preview/1", "previewId": _preview_id, "sequence": _preview_sequence, "status": "visible", "valid": problem.is_empty(), "reason": problem, "expiresInMs": 60000}}
