extends RefCounted

const PROFILE := "creation-fixed-controller/1"
const FORMAT := "craftmine.creation-controller-evidence/1"
const WALK_FORMAT := "craftmine.creation-controller-walk/1"
const PlayerScript = preload("res://scripts/reused/player_controller.gd")
const RigScript = preload("res://scripts/reused/camera_rig.gd")
const PARAMETERS := [4.5, 1.7, 4.2, 14.0, 3.0, 1.0, 30.0, 9.8]

func _id(value: Variant) -> String:
	return str(value.get_instance_id()) if value is Object and is_instance_valid(value) else ""

func _v(value: Vector3) -> Array:
	return [value.x, value.y, value.z]

func _near(a: Array, b: Array) -> bool:
	if a.size() != b.size(): return false
	for i in a.size():
		if not is_finite(float(a[i])) or absf(float(a[i]) - float(b[i])) > 0.00001: return false
	return true

func sample(world: Node, tick: int) -> Dictionary:
	var result := {"format": FORMAT, "profile": PROFILE, "status": "unsupported", "reason": "PLAYER_MISSING", "physicsTick": tick}
	if not is_instance_valid(world): return result
	var player := world.get_node_or_null("Player") as CharacterBody3D
	if player == null: return result
	var script: Script = player.get_script()
	result.merge({"playerPath": "Player", "playerId": _id(player), "playerClass": player.get_class(), "playerScriptId": _id(script), "fixedPlayerScriptId": _id(PlayerScript), "playerScriptPath": script.resource_path if script != null else "", "rootPlayerId": _id(world.get("player"))})
	if script != PlayerScript:
		result.reason = "PLAYER_SCRIPT_MISMATCH"
		return result
	if result.rootPlayerId != result.playerId:
		result.reason = "ROOT_PLAYER_REFERENCE_MISMATCH"
		return result
	var rig := player.get_node_or_null("CameraRig") as Node3D
	var pivot := player.get_node_or_null("CameraRig/PitchPivot") as Node3D
	var camera := player.get_node_or_null("CameraRig/PitchPivot/Camera3D") as Camera3D
	if rig == null or pivot == null or camera == null:
		result.reason = "CAMERA_CHAIN_MISSING"
		return result
	var rig_script: Script = rig.get_script()
	result.merge({"rigPath": "Player/CameraRig", "rigId": _id(rig), "rigScriptId": _id(rig_script), "fixedRigScriptId": _id(RigScript), "rigScriptPath": rig_script.resource_path if rig_script != null else "", "playerRigId": _id(player.get("camera_rig")), "rigParentId": _id(rig.get_parent()), "pivotId": _id(pivot), "pivotParentId": _id(pivot.get_parent()), "cameraId": _id(camera), "cameraParentId": _id(camera.get_parent()), "rigCameraId": _id(rig.get("camera")), "rigPivotId": _id(rig.get("pitch_pivot")), "activeCameraId": _id(player.get_viewport().get_camera_3d())})
	if rig_script != RigScript or result.playerRigId != result.rigId or result.rigParentId != result.playerId or result.pivotParentId != result.rigId or result.cameraParentId != result.pivotId or result.rigCameraId != result.cameraId or result.rigPivotId != result.pivotId or result.activeCameraId != result.cameraId:
		result.reason = "CAMERA_BINDING_MISMATCH"
		return result
	var parameters: Array = []
	for key in ["move_speed", "sprint_multiplier", "jump_velocity", "acceleration", "air_acceleration", "gravity_scale", "max_fall_speed", "_gravity"]:
		parameters.append(player.get(key))
	result.parameters = parameters
	result.physicsRate = Engine.physics_ticks_per_second
	result.body = {"layer": player.collision_layer, "mask": player.collision_mask, "scale": _v(player.scale), "rotation": _v(player.rotation), "globalScale": _v(player.global_transform.basis.get_scale()), "physicsProcessing": player.is_physics_processing(), "processMode": player.process_mode}
	if not _near(parameters, PARAMETERS) or result.physicsRate != 60 or result.body.layer != 8 or result.body.mask != 3 or not result.body.physicsProcessing or result.body.processMode != Node.PROCESS_MODE_INHERIT or not _near(result.body.scale, [1,1,1]) or not _near(result.body.globalScale, [1,1,1]) or not _near(result.body.rotation, [0,0,0]):
		result.reason = "PLAYER_PARAMETERS_UNSUPPORTED"
		return result
	var shape_node := player.get_node_or_null("CollisionShape3D") as CollisionShape3D
	if shape_node == null or not shape_node.shape is CapsuleShape3D:
		result.reason = "PLAYER_SHAPE_UNSUPPORTED"
		return result
	var shape := shape_node.shape as CapsuleShape3D
	var owners: Array = player.get_shape_owners()
	var shape_count := 0
	for owner in owners: shape_count += player.shape_owner_get_shape_count(owner)
	var owner_id: int = owners[0] if owners.size() == 1 else -1
	result.shape = {"id": _id(shape_node), "resourceId": _id(shape), "bodyResourceId": _id(player.shape_owner_get_shape(owner_id, 0)) if owner_id >= 0 and shape_count == 1 else "", "kind": shape.get_class(), "radius": shape.radius, "height": shape.height, "disabled": shape_node.disabled, "ownerDisabled": player.is_shape_owner_disabled(owner_id) if owner_id >= 0 else true, "ownerCount": owners.size(), "shapeCount": shape_count, "ownerNodeId": _id(player.shape_owner_get_owner(owner_id)) if owner_id >= 0 else "", "position": _v(shape_node.position), "rotation": _v(shape_node.rotation), "scale": _v(shape_node.scale)}
	if shape_node.get_parent() != player or result.shape.ownerNodeId != result.shape.id or result.shape.resourceId != result.shape.bodyResourceId or result.shape.ownerCount != 1 or result.shape.shapeCount != 1 or result.shape.disabled or result.shape.ownerDisabled or absf(shape.radius - 0.3) > 0.00001 or absf(shape.height - 1.8) > 0.00001 or not _near(result.shape.position, [0,0,0]) or not _near(result.shape.rotation, [0,0,0]) or not _near(result.shape.scale, [1,1,1]):
		result.reason = "PLAYER_SHAPE_UNSUPPORTED"
		return result
	result.cameraTransform = {"rigPosition": _v(rig.position), "rigRotation": _v(rig.rotation), "rigScale": _v(rig.scale), "pivotPosition": _v(pivot.position), "pivotRotation": _v(pivot.rotation), "pivotScale": _v(pivot.scale), "cameraPosition": _v(camera.position), "cameraRotation": _v(camera.rotation), "cameraScale": _v(camera.scale), "pitchLimit": rig.get("pitch_limit_degrees"), "yaw": rig.get("yaw"), "pitch": rig.get("pitch")}
	if not _near(result.cameraTransform.rigPosition, [0,0.65,0]) or not _near(result.cameraTransform.rigRotation, [0,rig.get("yaw"),0]) or not _near(result.cameraTransform.rigScale, [1,1,1]) or not _near(result.cameraTransform.pivotPosition, [0,0,0]) or not _near(result.cameraTransform.pivotRotation, [rig.get("pitch"),0,0]) or not _near(result.cameraTransform.pivotScale, [1,1,1]) or not _near(result.cameraTransform.cameraPosition, [0,0,0]) or not _near(result.cameraTransform.cameraRotation, [0,0,0]) or not _near(result.cameraTransform.cameraScale, [1,1,1]) or result.cameraTransform.pitchLimit != 89.0:
		result.reason = "CAMERA_PARAMETERS_UNSUPPORTED"
		return result
	result.status = "supported"
	result.reason = ""
	return result

