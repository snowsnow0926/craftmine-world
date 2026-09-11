extends Node3D

const Contract = preload("res://scripts/scene_contract.gd")
const CreationFont = preload("res://scripts/creation_font.gd")
const BASE_VERSION := "1.0.0"
const HALF_EXTENTS := {"tree": Vector3(0.6, 2, 0.6), "rock": Vector3(0.7, 0.7, 0.7), "chest": Vector3(0.6, 0.55, 0.5), "door": Vector3(0.8, 1.3, 0.25), "marker": Vector3(0.3, 0.7, 0.3)}
const INTERACTION_DISTANCE := 3.5
signal interacted(entity_id: String)

@onready var player: PlayerController = $Player
var scene_data: Dictionary = {}
var world_id := "creation-local"
var ready_for_play := false
var failure := ""
var entities := {}
var physics_tick: int = 0
var entity_nodes := {}
var rule_nodes := {}
var rule_state := {}
var inventory := {}
var opened_chests := {}
var doors := {}
var time_of_day := 12.0
var target := {"entityId": null, "position": null, "normal": null, "surface": "none", "revision": 1}
var marker: MeshInstance3D
var sun: DirectionalLight3D
var status_label: Label
var creation_font: FontFile
var selection_box: MeshInstance3D
var selection_label: Label
var highlighted_id := ""

func _ready() -> void:
	creation_font = CreationFont.load_font()
	player.capture_mouse_on_click = DisplayServer.get_name() != "headless"
	player.input_enabled = DisplayServer.get_name() != "headless"
	_build_environment()
	_build_hud()
	if creation_font == null:
		_fail("Bundled CJK font is missing or invalid")
		return
	var file := FileAccess.open("res://world/creation.json", FileAccess.READ)
	if file == null or file.get_length() > 131072:
		_fail("Creation source is missing or exceeds 128 KiB")
		return
	var raw: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	failure = Contract.validate(raw)
	if not failure.is_empty():
		_fail(failure)
		return
	scene_data = raw
	time_of_day = float(scene_data.defaults.timeOfDay)
	for definition in scene_data.entities:
		entities[definition.id] = definition.duplicate(true)
		_create_entity(definition)
	for definition in scene_data.get("rules", []):
		var script_path: String = "res://" + definition.script
		if not FileAccess.file_exists(script_path) or FileAccess.get_sha256(script_path) != definition.sha256:
			_fail("Authored rule source hash mismatch: " + definition.id)
			return
		var resource: Variant = load(script_path)
		if not resource is Script or not resource.can_instantiate():
			_fail("Authored rule cannot be loaded: " + definition.id)
			return
		var rule: Variant = resource.new()
		if not rule is Node:
			_fail("Authored rule must extend Node: " + definition.id)
			return
		for method in ["configure", "on_entity_interacted", "snapshot", "validate_state", "restore"]:
			if not rule.has_method(method):
				_fail("Authored rule is missing " + method + ": " + definition.id)
				rule.free()
				return
		if definition.kind == "entity-behavior" and not rule.has_method("project_entities"):
			_fail("Entity behavior is missing project_entities: " + definition.id)
			rule.free()
			return
		rule.name = "Rule_" + definition.id
		add_child(rule)
		rule.configure(self, definition.duplicate(true))
		rule_nodes[definition.id] = rule
	_update_time()
	ready_for_play = true
	status_label.text = "WASD 移动 · E 互动 · F2 对话 · Shift+F2 工作台"

func _fail(message: String) -> void:
	failure = message
	ready_for_play = false
	player.input_enabled = false
	status_label.text = "Creation world unavailable: " + message
	push_error(message)

