extends "res://craftmine_shared/scene_mesh_picker.gd"

# Versioned observer: base surface triangles, never rendered pixels or active LOD.
# The legacy file remains a dependency so old adapter type inference stays valid.
const MAX_SURFACES := 16
const MAX_MESH_VERTICES := 12288
const MAX_VERTICES := 49152

func _answer(status: String, reason: String, counts: Dictionary, excluded: Array) -> Dictionary:
	var result := super._answer(status, reason, counts, excluded)
	result.scope = "bounded-static-base-mesh-triangles"
	result["geometryBasis"] = "base-surface-arrays"
	result["renderLodVerified"] = false
	return result

func _surface_material(node: MeshInstance3D, surface: int) -> Dictionary:
	if node.material_overlay != null: return {"reason": "material-overlay", "unbounded": true}
	var material: Material = node.material_override
	if material == null: material = node.get_surface_override_material(surface)
	if material == null: material = node.mesh.surface_get_material(surface)
	if material == null:
		if node.transparency > 0.0: return {"reason": "transparent-material", "unbounded": false}
		return {"cull": BaseMaterial3D.CULL_BACK}
	if material.get_script() != null or material.get_class() != "StandardMaterial3D": return {"reason": "custom-material", "unbounded": true}
	var standard := material as StandardMaterial3D
	if standard.billboard_mode != BaseMaterial3D.BILLBOARD_DISABLED or standard.grow or standard.fixed_size or standard.use_fov_override or standard.heightmap_enabled or standard.no_depth_test or standard.depth_draw_mode != 0 or standard.depth_test != 0 or standard.next_pass != null:
		return {"reason": "material-displacement-or-depth", "unbounded": true}
	if standard.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or standard.proximity_fade_enabled or standard.distance_fade_mode != BaseMaterial3D.DISTANCE_FADE_DISABLED or node.transparency > 0.0:
		return {"reason": "transparent-material", "unbounded": false}
	return {"cull": standard.cull_mode}

func _array_spec(instance: MeshInstance3D) -> Dictionary:
	var mesh := instance.mesh as ArrayMesh
	if instance.skin != null or mesh.get_blend_shape_count() != 0: return {"reason": "deformed-array-mesh", "unbounded": true}
	if mesh.custom_aabb != AABB() or instance.custom_aabb != AABB(): return {"reason": "custom-array-bounds", "unbounded": true}
	var count := mesh.get_surface_count()
	if count > MAX_SURFACES: return {"reason": "surface-budget", "unbounded": true}
	var specs := []
	var triangles := 0
	var vertices := 0
	var reason := ""
	for index in count:
		var format := mesh.surface_get_format(index)
		# Deformation or vertex updates can invalidate the ordinary static AABB.
		if format & (Mesh.ARRAY_FORMAT_BONES | Mesh.ARRAY_FORMAT_WEIGHTS | Mesh.ARRAY_FLAG_USE_2D_VERTICES | Mesh.ARRAY_FLAG_USE_DYNAMIC_UPDATE):
			return {"reason": "unsupported-array-format", "unbounded": true}
		var length := mesh.surface_get_array_len(index)
		var indices := mesh.surface_get_array_index_len(index)
		vertices += length
		if length < 0 or indices < 0 or vertices > MAX_MESH_VERTICES: return {"reason": "mesh-vertex-budget", "unbounded": true}
		var elements := indices if indices > 0 else length
		if elements > MAX_MESH_TRIANGLES * 3: return {"reason": "mesh-triangle-budget", "unbounded": true}
		if mesh.surface_get_primitive_type(index) != Mesh.PRIMITIVE_TRIANGLES or elements % 3 != 0: reason = "unsupported-surface-primitive"
		triangles += elements / 3
		if triangles > MAX_MESH_TRIANGLES: return {"reason": "mesh-triangle-budget", "unbounded": true}
		var material := _surface_material(instance, index)
		if material.get("unbounded", false): return material
		if material.has("reason"): reason = material.reason
		specs.append({"surface": index, "vertices": length, "indices": indices, "triangles": elements / 3, "cull": material.get("cull", 0)})
	return {"surfaces": specs, "triangles": triangles, "vertices": vertices, "reason": reason}

