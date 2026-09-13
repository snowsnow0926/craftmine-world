extends Node3D
const JetController = preload("res://scripts/j20_controller.gd")
const FlightHUD = preload("res://scripts/j20_hud.gd")
const AIRFIELD = preload("res://assets/blender/island-airfield.glb")
const AIRCRAFT = preload("res://assets/library/j20.glb")
const FLIGHT_KIT = preload("res://assets/blender/j20-flight-kit.glb")
var jet: CharacterBody3D
var camera: Camera3D
var hud: Control
var canvas: CanvasLayer
var airfield: Node3D
var model: Node3D
var gear_model: Node3D
var canopy_nodes: Array[MeshInstance3D] = []
var engine_plumes: Array[MeshInstance3D] = []
var gates: Array[Node3D] = []
var gate_index := 0
var in_menu := true
var shown := true
var cockpit_view := false
var active := false
var cockpit_position := Vector3(0, 1.6, -5.0)
var base_layers: Array[CanvasLayer] = []
var old_input := false
var player_locked := false
var elapsed := 0.0
var validation_results: Dictionary = {}

func _ready() -> void:
	_install.call_deferred()

func _install() -> void:
	for child in get_parent().get_children():
		if child is CanvasLayer:
			base_layers.append(child)
			child.hide()
	airfield = AIRFIELD.instantiate()
	airfield.name = "IslandAirfield"
	add_child(airfield)
	_install_collisions(airfield)
	_build_sea()
	jet = JetController.new()
	jet.name = "J20_PlayerAircraft"
	add_child(jet)
	jet.reset_flight(false)
	_install_aircraft()
	_build_gates()
	camera = Camera3D.new()
	camera.name = "FlightCamera"
	camera.fov = 62
	camera.near = 0.12
	camera.far = 25000
	add_child(camera)
	camera.position = jet.position + Vector3(24, 10, -28)
	camera.look_at(jet.global_position + Vector3(0, 0.5, 0))
	camera.make_current()
	canvas = CanvasLayer.new()
	canvas.layer = 5
	add_child(canvas)
	hud = FlightHUD.new()
	hud.session = self
	canvas.add_child(hud)
	# Retained Blender sources are recorded in the asset provenance file.
	_run_flight_checks.call_deferred()

func _install_collisions(node: Node) -> void:
	if node is MeshInstance3D and str(node.name).begins_with("COLLIDE_"):
		node.create_trimesh_collision()
		for child in node.get_children():
			if child is StaticBody3D:
				child.collision_layer = 1
				child.collision_mask = 16
	for child in node.get_children():
		if not child is StaticBody3D: _install_collisions(child)

func _build_sea() -> void:
	var ocean := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(65000, 65000)
	ocean.mesh = plane
	ocean.position.y = -3.4
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("1c5668")
	material.roughness = 0.32
	material.metallic = 0.28
	ocean.material_override = material
	add_child(ocean)

func _mesh_nodes(root: Node) -> Array[MeshInstance3D]:
	var result: Array[MeshInstance3D] = []
	if root is MeshInstance3D: result.append(root)
	for child in root.get_children(): result.append_array(_mesh_nodes(child))
	return result

func _install_aircraft() -> void:
	model = AIRCRAFT.instantiate()
	model.name = "J20_LibraryModel"
	jet.add_child(model)
	var bounds := AABB()
	var first := true
	var canopy_center := Vector3.ZERO
	var exhaust_center := Vector3.ZERO
	var exhaust_count := 0
	for mesh in _mesh_nodes(model):
		var local: Transform3D = model.global_transform.affine_inverse() * mesh.global_transform
		var box: AABB = local * mesh.get_aabb()
		bounds = box if first else bounds.merge(box)
		first = false
		var mesh_name := str(mesh.name).to_lower()
		if "canopy glass" in mesh_name or "canopy_glass" in mesh_name:
			canopy_center = box.get_center()
			canopy_nodes.append(mesh)
		if "exhaust" in mesh_name:
			exhaust_center += box.get_center()
			exhaust_count += 1
	var factor := 20.4 / maxf(bounds.size.z, 0.01)
	model.scale = Vector3.ONE * factor
	if exhaust_count > 0: exhaust_center /= float(exhaust_count)
	# The retained model explicitly names Blender nose -Y. Confirm direction by canopy/exhaust geometry.
	model.rotation.y = PI if canopy_center.z > exhaust_center.z else 0.0
	model.position = -(model.basis * bounds.get_center())
	if not canopy_nodes.is_empty():
		var glass_material := StandardMaterial3D.new()
		glass_material.albedo_color = Color(0.16, 0.25, 0.29, 0.62)
		glass_material.metallic = 0.48
		glass_material.roughness = 0.17
		glass_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		glass_material.cull_mode = BaseMaterial3D.CULL_DISABLED
		for mesh in canopy_nodes: mesh.material_override = glass_material
		var glass: MeshInstance3D = canopy_nodes[0]
		var local_box: AABB = jet.global_transform.affine_inverse() * glass.global_transform * glass.get_aabb()
		cockpit_position = Vector3(local_box.get_center().x, local_box.end.y - 0.12, local_box.get_center().z - 0.25)
	gear_model = FLIGHT_KIT.instantiate()
	jet.add_child(gear_model)
	for side in [-1, 1]:
		var plume := MeshInstance3D.new()
		var cone := CylinderMesh.new()
		cone.top_radius = 0.04
		cone.bottom_radius = 0.53
		cone.height = 3.0
		cone.radial_segments = 16
		plume.mesh = cone
		plume.rotation.x = PI * 0.5
		plume.position = Vector3(side * 1.15, -0.25, 11.0)
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.albedo_color = Color(0.36, 0.60, 1.0, 0.65)
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		plume.material_override = mat
		plume.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		jet.add_child(plume)
		engine_plumes.append(plume)
	print("J20_MODEL_GEOMETRY ", JSON.stringify({"lengthM": bounds.size.z * factor, "spanM": bounds.size.x * factor, "canopies": canopy_nodes.size(), "exhausts": exhaust_count, "noseResolved": canopy_center.z != exhaust_center.z}))