func _material(color: Color, unshaded := false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.85
	if unshaded:
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material

func _box(parent: Node3D, size: Vector3, center: Vector3, color: Color) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh.mesh = box
	mesh.material_override = _material(color)
	mesh.position = center
	parent.add_child(mesh)
	return mesh

func _solid(parent: Node3D, size: Vector3, center: Vector3, surface: String, entity_id := "") -> StaticBody3D:
	var body := StaticBody3D.new()
	body.collision_layer = 2 if not entity_id.is_empty() else 1
	body.collision_mask = 8
	body.set_meta("surface", surface)
	body.set_meta("entity_id", entity_id)
	body.position = center
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)
	parent.add_child(body)
	return body

func _build_environment() -> void:
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color("5282ad")
	sky_material.sky_horizon_color = Color("c6dfdf")
	sky.sky_material = sky_material
	settings.sky = sky
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("c8dfed")
	settings.ambient_light_energy = 0.7
	environment.environment = settings
	add_child(environment)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	add_child(sun)
	_box(self, Vector3(64, 0.4, 64), Vector3(0, -0.2, 0), Color("6e9580"))
	_solid(self, Vector3(64, 0.4, 64), Vector3(0, -0.2, 0), "ground")
	for edge in [-1, 1]:
		var center := Vector3(edge * 32, 1.5, 0)
		_box(self, Vector3(0.5, 3, 64), center, Color("b2c5bf"))
		_solid(self, Vector3(0.5, 6, 64), Vector3(edge * 32, 3, 0), "boundary")
		center = Vector3(0, 1.5, edge * 32)
		_box(self, Vector3(64, 3, 0.5), center, Color("b2c5bf"))
		_solid(self, Vector3(64, 6, 0.5), Vector3(0, 3, edge * 32), "boundary")
	marker = MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.045
	sphere.height = 0.09
	marker.mesh = sphere
	marker.material_override = _material(Color("f8df87"), true)
	marker.visible = false
	add_child(marker)

func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var crosshair := Label.new()
	crosshair.text = "+"
	crosshair.mouse_filter = Control.MOUSE_FILTER_IGNORE
	crosshair.set_anchors_preset(Control.PRESET_CENTER)
	crosshair.position = Vector2(-5, -12)
	crosshair.add_theme_font_size_override("font_size", 22)
	layer.add_child(crosshair)
	status_label = Label.new()
	if creation_font != null:
		status_label.add_theme_font_override("font", creation_font)
	status_label.position = Vector2(20, 18)
	status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(status_label)
	selection_label = Label.new()
	selection_label.position = Vector2(20, 92)
	selection_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if creation_font != null: selection_label.add_theme_font_override("font", creation_font)
	layer.add_child(selection_label)
	selection_box = MeshInstance3D.new()
	selection_box.material_override = _material(Color("ffd45c"), true)
	selection_box.visible = false
	add_child(selection_box)

