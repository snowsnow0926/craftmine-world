extends RefCounted
const BASE_ID := "creation-sandbox"
const BASE_VERSION := "1.0.0"
const Guard = preload("res://craftmine_shared/state_guard.gd")
const Contract = preload("res://scripts/scene_contract.gd")
const MeshPicker = preload("res://craftmine_shared/scene_mesh_picker.gd")

func world() -> Node:
	return Engine.get_main_loop().current_scene

func is_ready() -> bool:
	return world() != null and world().get("ready_for_play") == true

func bind_world(id: String) -> String:
	var pattern := RegEx.new()
	pattern.compile("^[a-z0-9][a-z0-9-]{1,47}$")
	var match_id := pattern.search(id)
	if match_id == null or match_id.get_string() != id:
		return "Invalid creation world ID"
	world().world_id = id
	return ""

func capture() -> Dictionary:
	return world().capture()

func restore(body: Dictionary) -> String:
	var before := capture()
	var failure: String = world().restore(body)
	if not failure.is_empty():
		return failure
	var missing := Guard.omitted(body, capture())
	if not missing.is_empty():
		world().restore(before)
		return "Unsupported creation progress field: " + missing
	return ""

var observed_physics_tick: int = 0
var scene_object_refs: Dictionary = {}
var observed_target_collider: int = 0
var mesh_picker := MeshPicker.new()

func _target_camera() -> Camera3D:
	var camera := world().get_viewport().get_camera_3d()
	return camera if camera != null and world().is_ancestor_of(camera) else null

func _ray_hit(camera: Camera3D, player: Node, mask: int) -> Dictionary:
	var excluded: Array[RID] = []
	if player is CollisionObject3D: excluded.append(player.get_rid())
	for child in player.find_children("*", "CollisionObject3D", true, false): excluded.append(child.get_rid())
	var center := camera.get_viewport().get_visible_rect().size * 0.5
	var direction := camera.project_ray_normal(center).normalized()
	var origin := camera.project_ray_origin(center) + direction * camera.near
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * minf(80.0, camera.far - camera.near), mask, excluded)
	query.collide_with_areas = true
	return camera.get_world_3d().direct_space_state.intersect_ray(query)

func _helper_exclusions(player: Node, existing: Dictionary) -> Array[Node]:
	var excluded: Array[Node] = [player]
	# Existing base HUD references are excluded only when their actual native
	# geometry still has the narrow helper shape. No names/metadata grant exclusion.
	for field in ["marker", "selection_box"]:
		var node: Variant = world().get(field)
		if not node is MeshInstance3D or node.get_parent() != world() or node.get_script() != null or node.get_child_count() != 0 or node.mesh == null or node.mesh.get_script() != null: continue
		var material: Variant = node.material_override
		if not material is StandardMaterial3D or material.get_script() != null or material.shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED: continue
		if field == "marker" and node.mesh is SphereMesh and is_equal_approx(node.mesh.radius, 0.045) and is_equal_approx(node.mesh.height, 0.09): excluded.append(node)
		if field == "selection_box" and node.mesh is ImmediateMesh: excluded.append(node)
	# A current structured physics hit already establishes this entity. Other
	# visible entities remain in the mesh scan and may block an uncertain ray.
	if existing.get("surface") == "entity":
		for child in world().get_children():
			if str(child.name) == "Entity_" + str(existing.get("entityId", "")): excluded.append(child)
	return excluded

func _scene_node(node: Node) -> Dictionary:
	var script: Script = node.get_script() as Script
	return {"objectId": str(node.get_instance_id()), "nodePath": str(world().get_path_to(node)).left(513), "nodeClass": node.get_class().left(81), "scriptPath": script.resource_path.left(513) if script != null else "", "scenePath": node.scene_file_path.left(513)}

func _scene_ancestors(node: Node) -> Array:
	var result := []
	var ancestor := node.get_parent()
	while ancestor != null and ancestor != world() and result.size() < 4:
		result.append(_scene_node(ancestor))
		ancestor = ancestor.get_parent()
	return result