func _build_gates() -> void:
	var points := [Vector3(0, 170, -950), Vector3(0, 300, -2350), Vector3(-1050, 450, -3000), Vector3(-1700, 660, -1800), Vector3(-850, 460, -150), Vector3(0, 250, 1350), Vector3(0, 95, 540)]
	for i in points.size():
		var gate := Node3D.new()
		gate.name = "TrainingGate_%02d" % (i + 1)
		gate.position = points[i]
		add_child(gate)
		var mesh := MeshInstance3D.new()
		var torus := TorusMesh.new()
		torus.inner_radius = 82.0
		torus.outer_radius = 86.0
		torus.rings = 48
		torus.ring_segments = 8
		mesh.mesh = torus
		mesh.rotation.x = PI * 0.5
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.albedo_color = Color("70dbc8")
		mesh.material_override = mat
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		gate.add_child(mesh)
		var approach: Vector3 = points[i] - (points[i - 1] if i > 0 else Vector3(0, 2, 180))
		gate.look_at(gate.global_position + approach.normalized())
		gates.append(gate)
	_update_gate_colors()

func _update_gate_colors() -> void:
	for i in gates.size():
		gates[i].visible = i >= gate_index
		var mesh: MeshInstance3D = gates[i].get_child(0)
		mesh.material_override.albedo_color = Color("ffc45c") if i == gate_index else Color("4b958e")

func start_flight(air_start := false) -> void:
	_lock_player()
	jet.reset_flight(air_start)
	gate_index = 0
	_update_gate_colors()
	shown = true
	in_menu = false
	active = true
	canvas.show()
	camera.make_current()
	camera.position = jet.position + Vector3(0, 7, 30)
	camera.look_at(jet.global_position + Vector3(0, 1, -30))
	for layer in base_layers: layer.hide()

func _lock_player() -> void:
	var player: PlayerController = get_parent().player
	if not player_locked:
		old_input = player.input_enabled
		player.input_enabled = false
		player.set_captured(false)
		player.set_movement_lock(self, true)
		player_locked = true

func toggle_menu() -> void:
	if not shown: return
	in_menu = not in_menu
	active = not in_menu
	if active: _lock_player()
	if DisplayServer.get_name() != "headless": Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func leave_flight() -> void:
	active = false
	shown = false
	canvas.hide()
	for layer in base_layers: layer.show()
	var player: PlayerController = get_parent().player
	if player_locked:
		player.set_movement_lock(self, false)
		player.input_enabled = old_input
		player_locked = false
	player.camera_rig.camera.make_current()
	get_parent().status_label.text = "WASD 移动 · E 互动 · F 驾驶歼-20 · F2 对话"

func _unhandled_input(event: InputEvent) -> void:
	if jet == null or not event is InputEventKey or not event.pressed or event.echo: return
	if not shown:
		if event.physical_keycode == KEY_F:
			shown = true
			in_menu = true
			canvas.show()
			camera.make_current()
			for layer in base_layers: layer.hide()
		return
	match event.physical_keycode:
		KEY_ENTER: start_flight(false)
		KEY_ESCAPE: toggle_menu()
		KEY_C: cockpit_view = not cockpit_view
		KEY_G: jet.toggle_gear()
		KEY_H:
			jet.assist = not jet.assist
			jet.message = "姿态辅助已开启" if jet.assist else "姿态辅助已关闭；松杆将保持当前姿态"
		KEY_R:
			if not in_menu: start_flight(false)
		_: return
	get_viewport().set_input_as_handled()

func _key(code: Key) -> float:
	return 1.0 if Input.is_physical_key_pressed(code) else 0.0