func _create_entity(definition: Dictionary) -> void:
	var node := Node3D.new()
	node.name = "Entity_" + definition.id
	add_child(node)
	node.position = Vector3(definition.position[0], definition.position[1], definition.position[2])
	node.rotation.y = deg_to_rad(float(definition.rotationY))
	node.scale = Vector3(definition.scale[0], definition.scale[1], definition.scale[2])
	entity_nodes[definition.id] = node
	var color := Color(definition.color)
	var half: Vector3 = HALF_EXTENTS[definition.kind]
	var body := _solid(node, half * 2, Vector3(0, half.y, 0), "entity", definition.id)
	body.name = "Body"
	match definition.kind:
		"tree":
			_box(node, Vector3(0.25, 2.2, 0.25), Vector3(0, 1.1, 0), Color("715c46"))
			var canopy := MeshInstance3D.new()
			var sphere := SphereMesh.new()
			sphere.radius = 0.6
			sphere.height = 2
			canopy.name = "CreationColorMesh"
			canopy.mesh = sphere
			canopy.position.y = 3
			canopy.material_override = _material(color)
			node.add_child(canopy)
		"rock":
			var rock := MeshInstance3D.new()
			var sphere := SphereMesh.new()
			sphere.radius = 0.7
			sphere.height = 1.4
			rock.name = "CreationColorMesh"
			rock.mesh = sphere
			rock.position.y = 0.7
			rock.material_override = _material(color)
			node.add_child(rock)
		"chest":
			_box(node, Vector3(1.2, 0.8, 1), Vector3(0, 0.4, 0), color).name = "CreationColorMesh"
			var lid := Node3D.new()
			lid.name = "Lid"
			lid.position = Vector3(0, 0.85, -0.5)
			node.add_child(lid)
			_box(lid, Vector3(1.2, 0.25, 1), Vector3(0, 0.125, 0.5), color.lightened(0.15))
			_box(node, Vector3(0.2, 0.3, 0.05), Vector3(0, 0.65, 0.53), Color("e9c66e"))
		"door":
			var hinge := Node3D.new()
			hinge.name = "Hinge"
			hinge.position.x = -0.8
			node.add_child(hinge)
			# Open doors remain aimable even though their blocking collider is off.
			var aim_area := Area3D.new()
			aim_area.collision_layer = 4
			aim_area.collision_mask = 0
			aim_area.set_meta("surface", "entity")
			aim_area.set_meta("entity_id", definition.id)
			var aim_shape := CollisionShape3D.new()
			var aim_box := BoxShape3D.new()
			aim_box.size = Vector3(1.6, 2.6, 0.5)
			aim_shape.shape = aim_box
			aim_shape.position = Vector3(0.8, 1.3, 0)
			aim_area.add_child(aim_shape)
			hinge.add_child(aim_area)
			_box(hinge, Vector3(1.6, 2.6, 0.5), Vector3(0.8, 1.3, 0), color).name = "CreationColorMesh"
			_box(hinge, Vector3(0.12, 0.12, 0.12), Vector3(1.4, 1.3, 0.3), Color("f5d478"))
			doors[definition.id] = definition.parameters.get("initiallyOpen", false)
			_update_door(definition.id)
		"marker":
			_box(node, Vector3(0.16, 1.4, 0.16), Vector3(0, 0.7, 0), color).name = "CreationColorMesh"
			_box(node, Vector3(0.6, 0.35, 0.6), Vector3(0, 1.2, 0), color.lightened(0.2))
			var label := Label3D.new()
			label.font = creation_font
			label.text = definition.parameters.get("label", "")
			label.position.y = 1.7
			label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			label.font_size = 36
			node.add_child(label)

func _physics_process(_delta: float) -> void:
	physics_tick += 1
	if ready_for_play:
		refresh_target()

func _unhandled_input(event: InputEvent) -> void:
	if ready_for_play and event.is_action_pressed("interact"):
		interact_target()

func refresh_target() -> Dictionary:
	target = {"entityId": null, "position": null, "normal": null, "surface": "none", "revision": int(scene_data.get("revision", 1))}
	if not ready_for_play:
		return target.duplicate(true)
	var camera: Camera3D = player.camera_rig.camera
	var origin := camera.global_position
	var query := PhysicsRayQueryParameters3D.create(origin, origin - camera.global_basis.z * 80, 7, [player.get_rid()])
	query.collide_with_areas = true
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	marker.visible = not hit.is_empty()
	if not hit.is_empty():
		var collider: Object = hit.collider
		var point: Vector3 = hit.position
		var normal: Vector3 = hit.normal
		var entity_id: String = collider.get_meta("entity_id", "")
		target = {"entityId": entity_id if not entity_id.is_empty() else null, "position": [point.x, point.y, point.z], "normal": [normal.x, normal.y, normal.z], "surface": collider.get_meta("surface", "none"), "revision": int(scene_data.revision)}
		marker.global_position = point + normal * 0.03
	_update_selection()
	return target.duplicate(true)

func _observed_color(id: String) -> String:
	var mesh: MeshInstance3D = entity_nodes[id].find_child("CreationColorMesh", true, false) as MeshInstance3D
	if mesh == null or not mesh.material_override is StandardMaterial3D: return ""
	return "#" + mesh.material_override.albedo_color.to_html(false)