func _candidate_surfaces(candidate: Dictionary, counts: Dictionary) -> Dictionary:
	if candidate.mesh.get_class() != "ArrayMesh":
		var faces: PackedVector3Array = candidate.mesh.get_faces()
		counts.facesRead += 1
		if faces.size() != candidate.triangles * 3: return {"reason": "mesh-changed-or-count-mismatch"}
		return {"surfaces": [{"faces": faces, "surface": 0, "cull": candidate.cull}]}
	var mesh := candidate.mesh as ArrayMesh
	if mesh.get_surface_count() != candidate.surfaces.size(): return {"reason": "mesh-changed-or-count-mismatch"}
	var surfaces := []
	for spec in candidate.surfaces:
		var arrays := mesh.surface_get_arrays(spec.surface)
		counts.facesRead += 1
		if arrays.size() != Mesh.ARRAY_MAX or not arrays[Mesh.ARRAY_VERTEX] is PackedVector3Array: return {"reason": "invalid-surface-arrays"}
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		if vertices.size() != spec.vertices: return {"reason": "mesh-changed-or-count-mismatch"}
		for vertex in vertices:
			if not _finite(vertex): return {"reason": "invalid-surface-vertex"}
		var indices := PackedInt32Array()
		if arrays[Mesh.ARRAY_INDEX] != null:
			if not arrays[Mesh.ARRAY_INDEX] is PackedInt32Array: return {"reason": "invalid-surface-indices"}
			indices = arrays[Mesh.ARRAY_INDEX]
		if indices.size() != spec.indices: return {"reason": "mesh-changed-or-count-mismatch"}
		var faces := PackedVector3Array()
		if indices.is_empty(): faces = vertices
		else:
			for index in indices:
				if index < 0 or index >= vertices.size(): return {"reason": "invalid-surface-index"}
				faces.append(vertices[index])
		surfaces.append({"faces": faces, "surface": spec.surface, "cull": spec.cull})
	return {"surfaces": surfaces}

