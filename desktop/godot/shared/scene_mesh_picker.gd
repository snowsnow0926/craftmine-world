extends RefCounted

# Fixed observer prototype. No collider creation, script calls, state mutation,
# resource cache or claims about rendered pixels. Integration must pin this file.
const MAX_NODES := 512
const MAX_CANDIDATES := 64
const MAX_MESH_TRIANGLES := 4096
const MAX_TRIANGLES := 16384
const MAX_EXCLUSIONS := 8
const EPS := 0.00001
const MAX_DISTANCE := 80.0

func _finite(v: Vector3) -> bool:
	return v.is_finite() and maxf(absf(v.x), maxf(absf(v.y), absf(v.z))) <= 1000000.0

func _entry(box: AABB, from: Vector3, to: Vector3) -> float:
	var delta := to - from
	var low := 0.0
	var high := 1.0
	for axis in 3:
		if absf(delta[axis]) < EPS:
			if from[axis] < box.position[axis] - EPS or from[axis] > box.end[axis] + EPS: return INF
		else:
			var a: float = (box.position[axis] - from[axis]) / delta[axis]
			var b: float = (box.end[axis] - from[axis]) / delta[axis]
			low = maxf(low, minf(a, b))
			high = minf(high, maxf(a, b))
			if low > high: return INF
	return low * delta.length()

func _answer(status: String, reason: String, counts: Dictionary, excluded: Array) -> Dictionary:
	return {"status": status, "reason": reason, "scope": "bounded-static-mesh-triangles", "counts": counts.duplicate(), "excludedObjectIds": excluded.duplicate(), "blockRaySelection": status == "fallback", "pixelAccurate": false}

func _label_radius(bounds: AABB, basis: Basis) -> float:
	var far_corner := Vector3(maxf(absf(bounds.position.x), absf(bounds.end.x)), maxf(absf(bounds.position.y), absf(bounds.end.y)), maxf(absf(bounds.position.z), absf(bounds.end.z)))
	var lengths := Vector3(basis.x.length(), basis.y.length(), basis.z.length())
	var orthogonal := absf(basis.x.dot(basis.y)) <= EPS * lengths.x * lengths.y and absf(basis.x.dot(basis.z)) <= EPS * lengths.x * lengths.z and absf(basis.y.dot(basis.z)) <= EPS * lengths.y * lengths.z
	# Orthogonal axes use the tight maximum scale. A sheared basis requires the
	# conservative Frobenius bound; max axis length is not a spectral-norm bound.
	var scale_bound := maxf(lengths.x, maxf(lengths.y, lengths.z)) if orthogonal else lengths.length()
	return far_corner.length() * scale_bound

func _material(node: MeshInstance3D) -> Dictionary:
	if node.material_overlay != null: return {"reason": "material-overlay", "unbounded": true}
	var material: Material = node.material_override
	if material == null: material = node.get_surface_override_material(0)
	if material == null: material = (node.mesh as PrimitiveMesh).material
	if material == null: return {"cull": BaseMaterial3D.CULL_BACK}
	# Never run virtual methods on a project-authored script resource.
	if material.get_script() != null or material.get_class() != "StandardMaterial3D": return {"reason": "custom-material", "unbounded": true}
	var standard := material as StandardMaterial3D
	# The pinned engine's ordinary opaque depth draw/test values are both 0.
	if standard.billboard_mode != BaseMaterial3D.BILLBOARD_DISABLED or standard.grow or standard.fixed_size or standard.use_fov_override or standard.heightmap_enabled or standard.no_depth_test or standard.depth_draw_mode != 0 or standard.depth_test != 0 or standard.next_pass != null:
		return {"reason": "material-displacement-or-depth", "unbounded": true}
	if standard.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or standard.proximity_fade_enabled or standard.distance_fade_mode != BaseMaterial3D.DISTANCE_FADE_DISABLED or node.transparency > 0.0:
		return {"reason": "transparent-material", "unbounded": false}
	return {"cull": standard.cull_mode}

func _bounds(mesh: Mesh) -> Variant:
	# Built-in primitive property bounds avoid triggering lazy mesh generation.
	match mesh.get_class():
		"BoxMesh":
			var size: Vector3 = (mesh as BoxMesh).size.abs()
			return AABB(-size * 0.5, size)
		"SphereMesh":
			var value := mesh as SphereMesh
			var size := Vector3(value.radius * 2, value.height, value.radius * 2).abs()
			return AABB(-size * 0.5, size)
		"CapsuleMesh":
			var value := mesh as CapsuleMesh
			var size := Vector3(value.radius * 2, value.height, value.radius * 2).abs()
			return AABB(-size * 0.5, size)
		"CylinderMesh":
			var value := mesh as CylinderMesh
			var radius := maxf(value.top_radius, value.bottom_radius)
			var size := Vector3(radius * 2, value.height, radius * 2).abs()
			return AABB(-size * 0.5, size)
	return null