func _update_selection() -> void:
	var id: String = str(target.entityId) if target.entityId != null else ""
	selection_box.visible = entities.has(id)
	selection_label.text = ""
	if not entities.has(id): return
	var definition: Dictionary = entities[id]
	var names := {"tree": "树", "rock": "石头", "chest": "宝箱", "door": "门", "marker": "标记"}
	var display_name: String = definition.parameters.get("label", "") if definition.kind == "marker" else ""
	if display_name.is_empty(): display_name = names.get(definition.kind, definition.kind)
	var node: Node3D = entity_nodes[id]
	target["entityName"] = display_name
	target["entityKind"] = definition.kind
	target["scale"] = [node.scale.x, node.scale.y, node.scale.z]
	target["color"] = _observed_color(id)
	selection_label.text = display_name + " · " + id
	selection_box.global_transform = node.global_transform
	if highlighted_id == id: return
	highlighted_id = id
	var half: Vector3 = HALF_EXTENTS[definition.kind] + Vector3(0.03, 0.03, 0.03)
	var points := [Vector3(-half.x, 0, -half.z), Vector3(half.x, 0, -half.z), Vector3(half.x, half.y * 2, -half.z), Vector3(-half.x, half.y * 2, -half.z), Vector3(-half.x, 0, half.z), Vector3(half.x, 0, half.z), Vector3(half.x, half.y * 2, half.z), Vector3(-half.x, half.y * 2, half.z)]
	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	for edge in [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]:
		mesh.surface_add_vertex(points[edge[0]])
		mesh.surface_add_vertex(points[edge[1]])
	mesh.surface_end()
	selection_box.mesh = mesh
	selection_box.global_transform = node.global_transform

func interact_target() -> Dictionary:
	var aimed := refresh_target()
	if aimed.entityId == null or aimed.position == null:
		return {"interacted": false, "reason": "no-entity"}
	var point := Vector3(aimed.position[0], aimed.position[1], aimed.position[2])
	if player.camera_rig.camera.global_position.distance_to(point) > INTERACTION_DISTANCE:
		return {"interacted": false, "reason": "out-of-range"}
	var id: String = aimed.entityId
	var definition: Dictionary = entities[id]
	match definition.kind:
		"chest":
			if opened_chests.has(id):
				return {"interacted": false, "reason": "already-opened", "entityId": id}
			var reward: String = definition.parameters.get("rewardId", "creation-token")
			var count: int = int(definition.parameters.get("rewardCount", 1))
			if int(inventory.get(reward, 0)) + count > 999999 or (not inventory.has(reward) and inventory.size() >= 4096):
				return {"interacted": false, "reason": "inventory-limit"}
			inventory[reward] = int(inventory.get(reward, 0)) + count
			opened_chests[id] = true
			_update_chest(id)
		"door":
			for rule in scene_data.get("rules", []):
				if rule.get("doorId", "") == id:
					return {"interacted": false, "reason": "rule-controlled", "entityId": id}
			set_door_open(id, not doors.get(id, false))
		"marker":
			pass
		"tree", "rock":
			var registered := false
			for rule in scene_data.get("rules", []):
				if rule.kind == "entity-behavior" and id in rule.entityIds: registered = true
			if not registered: return {"interacted": false, "reason": "not-interactive"}
		_:
			return {"interacted": false, "reason": "not-interactive"}
	interacted.emit(id)
	for declaration in scene_data.get("rules", []):
		if declaration.kind == "entity-behavior" and not id in declaration.entityIds: continue
		rule_nodes[declaration.id].on_entity_interacted(id)
	return {"interacted": true, "entityId": id, "kind": definition.kind}

func set_entity_presence(id: String, visible_value: bool, solid_value: bool) -> bool:
	if not entity_nodes.has(id): return false
	entity_nodes[id].visible = visible_value
	entity_nodes[id].get_node("Body").get_child(0).disabled = not solid_value
	return true