func pick(world_root: Node3D, camera: Camera3D, exclude_nodes: Array[Node], physics_hit: Dictionary = {}) -> Dictionary:
	var counts := {"nodes": 0, "candidates": 0, "triangles": 0, "facesRead": 0, "vertices": 0}
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
		if not mesh.get_class() in ["ArrayMesh", "BoxMesh", "SphereMesh", "CapsuleMesh", "CylinderMesh"]: return _answer("fallback", "unsupported-mesh-type", counts, excluded)
		var spec := {}
		if mesh.get_class() == "ArrayMesh":
			spec = _array_spec(instance)
			if spec.get("unbounded", false): return _answer("fallback", spec.reason, counts, excluded)
		var triangles: int = spec.get("triangles", 0)
		if mesh.get_class() == "BoxMesh":
			var box := mesh as BoxMesh
			var w := box.subdivide_width + 1
			var h := box.subdivide_height + 1
			var d := box.subdivide_depth + 1
			if w > 32 or h > 32 or d > 32: return _answer("fallback", "mesh-triangle-budget", counts, excluded)
			triangles = 4 * (w * h + w * d + h * d)
			if triangles > MAX_MESH_TRIANGLES: return _answer("fallback", "mesh-triangle-budget", counts, excluded)
		var bounds: Variant = mesh.get_aabb() if mesh.get_class() == "ArrayMesh" else _bounds(mesh)
		if bounds == null: return _answer("fallback", "unsupported-mesh-bounds", counts, excluded)
		if not _finite(bounds.position) or not _finite(bounds.size): return _answer("fallback", "invalid-mesh-bounds", counts, excluded)
		var transform := instance.global_transform
		if not _finite(transform.origin) or not _finite(transform.basis.x) or not _finite(transform.basis.y) or not _finite(transform.basis.z) or absf(transform.basis.determinant()) < EPS:
			return _answer("fallback", "invalid-transform", counts, excluded)
		var material := {"reason": spec.get("reason", ""), "cull": 0} if mesh.get_class() == "ArrayMesh" else _material(instance)
		if material.get("unbounded", false): return _answer("fallback", material.reason, counts, excluded)
		if instance.skin != null: return _answer("fallback", "skinned-mesh", counts, excluded)
		if instance.transparency > 0.0: material["reason"] = "transparent-material"
		var world_bounds: AABB = transform * (bounds as AABB)
		if not _finite(world_bounds.position) or not _finite(world_bounds.size): return _answer("fallback", "invalid-world-bounds", counts, excluded)
		var distance := _entry(world_bounds, origin, endpoint)
		if distance == INF: continue
		counts.candidates += 1
		if counts.candidates > MAX_CANDIDATES: return _answer("fallback", "candidate-budget", counts, excluded)
		var reason: String = material.get("reason", "")
		if instance.skin != null: reason = "skinned-mesh"
		if not mesh.get_class() in ["BoxMesh", "ArrayMesh"]: reason = "unsupported-mesh-type"
		if transform.basis.determinant() < 0: reason = "negative-scale"
		if instance.visibility_range_begin != 0 or instance.visibility_range_end != 0 or instance.get_visibility_parent() != NodePath(""):
			reason = "visibility-range-or-parent"
		if not reason.is_empty():
			unknown.append({"distance": distance, "reason": reason})
			continue
		counts.vertices += int(spec.get("vertices", 0))
		if counts.vertices > MAX_VERTICES: return _answer("fallback", "vertex-budget", counts, excluded)
		counts.triangles += triangles
		if counts.triangles > MAX_TRIANGLES: return _answer("fallback", "triangle-budget", counts, excluded)
		candidates.append({"node": instance, "mesh": mesh, "transform": transform, "triangles": triangles, "cull": material.cull, "surfaces": spec.get("surfaces", [])})
	# No faces are fetched until the entire candidate/budget preflight completes.
	var nearest: Dictionary = {}
	var nearest_distance := INF
	var ambiguous := false
	for candidate in candidates:
		var fetched := _candidate_surfaces(candidate, counts)
		if fetched.has("reason"): return _answer("fallback", fetched.reason, counts, excluded)
		var transform: Transform3D = candidate.transform
		var inverse := transform.affine_inverse()
		var local_from := inverse * origin
		var local_to := inverse * endpoint
		var triangle_offset := 0
		for surface in fetched.surfaces:
			var faces: PackedVector3Array = surface.faces
			for index in range(0, faces.size(), 3):
				var cross := (faces[index + 1] - faces[index]).cross(faces[index + 2] - faces[index])
				if cross.length_squared() <= 0.000000000001: continue
				# Godot considers clockwise winding front-facing.
				var front := cross.dot(local_to - local_from) > 0.0
				if surface.cull == BaseMaterial3D.CULL_BACK and not front: continue
				if surface.cull == BaseMaterial3D.CULL_FRONT and front: continue
				var hit: Variant = Geometry3D.segment_intersects_triangle(local_from, local_to, faces[index], faces[index + 1], faces[index + 2])
				if hit == null: continue
				var position: Vector3 = transform * (hit as Vector3)
				var distance := origin.distance_to(position)
				if distance < nearest_distance - EPS:
					var normal: Vector3 = (inverse.basis.transposed() * -cross).normalized()
					if normal.dot(direction) > 0: normal = -normal
					nearest = {"node": candidate.node, "objectId": str(candidate.node.get_instance_id()), "position": position, "normal": normal, "triangleIndex": triangle_offset + index / 3, "surfaceIndex": surface.surface, "surfaceTriangleIndex": index / 3}
					nearest_distance = distance
					ambiguous = false
				elif absf(distance - nearest_distance) <= EPS and candidate.node != nearest.get("node"):
					ambiguous = true
			triangle_offset += faces.size() / 3
	for item in unknown:
		if item.distance <= minf(nearest_distance, physics_distance) + EPS: return _answer("fallback", item.reason, counts, excluded)
	if physics_distance != INF and physics_distance <= nearest_distance + EPS: return _answer("blocked", "nearer-or-tied-physics-hit", counts, excluded)
	if ambiguous: return _answer("fallback", "ambiguous-coincident-meshes", counts, excluded)
	if nearest.is_empty(): return _answer("none", "no-supported-triangle-hit", counts, excluded)
	var answer := _answer("hit", "nearest-supported-triangle", counts, excluded)
	answer.merge(nearest)
	answer.distance = nearest_distance
	return answer
