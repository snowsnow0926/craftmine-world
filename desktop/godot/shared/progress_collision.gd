extends RefCounted

const PROFILE := "creation-player-collision/1"
const CONTACT_TOLERANCE := 0.001
# The pinned Web physics solver can leave a resting capsule 0.001028657 m
# below a flat support. Keep the one-millimetre wall limit; permit at most
# another 0.1 mm only at the real capsule's bottom pole, pointing straight up.
# This neither shrinks the query shape nor relocates saved progress.
const FLOOR_NUMERIC_ALLOWANCE := 0.0001
const MAX_HITS := 64

func _failure(reason: String) -> Dictionary:
	return {"profile":PROFILE,"status":"inconclusive","reason":reason}

func inspect(scene: Node3D, saved_player: Dictionary, before: Dictionary, current: Dictionary) -> Dictionary:
	if current.get("status") != "supported": return _failure("CONTROLLER_UNSUPPORTED")
	for key in ["playerId", "playerScriptId", "rigId", "rigScriptId", "pivotId", "cameraId"]:
		if before.get(key) != current.get(key): return _failure("CONTROLLER_CHANGED")
	if before.shape.id != current.shape.id or before.shape.resourceId != current.shape.resourceId: return _failure("SHAPE_CHANGED")
	var player := scene.get_node_or_null("Player") as CharacterBody3D
	var shape_node := scene.get_node_or_null("Player/CollisionShape3D") as CollisionShape3D
	if player == null or shape_node == null or not shape_node.shape is CapsuleShape3D: return _failure("BODY_UNAVAILABLE")
	var owners: Array = player.get_shape_owners()
	if owners.size() != 1: return _failure("BODY_UNAVAILABLE")
	var native_transform: Transform3D = player.global_transform * player.shape_owner_get_transform(owners[0])
	if not native_transform.is_equal_approx(shape_node.global_transform): return _failure("NATIVE_SHAPE_TRANSFORM_MISMATCH")
	var p: Variant = saved_player.get("position")
	if not p is Array or p.size() != 3: return _failure("POSE_INVALID")
	for n in p:
		if not (n is int or n is float) or not is_finite(float(n)) or absf(float(n)) > 100000: return _failure("POSE_INVALID")
	var expected := Vector3(p[0],p[1],p[2])
	if player.global_position.distance_to(expected) > 0.0001: return _failure("RESTORED_POSE_MISMATCH")
	for key in ["yaw", "pitch"]:
		var value: Variant = saved_player.get(key)
		if not (value is int or value is float) or not is_finite(float(value)) or absf(float(current.cameraTransform[key]) - float(value)) > 0.0001: return _failure("RESTORED_LOOK_MISMATCH")
	var query := PhysicsShapeQueryParameters3D.new()
	# Query the actual full-size native shape. No AABB or shrunken capsule can
	# turn wall penetration into clearance. Contact points supply the tolerance.
	query.shape = shape_node.shape
	query.transform = native_transform
	query.collision_mask = player.collision_mask
	query.exclude = [player.get_rid()]
	query.collide_with_areas = false
	query.collide_with_bodies = true
	query.margin = 0.0
	var space := scene.get_world_3d().direct_space_state
	var hits := space.intersect_shape(query, MAX_HITS + 1)
	if hits.size() > MAX_HITS: return _failure("HIT_BUDGET")
	var points := space.collide_shape(query, MAX_HITS + 1)
	if points.size() >= MAX_HITS * 2 or points.size() % 2 != 0: return _failure("CONTACT_BUDGET")
	if not hits.is_empty() and points.is_empty(): return _failure("CONTACTS_UNAVAILABLE")
	var depth := 0.0
	var support_depth := 0.0
	var penetration := false
	var foot: Vector3 = native_transform.origin - Vector3.UP * (shape_node.shape.height * 0.5)
	for i in range(0, points.size(), 2):
		var separation: Vector3 = points[i + 1] - points[i]
		var distance: float = separation.length()
		if not is_finite(distance): return _failure("CONTACTS_INVALID")
		depth = maxf(depth, distance)
		if distance <= CONTACT_TOLERANCE: continue
		var pole_offset: Vector3 = points[i] - foot
		var flat_support := separation.normalized().dot(Vector3.UP) >= 0.99999 and pole_offset.length() <= FLOOR_NUMERIC_ALLOWANCE
		if flat_support and distance <= CONTACT_TOLERANCE + FLOOR_NUMERIC_ALLOWANCE:
			support_depth = maxf(support_depth, distance)
		else:
			penetration = true
	var bodies: Array = []
	for hit in hits:
		var body: Variant = hit.get("collider")
		if not body is CollisionObject3D or not is_instance_valid(body) or not scene.is_ancestor_of(body): return _failure("COLLIDER_UNAVAILABLE")
		bodies.append({"id":str(body.get_instance_id()),"nodePath":str(scene.get_path_to(body)),"shape":hit.shape})
	return {"profile":PROFILE,"status":"failed" if penetration else "passed","reason":"PLAYER_PENETRATION" if penetration else "","playerId":current.playerId,"shapeId":current.shape.id,"shapeResourceId":current.shape.resourceId,"position":[player.global_position.x,player.global_position.y,player.global_position.z],"maxContactDepth":depth,"contactTolerance":CONTACT_TOLERANCE,"flatSupportTolerance":CONTACT_TOLERANCE + FLOOR_NUMERIC_ALLOWANCE,"maxNumericSupportDepth":support_depth,"bodies":bodies}