func _drive(world: Node, player: Node, axis: Vector2, frames: int, tick: Callable, state: Dictionary) -> void:
	var before := sample(world, tick.call())
	if before.status != "supported" or before.playerId != state.initial.playerId or before.cameraId != state.initial.cameraId or before.shape.resourceId != state.initial.shape.resourceId:
		state.failure = before
		return
	state.before = before
	state.last = before
	state.checkedTicks.append(before.physicsTick)
	state.bindingTrace.append(_binding_row(before))
	state.started = true
	await player.call("walk", axis, frames)
	state.finished = true

func _binding_row(e: Dictionary) -> Array:
	return [e.physicsTick, e.playerId, e.playerScriptId, e.rigId, e.rigScriptId, e.cameraId, e.activeCameraId, e.shape.id, e.shape.resourceId]

func walk(world: Node, axis: Vector2, frames: int, tick: Callable) -> Dictionary:
	var first := sample(world, tick.call())
	if first.status != "supported": return {"error": "CONTROLLER_PROFILE_UNSUPPORTED:" + first.reason, "controllerEvidence": first}
	# Resolve once through the real tree. Never dispatch through root.player.
	var player := world.get_node("Player") as CharacterBody3D
	var tree := world.get_tree()
	var state := {"initial":first, "before":first, "last":first, "started": false, "finished": false, "failure":{}, "checkedTicks":[], "bindingTrace":[]}
	# Native physics signal monitoring stays active independently of an authored
	# coroutine. Do not wait on render/process frames: one render may contain
	# several physics ticks, all of which must be checked.
	var monitor := func() -> void:
		if not state.started or not state.failure.is_empty(): return
		var current := sample(world, tick.call())
		if current.status != "supported" or current.playerId != first.playerId or current.rigId != first.rigId or current.cameraId != first.cameraId or current.shape.id != first.shape.id or current.shape.resourceId != first.shape.resourceId or current.physicsTick <= state.last.physicsTick:
			state.failure = current
			return
		state.checkedTicks.append(current.physicsTick)
		state.bindingTrace.append(_binding_row(current))
		state.last = current
	tree.physics_frame.connect(monitor)
	_drive.call_deferred(world, player, axis, frames, tick, state)
	for frame in frames + 4:
		await tree.physics_frame
		if state.finished or not state.failure.is_empty(): break
	tree.physics_frame.disconnect(monitor)
	if not state.failure.is_empty(): return {"error":"CONTROLLER_BINDING_CHANGED_DURING_WALK", "controllerEvidence":state.failure, "checkedFrameCount":state.checkedTicks.size()}
	if not state.finished: return {"error": "CONTROLLER_WALK_NOT_COMPLETED", "controllerEvidence": state.last}
	var before: Dictionary = state.before
	var last: Dictionary = state.last
	return {"result": {"controllerWalk": {"format": WALK_FORMAT, "profile": PROFILE, "playerId": before.playerId, "cameraId": before.cameraId, "shapeId": before.shape.id, "requestedFrames": frames, "completedFrames": frames, "checkedTicks": state.checkedTicks, "bindingTrace": state.bindingTrace, "startedTick": before.physicsTick, "finishedTick": last.physicsTick, "before": before, "after": last}}}