func pick(world_root: Node3D, camera: Camera3D, exclude_nodes: Array[Node], physics_hit: Dictionary = {}) -> Dictionary:
	var counts := {"nodes": 0, "candidates": 0, "triangles": 0, "facesRead": 0}
	var excluded := []
	if world_root == null or camera == null or not world_root.is_inside_tree() or not world_root.is_ancestor_of(camera) or exclude_nodes.size() > MAX_EXCLUSIONS:
		return _answer("fallback", "invalid-context", counts, excluded)
	if not camera.is_current() or camera.projection != Camera3D.PROJECTION_PERSPECTIVE:
		return _answer("fallback", "unsupported-or-inactive-camera", counts, excluded)
	for node in exclude_nodes:
		if node == null or not world_root.is_ancestor_of(node): return _answer("fallback", "invalid-exclusion", counts, excluded)
		excluded.append(str(node.get_instance_id()))
	var center := camera.get_viewport().get_visible_rect().size * 0.5
	var direction := camera.project_ray_normal(center).normalized()
	var origin := camera.project_ray_origin(center) + direction * camera.near
	var endpoint := origin + direction * minf(MAX_DISTANCE, camera.far - camera.near)
	if not _finite(origin) or not _finite(endpoint) or camera.far <= camera.near: return _answer("fallback", "invalid-ray", counts, excluded)
	var physics_distance := INF
	if not physics_hit.is_empty():
		var point: Variant = physics_hit.get("position")
		if not point is Vector3 or not _finite(point): return _answer("fallback", "invalid-physics-hit", counts, excluded)
		physics_distance = maxf(0.0, (point as Vector3).distance_to(origin))
	var queue: Array[Node] = [world_root]
	var candidates := []
	var unknown := []
	while not queue.is_empty():
		var node: Node = queue.pop_back()
		counts.nodes += 1
		if counts.nodes > MAX_NODES: return _answer("fallback", "node-budget", counts, excluded)
		if exclude_nodes.has(node): continue
		if node is Node3D and not (node as Node3D).is_visible_in_tree(): continue
		var children := node.get_child_count()
		if counts.nodes + queue.size() + children > MAX_NODES: return _answer("fallback", "node-budget", counts, excluded)
		for index in children: queue.append(node.get_child(index))
		if not node is GeometryInstance3D: continue
		var geometry := node as GeometryInstance3D
		if geometry.layers & camera.cull_mask == 0 or geometry.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY: continue
		if geometry.get_script() != null: return _answer("fallback", "scripted-geometry-node", counts, excluded)
		if not node is MeshInstance3D:
			# Labels are non-selectable. Their billboard-independent bounding sphere
			# is only an uncertainty blocker, never a claimed text/pixel hit.
			if node is Label3D:
				var label := node as Label3D
				if label.font != null and (label.font.get_script() != null or not label.font.get_class() in ["FontFile", "SystemFont"]): return _answer("fallback", "custom-label-font", counts, excluded)
				if label.fixed_size: return _answer("fallback", "fixed-size-label", counts, excluded)
				var bounds := label.get_aabb()
				if not _finite(bounds.position) or not _finite(bounds.size) or not _finite(label.global_position) or not _finite(label.global_basis.x) or not _finite(label.global_basis.y) or not _finite(label.global_basis.z): return _answer("fallback", "invalid-label-bounds", counts, excluded)
				var radius := _label_radius(bounds, label.global_basis)
				var distance := _entry(AABB(label.global_position - Vector3.ONE * radius, Vector3.ONE * radius * 2), origin, endpoint)
				if distance != INF: unknown.append({"distance": distance, "reason": "label-geometry"})
				continue
			return _answer("fallback", "unsupported-geometry-node", counts, excluded)
		var instance := node as MeshInstance3D
		var mesh := instance.mesh
		if mesh == null: continue
		if mesh.get_script() != null: return _answer("fallback", "scripted-mesh-resource", counts, excluded)
		# Multi-surface/LOD/material cases are not certified by this prototype.
		if not mesh.get_class() in ["BoxMesh", "SphereMesh", "CapsuleMesh", "CylinderMesh"]: return _answer("fallback", "unsupported-mesh-type", counts, excluded)
		var triangles := 0
		if mesh.get_class() == "BoxMesh":
			var box := mesh as BoxMesh
			var w := box.subdivide_width + 1
			var h := box.subdivide_height + 1
			var d := box.subdivide_depth + 1
			if w > 32 or h > 32 or d > 32: return _answer("fallback", "mesh-triangle-budget", counts, excluded)
			triangles = 4 * (w * h + w * d + h * d)
			if triangles > MAX_MESH_TRIANGLES: return _answer("fallback", "mesh-triangle-budget", counts, excluded)
		var bounds: Variant = _bounds(mesh)
		if bounds == null: return _answer("fallback", "unsupported-mesh-bounds", counts, excluded)
		if not _finite(bounds.position) or not _finite(bounds.size): return _answer("fallback", "invalid-mesh-bounds", counts, excluded)
		var transform := instance.global_transform
		if not _finite(transform.origin) or not _finite(transform.basis.x) or not _finite(transform.basis.y) or not _finite(transform.basis.z) or absf(transform.basis.determinant()) < EPS:
			return _answer("fallback", "invalid-transform", counts, excluded)
		var material := _material(instance)
		if material.get("unbounded", false): return _answer("fallback", material.reason, counts, excluded)
		var world_bounds: AABB = transform * (bounds as AABB)
		if not _finite(world_bounds.position) or not _finite(world_bounds.size): return _answer("fallback", "invalid-world-bounds", counts, excluded)
		var distance := _entry(world_bounds, origin, endpoint)
		if distance == INF: continue
		counts.candidates += 1
		if counts.candidates > MAX_CANDIDATES: return _answer("fallback", "candidate-budget", counts, excluded)
		var reason: String = material.get("reason", "")
		if instance.skin != null: reason = "skinned-mesh"
		if mesh.get_class() != "BoxMesh": reason = "unsupported-mesh-type"
		if transform.basis.determinant() < 0: reason = "negative-scale"
		if instance.visibility_range_begin != 0 or instance.visibility_range_end != 0 or instance.get_visibility_parent() != NodePath(""):
			reason = "visibility-range-or-parent"
		if not reason.is_empty():
			unknown.append({"distance": distance, "reason": reason})
			continue
		counts.triangles += triangles
		if counts.triangles > MAX_TRIANGLES: return _answer("fallback", "triangle-budget", counts, excluded)
		candidates.append({"node": instance, "mesh": mesh, "transform": transform, "triangles": triangles, "cull": material.cull})
	# No faces are fetched until the entire candidate/budget preflight completes.
	var nearest: Dictionary = {}
	var nearest_distance := INF
	var ambiguous := false
	for candidate in candidates:
		var faces: PackedVector3Array = candidate.mesh.get_faces()
		counts.facesRead += 1
		if faces.size() != candidate.triangles * 3: return _answer("fallback", "mesh-changed-or-count-mismatch", counts, excluded)
		var transform: Transform3D = candidate.transform
		var inverse := transform.affine_inverse()
		var local_from := inverse * origin
		var local_to := inverse * endpoint
		for index in range(0, faces.size(), 3):
			var cross := (faces[index + 1] - faces[index]).cross(faces[index + 2] - faces[index])
			if cross.length_squared() <= 0.000000000001: continue
			# Godot considers clockwise winding front-facing.
			var front := cross.dot(local_to - local_from) > 0.0
			if candidate.cull == BaseMaterial3D.CULL_BACK and not front: continue
			if candidate.cull == BaseMaterial3D.CULL_FRONT and front: continue
			var hit: Variant = Geometry3D.segment_intersects_triangle(local_from, local_to, faces[index], faces[index + 1], faces[index + 2])
			if hit == null: continue
			var position: Vector3 = transform * (hit as Vector3)
			var distance := origin.distance_to(position)
			if distance < nearest_distance - EPS:
				var normal: Vector3 = (inverse.basis.transposed() * -cross).normalized()
				if normal.dot(direction) > 0: normal = -normal
				nearest = {"node": candidate.node, "objectId": str(candidate.node.get_instance_id()), "position": position, "normal": normal, "triangleIndex": index / 3}
				nearest_distance = distance
				ambiguous = false
			elif absf(distance - nearest_distance) <= EPS and candidate.node != nearest.get("node"):
				ambiguous = true
	for item in unknown:
		if item.distance <= minf(nearest_distance, physics_distance) + EPS: return _answer("fallback", item.reason, counts, excluded)
	if physics_distance != INF and physics_distance <= nearest_distance + EPS: return _answer("blocked", "nearer-or-tied-physics-hit", counts, excluded)
	if ambiguous: return _answer("fallback", "ambiguous-coincident-meshes", counts, excluded)
	if nearest.is_empty(): return _answer("none", "no-supported-triangle-hit", counts, excluded)
	var answer := _answer("hit", "nearest-supported-triangle", counts, excluded)
	answer.merge(nearest)
	answer.distance = nearest_distance
	return answer