func _entity_presence(id: String) -> Dictionary:
	return {"visible": entity_nodes[id].is_visible_in_tree(), "solid": not entity_nodes[id].get_node("Body").get_child(0).disabled}

func _project_entity_states(data: Dictionary) -> Dictionary:
	var result := {}
	for declaration in scene_data.get("rules", []):
		if declaration.kind != "entity-behavior": continue
		var projection: Variant = rule_nodes[declaration.id].project_entities(data.rules[declaration.id].duplicate(true))
		if not projection is Dictionary or projection.size() != declaration.entityIds.size(): return {"error":"Invalid entity projection: " + declaration.id}
		for id in declaration.entityIds:
			if not projection.has(id) or not Contract.fields(projection[id], ["visible", "solid"]) or not projection[id].visible is bool or not projection[id].solid is bool: return {"error":"Invalid entity projection state: " + declaration.id}
			result[id] = projection[id].duplicate(true)
	return {"states":result,"error":""}

func set_door_open(id: String, opened: bool) -> bool:
	if not entities.has(id) or entities[id].kind != "door":
		return false
	doors[id] = opened
	_update_door(id)
	return true

func _update_door(id: String) -> void:
	var node: Node3D = entity_nodes[id]
	node.get_node("Hinge").rotation.y = -PI * 0.5 if doors.get(id, false) else 0.0
	var shape: CollisionShape3D = node.get_node("Body").get_child(0)
	shape.set_deferred("disabled", doors.get(id, false))

func _update_chest(id: String) -> void:
	if entity_nodes.has(id) and entities[id].kind == "chest":
		entity_nodes[id].get_node("Lid").rotation.x = -1.15 if opened_chests.has(id) else 0.0

func _update_time() -> void:
	sun.rotation_degrees = Vector3(-70 * sin(time_of_day / 24.0 * PI) - 5, -35, 0)
	sun.light_energy = 0.2 + 0.9 * maxf(0, sin(time_of_day / 24.0 * PI))

func set_time(hours: float) -> String:
	if not Contract.finite(hours, 0, 24):
		return "Time must be 0..24"
	time_of_day = hours
	_update_time()
	return ""

func capture() -> Dictionary:
	var rules := rule_state.duplicate(true)
	for id in rule_nodes:
		rules[id] = rule_nodes[id].snapshot()
	return {"format": "craftmine.creation-progress/1", "worldId": world_id, "baseVersion": BASE_VERSION, "player": player.snapshot(), "timeOfDay": time_of_day, "sourceTimeOfDay": float(scene_data.defaults.timeOfDay), "inventory": inventory.duplicate(true), "openedChests": opened_chests.duplicate(true), "doors": doors.duplicate(true), "rules": rules}

