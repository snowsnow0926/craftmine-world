extends "res://scripts/j20_flight.gd"
## Shares real world physics while preserving the original player/camera chain.
## The existing managed component ledger owns durable save and atomic restore.
const FlightState = preload("res://scripts/j20_state.gd")
var entity_id := "j20-player-aircraft"
var flight_view: SubViewport
var flight_started := false
var saved_camera: Dictionary = FlightState.initial().camera.duplicate(true)
var pending_state: Dictionary = {}
var persistence_tests: Dictionary = {}
var persistence_fault := ""

func _ready() -> void:
	add_to_group("craftmine_persistent_components")
	super._ready()

func _install() -> void:
	super._install()
	var container := SubViewportContainer.new()
	container.name = "FlightViewContainer"
	container.stretch = true
	container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.add_child(container)
	canvas.move_child(container, 0)
	container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	flight_view = SubViewport.new()
	flight_view.name = "FlightViewport"
	flight_view.size = Vector2i(get_viewport().get_visible_rect().size)
	flight_view.world_3d = get_world_3d()
	flight_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	flight_view.handle_input_locally = false
	container.add_child(flight_view)
	camera.reparent(flight_view)
	camera.make_current()
	get_parent().player.camera_rig.camera.make_current()
	_remember_camera()
	if not pending_state.is_empty():
		_apply_saved(pending_state)
		pending_state = {}
	persistence_tests = FlightState.round_trip_probe(self)
	for key in persistence_tests:
		if not persistence_tests[key]: persistence_fault = "飞行存档往返测试失败：" + str(key)
	print("J20_PERSISTENCE_PROBES ", JSON.stringify(persistence_tests))
	if not persistence_fault.is_empty(): push_error(persistence_fault)

func snapshot() -> Dictionary:
	if jet == null:
		return pending_state.duplicate(true) if not pending_state.is_empty() else FlightState.initial()
	return FlightState.capture(self)

func validate_state(state: Dictionary) -> String:
	if not persistence_fault.is_empty(): return persistence_fault
	return FlightState.validate(state)

func restore(state: Dictionary) -> String:
	var problem := validate_state(state)
	if not problem.is_empty(): return problem
	# Validate all fields first. The component ledger validates every component,
	# enforces exact JSON round trips and rolls back the entire save on failure.
	if jet == null:
		pending_state = state.duplicate(true)
		return ""
	_apply_saved(state)
	return ""

func _apply_saved(state: Dictionary) -> void:
	active = false
	in_menu = true
	shown = true
	_release_pilot()
	FlightState.apply_jet(jet, state.aircraft)
	flight_started = state.started
	cockpit_view = state.cockpitView
	gate_index = int(state.gateIndex)
	gear_model.scale.y = float(state.gearExtension)
	gear_model.visible = gear_model.scale.y > 0.04
	saved_camera = state.camera.duplicate(true)
	_restore_camera()
	_update_gate_colors()
	for glass in canopy_nodes: glass.visible = not cockpit_view
	for plume in engine_plumes: plume.visible = false
	canvas.show()
	for layer in base_layers: layer.hide()
	flight_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS

func _remember_camera() -> void:
	if camera == null: return
	saved_camera = {"position": FlightState.vector(camera.global_position - global_position), "rotation": FlightState.vector(camera.global_rotation), "fov": camera.fov}

func _restore_camera() -> void:
	if camera == null: return
	camera.global_position = global_position + FlightState.vec(saved_camera.position)
	camera.global_rotation = FlightState.vec(saved_camera.rotation)
	camera.fov = float(saved_camera.fov)
	camera.make_current()

func start_flight(air_start := false) -> void:
	if jet == null: return
	# Only a first start initializes a flight. A loaded or paused flight is never reset.
	if not flight_started:
		jet.reset_flight(air_start)
		jet.afterburner = false
		flight_started = true
		gate_index = 0
		_update_gate_colors()
		_snap_driving_camera()
	else:
		_restore_camera()
	_lock_player()
	shown = true
	in_menu = false
	active = true
	canvas.show()
	for layer in base_layers: layer.hide()
	flight_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	for glass in canopy_nodes: glass.visible = not cockpit_view

func _snap_driving_camera() -> void:
	if cockpit_view:
		camera.global_transform = jet.global_transform * Transform3D(Basis.IDENTITY, cockpit_position)
		camera.fov = 78.0
	else:
		camera.global_position = jet.global_position + jet.basis * Vector3(0, 5.2, 29) + Vector3.UP * 2.0
		camera.look_at(jet.global_position - jet.basis.z * 38.0 + Vector3.UP * 1.4)
		camera.fov = 64.0 + jet.airspeed * 0.025
	_remember_camera()

func reset_runway() -> void:
	jet.reset_flight(false)
	jet.afterburner = false
	flight_started = true
	gate_index = 0
	gear_model.scale.y = 1.0
	gear_model.visible = true
	_update_gate_colors()
	_snap_driving_camera()

func toggle_menu() -> void:
	if not shown: return
	if in_menu:
		start_flight(false)
	else:
		_remember_camera()
		active = false
		in_menu = true
	if DisplayServer.get_name() != "headless": Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _release_pilot() -> void:
	if not player_locked: return
	var player: PlayerController = get_parent().player
	player.set_movement_lock(self, false)
	player.input_enabled = old_input
	player_locked = false

func leave_flight() -> void:
	if not in_menu and shown: _remember_camera()
	super.leave_flight()
	if flight_view != null: flight_view.render_target_update_mode = SubViewport.UPDATE_DISABLED

func _process(delta: float) -> void:
	if jet == null or camera == null: return
	if flight_view != null and shown: flight_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	if active and shown and not in_menu:
		super._process(delta)
		_remember_camera()
	else:
		# No menu orbit, gear animation, damping or elapsed-time simulation may
		# overwrite a restored flight while the player is deciding to continue.
		if shown: _restore_camera()
		for plume in engine_plumes: plume.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if jet == null or not event is InputEventKey or not event.pressed or event.echo: return
	if not shown:
		if event.physical_keycode == KEY_F:
			shown = true
			in_menu = true
			active = false
			canvas.show()
			_restore_camera()
			for layer in base_layers: layer.hide()
		return
	if event.physical_keycode == KEY_ENTER:
		start_flight(false)
	elif event.physical_keycode == KEY_ESCAPE:
		toggle_menu()
	elif not in_menu:
		match event.physical_keycode:
			KEY_C:
				cockpit_view = not cockpit_view
				_snap_driving_camera()
			KEY_G: jet.toggle_gear()
			KEY_H:
				jet.assist = not jet.assist
				jet.message = "姿态辅助已开启" if jet.assist else "姿态辅助已关闭；松杆将保持当前姿态"
			KEY_R: reset_runway()
			_: return
	else:
		return
	get_viewport().set_input_as_handled()
