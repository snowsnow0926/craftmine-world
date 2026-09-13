extends "res://scripts/j20_viewport.gd"
## Visual-only layer. Flight physics, controls and the v1 persistent component
## remain inherited unchanged. F4 changes presentation, never simulation.
const SKY_SHADER = preload("res://shaders/flight_sky.gdshader")
const SEA_SHADER = preload("res://shaders/flight_ocean.gdshader")
const LAND_SHADER = preload("res://shaders/flight_land.gdshader")
const VEGETATION = preload("res://assets/blender/island-vegetation.glb")
const CHASE_OFFSET := Vector3(6.5, 8.0, 27.0)
const CHASE_FOV := 48.0
var clean_view := false
var clean_hint_seconds := 0.0
var ocean: MeshInstance3D
var chase_offset := CHASE_OFFSET
var chase_initialized := false
var cinematic_tests: Dictionary = {}

func _build_sea() -> void:
	ocean = MeshInstance3D.new()
	ocean.name = "FlightOcean"
	var plane := PlaneMesh.new()
	plane.size = Vector2(200000, 200000)
	ocean.mesh = plane
	ocean.position.y = -3.4
	ocean.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := ShaderMaterial.new()
	material.shader = SEA_SHADER
	material.set_shader_parameter("field_origin", global_position)
	ocean.material_override = material
	add_child(ocean)

func _install() -> void:
	super._install()
	_install_atmosphere()
	var vegetation: Node3D = VEGETATION.instantiate()
	vegetation.name = "VisualIslandVegetation"
	add_child(vegetation)
	# Decoration only: no generated colliders or changes to the original terrain.
	for mesh in _mesh_nodes(vegetation):
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	camera.far = 55000.0
	flight_view.msaa_3d = Viewport.MSAA_2X
	_run_visual_checks()

func _install_atmosphere() -> void:
	var sun_dir: Vector3 = get_parent().sun.global_basis.z.normalized()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_material := ShaderMaterial.new()
	sky_material.shader = SKY_SHADER
	sky_material.set_shader_parameter("sun_direction", sun_dir)
	sky.sky_material = sky_material
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("b9cad3")
	env.ambient_light_energy = 0.48
	env.ambient_light_sky_contribution = 0.35
	env.fog_enabled = true
	env.fog_light_color = Color("91b2c2")
	env.fog_light_energy = 0.7
	env.fog_density = 0.000019
	env.fog_sky_affect = 0.12
	camera.environment = env
	ocean.material_override.set_shader_parameter("sun_direction", sun_dir)
	for mesh in _mesh_nodes(airfield):
		var mesh_name := str(mesh.name)
		if mesh_name.begins_with("COLLIDE_Island") or mesh_name.begins_with("COLLIDE_Mountain"):
			var material := ShaderMaterial.new()
			material.shader = LAND_SHADER
			material.set_shader_parameter("field_origin", global_position)
			material.set_shader_parameter("sun_direction", sun_dir)
			material.set_shader_parameter("mountain", mesh_name.begins_with("COLLIDE_Mountain"))
			mesh.material_override = material

func _snap_driving_camera() -> void:
	if cockpit_view:
		camera.global_transform = jet.global_transform * Transform3D(Basis.IDENTITY, cockpit_position)
		camera.fov = 78.0
	else:
		chase_offset = Basis(Vector3.UP, jet.heading) * CHASE_OFFSET
		chase_initialized = true
		camera.global_position = jet.global_position + chase_offset
		camera.look_at(jet.global_position - jet.basis.z * 1.5, Vector3.UP)
		camera.fov = CHASE_FOV
	_remember_camera()

func start_flight(air_start := false) -> void:
	super.start_flight(air_start)
	chase_offset = camera.global_position - jet.global_position
	chase_initialized = true

func _apply_saved(state: Dictionary) -> void:
	super._apply_saved(state)
	# Restore the exact old camera payload first. The improved framing only
	# transitions after Start, without rewriting the player's saved pose.
	chase_initialized = false