func validate_progress(data: Variant) -> String:
	if not Contract.fields(data, ["format", "worldId", "baseVersion", "player", "timeOfDay", "sourceTimeOfDay", "inventory", "openedChests", "doors", "rules"]) or data.format != "craftmine.creation-progress/1" or data.worldId != world_id or data.baseVersion != BASE_VERSION:
		return "Creation progress identity or fields do not match"
	if JSON.stringify(data).to_utf8_buffer().size() > 262144 or not _json_value(data, 0):
		return "Creation progress exceeds safe JSON limits"
	if not Contract.finite(data.sourceTimeOfDay, 0, 24) or data.sourceTimeOfDay != scene_data.defaults.timeOfDay:
		return "Creation progress needs the current source time default"
	if not Contract.finite(data.timeOfDay, 0, 24):
		return "Invalid saved time"
	if not Contract.fields(data.player, ["position", "yaw", "pitch", "onFloor"]) or not data.player.onFloor is bool:
		return "Invalid saved player"
	var p: Variant = data.player.position
	if not p is Array or p.size() != 3 or not Contract.finite(p[0], -32, 32) or not Contract.finite(p[1], 0, 32) or not Contract.finite(p[2], -32, 32) or not Contract.finite(data.player.yaw, -PI, PI) or not Contract.finite(data.player.pitch, -deg_to_rad(89), deg_to_rad(89)):
		return "Saved player pose is outside the sandbox"
	for key in ["inventory", "openedChests", "doors", "rules"]:
		if not data[key] is Dictionary or data[key].size() > 4096:
			return "Invalid saved ledger: " + key
		for id in data[key]:
			if not Contract.identifier(id):
				return "Invalid saved stable ID"
	for id in data.inventory:
		if not Contract.integer(data.inventory[id], 0, 999999):
			return "Invalid inventory count"
	for id in data.openedChests:
		if not data.openedChests[id] is bool or data.openedChests[id] != true:
			return "Invalid one-time chest ledger"
	for id in data.doors:
		if not data.doors[id] is bool:
			return "Invalid saved door state"
	for id in data.rules:
		if not data.rules[id] is Dictionary:
			return "Invalid saved rule state"
		if rule_nodes.has(id):
			var problem: Variant = rule_nodes[id].validate_state(data.rules[id])
			if not problem is String or not problem.is_empty():
				return "Authored rule rejected progress: " + id + ": " + str(problem)
	# Candidate defaults must be merged by the host and verified before adoption.
	# A direct restore never silently adds identities to the supplied snapshot.
	for id in entities:
		if entities[id].kind == "door" and not data.doors.has(id):
			return "Creation progress needs the new door default: " + id
	for definition in scene_data.get("rules", []):
		if not data.rules.has(definition.id):
			return "Creation progress needs the new rule default: " + definition.id
		if definition.kind == "sequence-door" and data.rules[definition.id].get("completed", false) and not data.doors.get(definition.doorId, false):
			return "Completed rule requires its open door: " + definition.id
	var projected := _project_entity_states(data)
	if not projected.error.is_empty(): return projected.error
	var collision := _player_overlap(Vector3(p[0], p[1], p[2]), data.doors, projected.states)
	if not collision.is_empty():
		return "Saved player overlaps candidate entity: " + collision
	return ""

func _player_overlap(player_position: Vector3, saved_doors: Dictionary, projected: Dictionary = {}) -> String:
	# Capsule versus each actual Y-rotated box, before mutating any progress.
	# Use the proposed door state, not fresh-instance/default collider state.
	# A tiny contact tolerance preserves valid saves taken against a wall.
	for id in entities:
		var definition: Dictionary = entities[id]
		if projected.has(id) and not projected[id].solid: continue
		if definition.kind == "door" and saved_doors.get(id, false):
			continue
		var offset := player_position - Vector3(definition.position[0], definition.position[1], definition.position[2])
		var local := offset.rotated(Vector3.UP, -deg_to_rad(float(definition.rotationY)))
		var half: Vector3 = HALF_EXTENTS[definition.kind] * Vector3(definition.scale[0], definition.scale[1], definition.scale[2])
		var dx := maxf(absf(local.x) - half.x, 0)
		var dz := maxf(absf(local.z) - half.z, 0)
		var dy := maxf(maxf(-local.y - 0.6, local.y - 0.6 - half.y * 2), 0)
		if dx * dx + dy * dy + dz * dz < 0.298 * 0.298:
			return id
	return ""

func _json_value(value: Variant, depth: int) -> bool:
	if depth > 12:
		return false
	if value is Dictionary:
		if value.size() > 4096:
			return false
		for key in value:
			if not key is String or key.length() > 128 or not _json_value(value[key], depth + 1):
				return false
	elif value is Array:
		if value.size() > 4096:
			return false
		for item in value:
			if not _json_value(item, depth + 1):
				return false
	elif value is float or value is int:
		return is_finite(float(value))
	elif value is String:
		return value.length() <= 4096
	elif value != null and not value is bool:
		return false
	return true