func _physics_process(delta: float) -> void:
	if jet == null or not active or not shown: return
	var previous: Vector3 = jet.position
	jet.simulate(delta, {"throttle": _key(KEY_W) - _key(KEY_S), "pitch": _key(KEY_DOWN) - _key(KEY_UP), "roll": _key(KEY_A) - _key(KEY_D), "rudder": _key(KEY_Q) - _key(KEY_E), "boost": Input.is_physical_key_pressed(KEY_SHIFT), "brake": Input.is_physical_key_pressed(KEY_SPACE)})
	if not jet.crashed and not jet.grounded and gate_index < gates.size():
		var target: Vector3 = gates[gate_index].position
		var segment := jet.position - previous
		var u := clampf((target - previous).dot(segment) / maxf(segment.length_squared(), 0.001), 0.0, 1.0)
		if target.distance_to(previous + segment * u) < 82.0:
			gate_index += 1
			jet.message = "已通过航标 %d / %d" % [gate_index, gates.size()]
			if gate_index == gates.size(): jet.message = "绕岛航线完成！对准跑道，放轮减速并轻柔降落"
			_update_gate_colors()

func _process(delta: float) -> void:
	if jet == null or camera == null: return
	elapsed += delta
	gear_model.scale.y = move_toward(gear_model.scale.y, 1.0 if jet.gear_down else 0.035, delta * 1.0)
	gear_model.visible = gear_model.scale.y > 0.04
	for plume in engine_plumes:
		plume.visible = active and jet.afterburner and not jet.crashed
		plume.scale.y = 0.85 + sin(elapsed * 39.0) * 0.1
	for glass in canopy_nodes: glass.visible = not (cockpit_view and not in_menu)
	if not shown: return
	if in_menu:
		var angle := sin(elapsed * 0.10) * 0.25
		var offset := Vector3(24, 10, -28).rotated(Vector3.UP, angle)
		camera.global_position = jet.global_position + offset
		camera.look_at(jet.global_position + Vector3(0, 0.2, 0))
		camera.fov = 55.0
	elif cockpit_view:
		camera.global_transform = jet.global_transform * Transform3D(Basis.IDENTITY, cockpit_position)
		camera.fov = 78.0
	else:
		var chase := jet.global_position + jet.basis * Vector3(0, 5.2, 29) + Vector3.UP * 2.0
		camera.global_position = camera.global_position.lerp(chase, 1.0 - exp(-delta * 4.5))
		camera.look_at(jet.global_position - jet.basis.z * 38.0 + Vector3.UP * 1.4)
		camera.fov = lerpf(camera.fov, 64.0 + jet.airspeed * 0.025, delta * 2.0)

func _run_flight_checks() -> void:
	# Independent extra probes. They exercise the actual controller; they do not replace host checks.
	await get_tree().physics_frame
	await get_tree().physics_frame
	var probe: CharacterBody3D = JetController.new()
	probe.name = "FlightDynamicsProbe"
	add_child(probe)
	await get_tree().physics_frame
	probe.reset_flight(false)
	for i in 720:
		probe.simulate(1.0 / 60.0, {"throttle": 1.0, "pitch": 0.5 if probe.airspeed > 67.0 and probe.pitch < 0.2 else 0.0})
	validation_results["takeoff"] = not probe.grounded and not probe.crashed and probe.position.y > 15.0
	var heading_before: float = probe.heading
	for i in 100: probe.simulate(1.0 / 60.0, {"roll": 0.7})
	validation_results["steering"] = absf(probe.heading - heading_before) > 0.12 and absf(probe.bank) > 0.2
	probe.toggle_gear()
	validation_results["gear_retracts"] = not probe.gear_down
	# An approach fixture, then real control/physics steps through touchdown and braking.
	probe.reset_flight(true)
	probe.position = Vector3(0, 25, 300)
	probe.airspeed = 78.0
	probe.throttle = 0.25
	probe.pitch = -0.07
	probe.gear_down = true
	probe.assist = false
	probe.velocity = Vector3(0, -5.4, -78)
	for i in 420:
		probe.simulate(1.0 / 60.0, {})
		if probe.grounded or probe.crashed: break
	validation_results["gentle_landing"] = probe.grounded and not probe.crashed and probe.landings > 0
	for i in 240: probe.simulate(1.0 / 60.0, {"throttle": -1.0, "brake": true})
	validation_results["braking"] = probe.airspeed < 1.0 and not probe.crashed
	probe.reset_flight(true)
	probe.position = Vector3(0, 3, 200)
	probe.gear_down = false
	probe.pitch = -0.1
	probe.velocity = Vector3(0, -10, -100)
	for i in 30: probe.simulate(1.0 / 60.0, {})
	validation_results["unsafe_landing_rejected"] = probe.crashed
	probe.reset_flight(false)
	validation_results["restart"] = not probe.crashed and probe.grounded and probe.position.distance_to(Vector3(0, probe.REST_HEIGHT, 180)) < 0.001
	probe.queue_free()
	set_meta("flight_probe_results", validation_results)
	print("J20_FLIGHT_PROBES ", JSON.stringify(validation_results))
	for key in validation_results:
		if not validation_results[key]: push_error("J20 flight probe failed: " + str(key))