func _process(delta: float) -> void:
	clean_hint_seconds = maxf(0.0, clean_hint_seconds - delta)
	if jet == null or camera == null: return
	if not (active and shown and not in_menu):
		super._process(delta)
		return
	flight_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	# Preserve the previous gear/exhaust visual timing, independent of camera work.
	elapsed += delta
	gear_model.scale.y = move_toward(gear_model.scale.y, 1.0 if jet.gear_down else 0.035, delta)
	gear_model.visible = gear_model.scale.y > 0.04
	for plume in engine_plumes:
		plume.visible = jet.afterburner and not jet.crashed
		plume.scale.y = 0.85 + sin(elapsed * 39.0) * 0.1
	for glass in canopy_nodes: glass.visible = not cockpit_view
	if cockpit_view:
		camera.global_transform = jet.global_transform * Transform3D(Basis.IDENTITY, cockpit_position)
		camera.fov = 78.0
	else:
		if not chase_initialized:
			chase_offset = camera.global_position - jet.global_position
			chase_initialized = true
		var desired := Basis(Vector3.UP, jet.heading) * CHASE_OFFSET
		chase_offset = chase_offset.lerp(desired, 1.0 - exp(-delta * 6.0))
		# Transport the camera with the aircraft's current position. Smoothing is
		# relative, so 250 m/s cannot create the former ~55 m of extra camera lag.
		var destination := jet.global_position + chase_offset
		var query := PhysicsRayQueryParameters3D.create(jet.global_position + Vector3.UP, destination, 1, [jet.get_rid()])
		var hit := get_world_3d().direct_space_state.intersect_ray(query)
		if not hit.is_empty(): destination = hit.position + hit.normal * 1.2
		camera.global_position = destination
		camera.look_at(jet.global_position - jet.basis.z * 1.5, Vector3.UP)
		camera.fov = lerpf(camera.fov, CHASE_FOV, 1.0 - exp(-delta * 5.0))
	_remember_camera()

func _toggle_clean_view() -> void:
	clean_view = not clean_view
	clean_hint_seconds = 1.6
	_update_gate_colors()

func _update_gate_colors() -> void:
	super._update_gate_colors()
	if clean_view:
		for gate in gates: gate.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F4 and shown and not in_menu:
		_toggle_clean_view()
		get_viewport().set_input_as_handled()
		return
	super._unhandled_input(event)

func _run_visual_checks() -> void:
	var before := JSON.stringify(snapshot())
	var was_active := active
	_toggle_clean_view()
	cinematic_tests["cleanViewPreservesFlightState"] = JSON.stringify(snapshot()) == before and active == was_active
	_toggle_clean_view()
	clean_hint_seconds = 0.0
	cinematic_tests["cleanViewReversible"] = not clean_view and JSON.stringify(snapshot()) == before
	var probe := Camera3D.new()
	flight_view.add_child(probe)
	probe.fov = CHASE_FOV
	probe.global_position = jet.global_position + Basis(Vector3.UP, jet.heading) * CHASE_OFFSET
	probe.look_at(jet.global_position - jet.basis.z * 1.5, Vector3.UP)
	var screen_box := Rect2()
	var first := true
	for mesh in _mesh_nodes(model):
		var bounds := mesh.get_aabb()
		for corner in 8:
			var point := mesh.global_transform * bounds.get_endpoint(corner)
			var pixel := probe.unproject_position(point)
			if first:
				screen_box = Rect2(pixel, Vector2.ZERO)
				first = false
			else: screen_box = screen_box.expand(pixel)
	var view_size := Vector2(flight_view.size)
	var fraction := screen_box.size.x / maxf(view_size.x, 1.0)
	cinematic_tests["aircraftFraming"] = fraction > 0.18 and fraction < 0.78 and Rect2(Vector2.ZERO, view_size).encloses(screen_box)
	probe.free()
	print("J20_CINEMATIC_PROBES ", JSON.stringify({"checks": cinematic_tests, "aircraftWidthFraction": fraction, "cameraOffsetM": CHASE_OFFSET.length(), "fov": CHASE_FOV}))
	for key in cinematic_tests:
		if not cinematic_tests[key]: push_error("J20 visual check failed: " + str(key) + " width=" + str(fraction))