func restore(data: Dictionary) -> String:
	var problem := validate_progress(data)
	if not problem.is_empty(): return problem
	var previous := capture()
	var prior_presence := {}
	for id in entities: prior_presence[id] = _entity_presence(id)
	var projected := _project_entity_states(data)
	problem = player.restore(data.player)
	if not problem.is_empty(): return problem
	_apply_progress(data)
	for id in projected.states:
		if _entity_presence(id) != projected.states[id]:
			_apply_progress(previous)
			player.restore(previous.player)
			for entity_id in prior_presence: set_entity_presence(entity_id, prior_presence[entity_id].visible, prior_presence[entity_id].solid)
			return "Entity behavior restore differs from projection: " + id
	return ""

func _apply_progress(data: Dictionary) -> void:
	time_of_day = float(data.timeOfDay)
	inventory = data.inventory.duplicate(true)
	opened_chests = data.openedChests.duplicate(true)
	doors = data.doors.duplicate(true)
	rule_state = data.rules.duplicate(true)
	for id in entities:
		if entities[id].kind == "door":
			if not doors.has(id):
				doors[id] = entities[id].parameters.get("initiallyOpen", false)
			_update_door(id)
		elif entities[id].kind == "chest":
			_update_chest(id)
	for id in rule_nodes:
		if rule_state.has(id):
			rule_nodes[id].restore(rule_state[id])
	_update_time()

func save_local() -> String:
	var body := capture()
	var problem := validate_progress(body)
	if not problem.is_empty():
		return problem
	var destination := "user://creation-" + world_id + ".json"
	var file := FileAccess.open(destination + ".tmp", FileAccess.WRITE)
	if file == null:
		return "Cannot write creation progress"
	file.store_string(JSON.stringify(body))
	file.close()
	return "" if DirAccess.rename_absolute(destination + ".tmp", destination) == OK else "Cannot confirm creation progress"

func load_local() -> String:
	var destination := "user://creation-" + world_id + ".json"
	if not FileAccess.file_exists(destination):
		return "Creation progress is absent"
	var file := FileAccess.open(destination, FileAccess.READ)
	if file == null or file.get_length() > 262144:
		return "Cannot read bounded creation progress"
	var data: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if not data is Dictionary:
		return "Creation progress is malformed"
	return restore(data)

func observe() -> Dictionary:
	var definitions := []
	var obstacles := []
	for id in entities:
		var definition: Dictionary = entities[id].duplicate(true)
		var actual_node: Node3D = entity_nodes[id]
		definition["position"] = [actual_node.position.x, actual_node.position.y, actual_node.position.z]
		definition["scale"] = [actual_node.scale.x, actual_node.scale.y, actual_node.scale.z]
		definition["color"] = _observed_color(id)
		var presence := _entity_presence(id)
		definition["visible"] = presence.visible
		definition["solid"] = presence.solid
		if definition.kind == "chest": definition["opened"] = opened_chests.has(id)
		if definition.kind == "door": definition["open"] = doors.get(id, false)
		definitions.append(definition)
		if not definition.solid: continue
		var half: Vector3 = HALF_EXTENTS[definition.kind]
		var bounds: AABB = entity_nodes[id].global_transform * AABB(Vector3(-half.x, 0, -half.z), half * 2)
		obstacles.append({"entityId": id, "min": [bounds.position.x, bounds.position.y, bounds.position.z], "max": [bounds.end.x, bounds.end.y, bounds.end.z]})
	return {"base": "creation-sandbox", "baseVersion": BASE_VERSION, "player": player.snapshot(), "creation": {"physicsTick": physics_tick, "revision": int(scene_data.get("revision", 1)), "target": refresh_target(), "entities": definitions, "obstacles": obstacles, "playerBounds": {"position": [player.position.x, player.position.y - 0.9, player.position.z], "halfExtents": [0.3, 0.9, 0.3]}, "timeOfDay": time_of_day}, "inventory": inventory.duplicate(true), "ready": ready_for_play, "error": failure}