# Bounded read-only references from actual hits; project metadata is never identity.
func _scene_objects(existing: Dictionary) -> Dictionary:
	var camera := _target_camera()
	var player := world().get_node_or_null("Player")
	var selected: Variant = null
	var selection := {"status": "none", "reason": "no-current-camera"}
	if camera != null and player != null:
		var hit := _ray_hit(camera, player, 4294967295)
		var picked: Dictionary = mesh_picker.pick(world(), camera, _helper_exclusions(player, existing), hit)
		selection = {"status": picked.status, "reason": picked.reason, "counts": picked.counts}
		if picked.status == "fallback":
			hit = {}
		elif picked.status == "hit":
			var center := camera.get_viewport().get_visible_rect().size * 0.5
			var origin := camera.project_ray_origin(center) + camera.project_ray_normal(center).normalized() * camera.near
			# Physical interaction wins an exact surface tie. This is a precedence
			# rule, never a claim that a mesh and collider share object identity.
			if hit.is_empty() or origin.distance_to(picked.position) < origin.distance_to(hit.position) - MeshPicker.EPS:
				hit = {"collider": picked.node, "position": picked.position, "normal": picked.normal}
		if not hit.is_empty():
			var point: Vector3 = hit.position
			var collider := hit.collider as Node
			var stock_hit: bool = existing.get("surface") in ["ground", "entity", "boundary"] and collider != null and collider.get_instance_id() == observed_target_collider
			if not stock_hit and collider != null and world().is_ancestor_of(collider):
				var key := str(collider.get_instance_id())
				if not scene_object_refs.has(key):
					if scene_object_refs.size() >= 32: scene_object_refs.erase(scene_object_refs.keys()[0])
					scene_object_refs[key] = weakref(collider)
				selected = _scene_node(collider)
				selected["position"] = [point.x, point.y, point.z]
				selected["normal"] = [hit.normal.x, hit.normal.y, hit.normal.z]
				selected["ancestors"] = _scene_ancestors(collider)
	var live := []
	for key in scene_object_refs.keys():
		var node: Node = scene_object_refs[key].get_ref()
		if node == null or not node.is_inside_tree() or node.is_queued_for_deletion() or not world().is_ancestor_of(node):
			scene_object_refs.erase(key)
		else:
			var reference := _scene_node(node)
			reference["ancestors"] = _scene_ancestors(node)
			live.append(reference)
	return {"target": selected, "references": live, "selection": selection}

func _init() -> void:
	var tree := Engine.get_main_loop() as SceneTree
	if tree != null:
		tree.physics_frame.connect(_observe_physics_tick)

func _observe_physics_tick() -> void:
	var tree := Engine.get_main_loop() as SceneTree
	if tree != null and not tree.paused:
		observed_physics_tick += 1

func _actual_entity(node: Node3D, declared: Dictionary) -> Dictionary:
	var result := declared.duplicate(true)
	var position := node.global_position
	var scale := node.global_transform.basis.get_scale()
	result.position = [position.x, position.y, position.z]
	result.scale = [scale.x, scale.y, scale.z]
	result.rotationY = rad_to_deg(node.global_rotation.y)
	result.visible = false
	result.solid = false
	result.color = ""
	var mesh_bounds: Variant = null
	for child in node.find_children("*", "MeshInstance3D", true, false):
		var mesh_node := child as MeshInstance3D
		if mesh_node.mesh == null:
			continue
		if mesh_node.name == "CreationColorMesh":
			var material := mesh_node.get_active_material(0) as StandardMaterial3D
			if material != null:
				result.color = "#" + material.albedo_color.to_html(false)
		if not mesh_node.is_visible_in_tree():
			continue
		result.visible = true
		var bounds: AABB = mesh_node.global_transform * mesh_node.mesh.get_aabb()
		mesh_bounds = bounds if mesh_bounds == null else (mesh_bounds as AABB).merge(bounds)
	var blocking_bounds: Variant = null
	for child in node.find_children("*", "CollisionShape3D", true, false):
		var shape_node := child as CollisionShape3D
		var body := shape_node.get_parent() as PhysicsBody3D
		if body == null or not body.is_inside_tree() or body.process_mode == Node.PROCESS_MODE_DISABLED or body.collision_layer & 3 == 0 or shape_node.disabled or shape_node.shape == null:
			continue
		var shape_mesh := shape_node.shape.get_debug_mesh()
		if shape_mesh == null:
			continue
		result.solid = true
		var bounds: AABB = shape_node.global_transform * shape_mesh.get_aabb()
		blocking_bounds = bounds if blocking_bounds == null else (blocking_bounds as AABB).merge(bounds)
	if blocking_bounds != null:
		var bounds := blocking_bounds as AABB
		result["collisionBounds"] = {"min": [bounds.position.x, bounds.position.y, bounds.position.z], "max": [bounds.end.x, bounds.end.y, bounds.end.z]}
	if mesh_bounds != null:
		var bounds := mesh_bounds as AABB
		result["meshBounds"] = {"min": [bounds.position.x, bounds.position.y, bounds.position.z], "max": [bounds.end.x, bounds.end.y, bounds.end.z]}
	if declared.get("kind") == "door":
		var hinge := node.get_node_or_null("Hinge") as Node3D
		result.open = not result.solid and hinge != null and absf(hinge.rotation.y) >= PI / 3.0
	if declared.get("kind") == "chest":
		var lid := node.get_node_or_null("Lid") as Node3D
		result.opened = lid != null and lid.rotation.x < -0.1
	return result

func _actual_target(revision: int, actual: Array) -> Dictionary:
	observed_target_collider = 0
	var target := {"entityId": null, "position": null, "normal": null, "surface": "none", "revision": revision}
	var camera := _target_camera()
	var player := world().get_node_or_null("Player") as CollisionObject3D
	if camera == null or player == null:
		return target
	var hit := _ray_hit(camera, player, 7)
	if hit.is_empty():
		return target
	var point: Vector3 = hit.position
	var normal: Vector3 = hit.normal
	target.position = [point.x, point.y, point.z]
	target.normal = [normal.x, normal.y, normal.z]
	var collider := hit.collider as Node
	target.surface = collider.get_meta("surface", "none")
	var entity := collider
	while entity != null and entity.get_parent() != world():
		entity = entity.get_parent()
	if entity != null and str(entity.name).begins_with("Entity_"):
		var id := str(entity.name).trim_prefix("Entity_")
		for sampled in actual:
			if sampled.id != id:
				continue
			target.entityId = id
			target.surface = "entity"
			target.entityKind = sampled.kind
			target.entityName = sampled.get("parameters", {}).get("label", "") if sampled.kind == "marker" else {"tree":"树", "rock":"石头", "chest":"宝箱", "door":"门", "marker":"标记"}.get(sampled.kind, sampled.kind)
			target.scale = sampled.scale
			target.color = sampled.color
	if target.surface in ["ground", "entity", "boundary"]:
		observed_target_collider = collider.get_instance_id()
	return target

func observe() -> Dictionary:
	# Non-entity game data remains authored. Requirement entity facts are always
	# recomputed here by the core-pinned adapter, never trusted from this result.
	var result: Dictionary = world().observe()
	var document: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://world/creation.json"))
	if not document is Dictionary or not document.get("entities") is Array:
		return {"error": "Creation observation source declaration unavailable"}
	var declared := {}
	var mutable_presence := {}
	for rule in document.get("rules", []):
		if rule is Dictionary and rule.get("kind") == "entity-behavior" and rule.get("entityIds") is Array:
			for id in rule.entityIds:
				mutable_presence[str(id)] = true
	for entry in document.entities:
		if entry is Dictionary and entry.get("id") is String:
			declared[entry.id] = entry
	var actual := []
	var obstacles := []
	for child in world().get_children():
		if not child is Node3D or not str(child.name).begins_with("Entity_"):
			continue
		var id := str(child.name).trim_prefix("Entity_")
		var definition: Dictionary = declared.get(id, {"id": id, "kind": "unknown", "parameters": {}})
		var sampled := _actual_entity(child as Node3D, definition)
		sampled["presenceMutable"] = mutable_presence.has(id)
		sampled["solidMutable"] = definition.get("kind") == "door"
		if sampled.has("collisionBounds"):
			obstacles.append({"entityId": id, "min": sampled.collisionBounds.min, "max": sampled.collisionBounds.max})
		actual.append(sampled)
	if not result.get("creation") is Dictionary:
		result.creation = {}
	result.creation.entities = actual
	result.creation.obstacles = obstacles
	result.creation.physicsTick = observed_physics_tick
	result.creation.revision = int(document.get("revision", 1))
	result.creation.target = _actual_target(result.creation.revision, actual)
	var scene_objects := _scene_objects(result.creation.target)
	result.creation.sceneObjectTarget = scene_objects.target
	result.creation.sceneObjectRefs = scene_objects.references
	result.creation.sceneObjectSelection = scene_objects.selection
	if scene_objects.selection.status == "fallback":
		result.creation.target = {"entityId": null, "position": null, "normal": null, "surface": "none", "revision": result.creation.revision}
	result.creation.timeOfDay = world().get("time_of_day")
	var inventory: Variant = world().get("inventory")
	result.inventory = inventory.duplicate(true) if inventory is Dictionary else {}
	var player := world().get_node_or_null("Player") as Node3D
	if player != null:
		if not result.get("player") is Dictionary:
			result.player = {}
		var position := player.global_position
		result.player.position = [position.x, position.y, position.z]
	return result

func command(op: String, args: Dictionary) -> Dictionary:
	var allowed := {"walk": ["forward", "right", "frames"], "wait": ["frames"], "look": ["yaw", "pitch"], "interact": [], "set-time": ["hours"]}
	if not allowed.has(op) or not Contract.fields(args, [], allowed[op]):
		return {"error": "Unsupported creation operation or argument"}
	if not is_ready():
		return {"error": "Creation world is not ready"}
	match op:
		"walk", "wait":
			var frames: Variant = args.get("frames", 30 if op == "walk" else 1)
			if not Contract.integer(frames, 1, 600):
				return {"error": "Control requires 1..600 physics ticks"}
			if op == "walk":
				var forward: Variant = args.get("forward", 0)
				var right: Variant = args.get("right", 0)
				if not Contract.finite(forward, -1, 1) or not Contract.finite(right, -1, 1):
					return {"error": "Control axes must be finite -1..1"}
				await world().player.walk(Vector2(float(right), -float(forward)), int(frames))
			else:
				for _frame in int(frames):
					await world().get_tree().physics_frame
		"look":
			var pose: Dictionary = world().player.look()
			var yaw: Variant = args.get("yaw", pose.yaw)
			var pitch: Variant = args.get("pitch", pose.pitch)
			if not Contract.finite(yaw, -PI, PI) or not Contract.finite(pitch, -1.55, 1.55):
				return {"error": "Look angles must be bounded radians"}
			world().player.set_look(float(yaw), float(pitch))
		"interact":
			return {"result": world().interact_target()}
		"set-time":
			if not args.has("hours") or not Contract.finite(args.hours, 0, 24):
				return {"error": "Time requires finite hours 0..24"}
			world().set_time(float(args.hours))
	return {"result": observe()}
