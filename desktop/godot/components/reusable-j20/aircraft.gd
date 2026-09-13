extends "res://addons/cw.module.reusable-j20/flight_physics.gd"

const STATE_FORMAT := "craftmine.reusable-j20-state/1"
const ACTIONS := {"throttle_up":KEY_W,"throttle_down":KEY_S,"pitch_up":KEY_DOWN,"pitch_down":KEY_UP,"roll_left":KEY_A,"roll_right":KEY_D,"rudder_left":KEY_Q,"rudder_right":KEY_E,"brake":KEY_SPACE,"boost":KEY_SHIFT,"gear":KEY_G,"camera":KEY_C,"exit":KEY_ENTER}
@export var entity_id := "aircraft"
@export var aircraft_name := "歼二十"
@export var model_scene: PackedScene
@export var player_path := NodePath("../Player")
@export var runway_length := 2400.0
@export var runway_width := 56.0
var piloted := false
var cockpit_view := false
var configuration_error := ""
var _settings: Dictionary
var _source_settings: Dictionary
var _player: CharacterBody3D
var _camera: Camera3D
var _previous_camera: Camera3D
var _hud: Label
var _canvas: CanvasLayer
var _gear: Node3D
var _runway_origin := Vector3.ZERO
var _boarding_position := Vector3.ZERO
var _hull: CollisionShape3D
var _input_before := false
var _pressed := {}
var _pending_camera := false

func _ready() -> void:
	add_to_group("craftmine_persistent_components")
	add_to_group("craftmine_aircraft")
	super._ready()
	collision_layer = 18 # A normal world object (2) and aircraft (16).
	collision_mask = 19 # Terrain (1), world objects (2), and other aircraft (16).
	set_meta("entity_id", entity_id)
	_source_settings = {"name":aircraft_name}
	_source_settings.make_read_only()
	_settings = _source_settings.duplicate(true)
	_player = get_node_or_null(player_path) as CharacterBody3D
	if _player != null: _input_before = _player.input_enabled
	_runway_origin = global_position
	rest_height = global_position.y
	_hull = get_child(0) as CollisionShape3D
	if entity_id.is_empty() or _player == null or not _player.has_method("set_movement_lock") or model_scene == null or rotation != Vector3.ZERO or scale != Vector3.ONE or get_parent().global_transform != Transform3D.IDENTITY or runway_length < 2000 or runway_width < 40:
		configuration_error = "J20_REQUIRES_STANDARD_PLAYER_AND_LEVEL_PLACEMENT"
		set_physics_process(false)
		return
	for action in ACTIONS:
		var name := "cw_j20_" + str(action)
		if not InputMap.has_action(name):
			InputMap.add_action(name)
			var event := InputEventKey.new()
			event.physical_keycode = ACTIONS[action]
			InputMap.action_add_event(name,event)
	_install_model()
	_camera = Camera3D.new()
	_camera.name = "AircraftCamera"
	_camera.far = 25000.0
	_camera.near = 0.1
	_camera.fov = 64.0
	add_child(_camera)
	_canvas = CanvasLayer.new()
	_canvas.layer = 8
	add_child(_canvas)
	_hud = Label.new()
	_hud.position = Vector2(24,62)
	_hud.add_theme_font_size_override("font_size",18)
	_hud.add_theme_color_override("font_color",Color.WHITE)
	_hud.add_theme_color_override("font_shadow_color",Color.BLACK)
	_hud.add_theme_constant_override("shadow_offset_x",2)
	_hud.add_theme_constant_override("shadow_offset_y",2)
	_hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var font: Variant = get_parent().get("creation_font")
	if font is Font: _hud.add_theme_font_override("font",font)
	_canvas.add_child(_hud)
	_canvas.hide()
	_sync_hud_font.call_deferred()

func _sync_hud_font() -> void:
	# Child ready runs before the world loads its bundled font.
	var font: Variant = get_parent().get("creation_font")
	if font is Font: _hud.add_theme_font_override("font",font)

func _install_model() -> void:
	var model := model_scene.instantiate() as Node3D
	model.name = "ApprovedJ20Model"
	add_child(model)
	var meshes := model.find_children("*","MeshInstance3D",true,false)
	var bounds := AABB()
	var first := true
	var canopy := Vector3.ZERO
	var exhaust := Vector3.ZERO
	for mesh in meshes:
		var box: AABB = model.global_transform.affine_inverse() * mesh.global_transform * mesh.get_aabb()
		bounds = box if first else bounds.merge(box)
		first = false
		if "canopy" in str(mesh.name).to_lower(): canopy = box.get_center()
		if "exhaust" in str(mesh.name).to_lower(): exhaust = box.get_center()
	model.scale = Vector3.ONE * (20.4 / maxf(bounds.size.z,0.01))
	model.rotation.y = PI if canopy.z > exhaust.z else 0.0
	model.position = -(model.basis * bounds.get_center())
	_gear = Node3D.new()
	_gear.name = "LandingGear"
	add_child(_gear)
	for point in [Vector3(-1.4,-1.55,1.4),Vector3(1.4,-1.55,1.4),Vector3(0,-1.55,-5)]:
		var wheel := MeshInstance3D.new()
		var mesh := CylinderMesh.new()
		mesh.top_radius = 0.4
		mesh.bottom_radius = 0.4
		mesh.height = 0.24
		wheel.mesh = mesh
		wheel.rotation.z = PI / 2.0
		wheel.position = point
		var material := StandardMaterial3D.new()
		material.albedo_color = Color("20242b")
		wheel.material_override = material
		_gear.add_child(wheel)

func action(name: String) -> String:
	return "cw_j20_" + name

func _physics_process(delta: float) -> void:
	if not configuration_error.is_empty(): return
	if piloted:
		if _pending_camera:
			_camera.make_current()
			_canvas.show()
			_pending_camera = false
		# Keys are scoped to the active aircraft. The on-foot controller retains
		# its own transform and normal collision validation at the boarding point.
		if _edge("gear"): toggle_gear()
		if _edge("camera"): cockpit_view = not cockpit_view
		if _edge("exit"): exit_aircraft()
		if piloted:
			simulate(delta,{"throttle":Input.get_axis(action("throttle_down"),action("throttle_up")),"pitch":Input.get_axis(action("pitch_down"),action("pitch_up")),"roll":Input.get_axis(action("roll_right"),action("roll_left")),"rudder":Input.get_axis(action("rudder_right"),action("rudder_left")),"brake":Input.is_action_pressed(action("brake")),"boost":Input.is_action_pressed(action("boost"))})
		_update_camera()
	_gear.visible = gear_down
	if piloted:
		_hud.text = "%s  |  %.0f km/h  |  %.0f m  |  油门 %.0f%%\n%s\nW/S 油门 · ↑/↓ 俯仰 · A/D 压坡度 · Q/E 方向舵 · 空格刹车\nG 起落架 · C 座舱/跟随 · Enter 停稳后返回登机点" % [_settings.name,airspeed*3.6,global_position.y-rest_height,throttle*100,message]

func _input(event: InputEvent) -> void:
	if not piloted or get_tree().paused or not event is InputEventKey: return
	# Consume vehicle keys before the base's E interaction or other controllers.
	for key in ACTIONS.values():
		if event.physical_keycode == key: get_viewport().set_input_as_handled();return

func _edge(name: String) -> bool:
	var held := Input.is_action_pressed(action(name))
	var previous: bool = _pressed.get(name,false)
	_pressed[name] = held
	return held and not previous

func on_runway() -> bool:
	var offset := global_position - _runway_origin
	return absf(offset.x) < runway_width / 2.0 and offset.z > -runway_length + 400.0 and offset.z < 400.0

func telemetry() -> Dictionary:
	var result := super.telemetry()
	result.message = message
	result.pitch = pitch
	result.bank = bank
	result.heading = heading
	result.onRunway = on_runway()
	return result

func crash(reason: String) -> void:
	super.crash(reason)
	message = reason.split("·")[0].strip_edges() + "；Enter 结束驾驶，飞机保留在事故位置"

func interact(actor: Node3D) -> Dictionary:
	if not configuration_error.is_empty() or actor != _player: return {"interacted":false,"reason":"unavailable"}
	if piloted: return exit_aircraft()
	for aircraft in get_tree().get_nodes_in_group("craftmine_aircraft"):
		if aircraft != self and aircraft.get("piloted") == true: return {"interacted":false,"reason":"another-aircraft-active"}
	var local := to_local(_player.global_position)
	var nearest := Vector3(clampf(local.x,-1.85,1.85),clampf(local.y,-1.05,1.05),clampf(local.z,-6.25,6.25))
	if local.distance_to(nearest) > 3.5 or not grounded or airspeed > 0.5 or crashed: return {"interacted":false,"reason":"board-near-stopped-aircraft"}
	var query := PhysicsRayQueryParameters3D.create(_player.global_position+Vector3.UP*0.6,to_global(nearest),1,[_player.get_rid(),get_rid()])
	if not get_world_3d().direct_space_state.intersect_ray(query).is_empty(): return {"interacted":false,"reason":"boarding-obstructed"}
	var runway := inspect_runway()
	if not runway.available: return {"interacted":false,"reason":runway.reason,"requirements":runway}
	_boarding_position = _player.global_position
	_previous_camera = get_viewport().get_camera_3d()
	_input_before = _player.input_enabled
	_set_piloted(true)
	return {"interacted":true,"entityId":entity_id,"kind":"drivable-j20","feedback":"已登机；W 加油门，达到 240 km/h 后按 ↓ 抬头起飞"}

func inspect_runway() -> Dictionary:
	# The aircraft never removes world colliders or fabricates a runway. A finite
	# stock sandbox is rejected until its author supplies a real open flight area.
	var space := get_world_3d().direct_space_state
	for lateral in [-10.0,0.0,10.0]:
		var start := _runway_origin + Vector3(lateral,0,300)
		var end := _runway_origin + Vector3(lateral,0,-runway_length+400)
		var clear := PhysicsRayQueryParameters3D.create(start,end,1,[get_rid()])
		if not space.intersect_ray(clear).is_empty(): return {"available":false,"reason":"J20_RUNWAY_OBSTRUCTED","requiredLengthM":runway_length,"requiredWidthM":runway_width}
		for step in range(25):
			var point := start.lerp(end,float(step)/24.0)
			var floor_query := PhysicsRayQueryParameters3D.create(point,point-Vector3.UP*3.0,1,[get_rid()])
			var floor_hit := space.intersect_ray(floor_query)
			if floor_hit.is_empty() or absf(float(floor_hit.position.y)-(rest_height-2.18)) > 0.15 or floor_hit.normal.dot(Vector3.UP) < 0.99: return {"available":false,"reason":"J20_LEVEL_RUNWAY_REQUIRED","requiredLengthM":runway_length,"requiredWidthM":runway_width}
	return {"available":true,"requiredLengthM":runway_length,"requiredWidthM":runway_width}

func _set_piloted(value: bool,present := true) -> void:
	var owned := piloted
	piloted = value
	if not is_instance_valid(_player): return
	if value and not owned:
		_input_before = _player.input_enabled
		_previous_camera = get_viewport().get_camera_3d()
	_player.set_movement_lock(self,value)
	# Input is restored only for the controller this component owns.
	if value: _player.input_enabled = false
	elif owned: _player.input_enabled = _input_before
	_pending_camera = value and not present
	if is_instance_valid(_canvas): _canvas.visible = value and present
	if is_instance_valid(_camera):
		if value and present: _update_camera();_camera.make_current()
		elif owned:
			var camera: Camera3D = _previous_camera if is_instance_valid(_previous_camera) else _player.camera_rig.camera
			if is_instance_valid(camera): camera.make_current()

func _update_camera() -> void:
	if not is_instance_valid(_camera): return
	_camera.position = Vector3(0,1.35,-4.5) if cockpit_view else Vector3(0,7.5,29)
	_camera.rotation = Vector3.ZERO if cockpit_view else Vector3(-0.16,0,0)

func exit_aircraft() -> Dictionary:
	if not piloted: return {"interacted":false,"reason":"not-piloting"}
	if crashed:
		_set_piloted(false)
		return {"interacted":true,"entityId":entity_id,"kind":"drivable-j20","feedback":"驾驶已结束；飞机保留在事故位置，步行角色仍在原登机点"}
	if not grounded or airspeed > 0.5 or Vector2(global_position.x-_runway_origin.x,global_position.z-_runway_origin.z).length() > 18.0:
		message = "请返回登机区域、放下起落架并刹车停稳后再离机"
		return {"interacted":false,"reason":"return-to-boarding-area-and-stop"}
	if _player.global_position.distance_to(_boarding_position) > 0.1: return {"interacted":false,"reason":"boarding-position-changed"}
	_set_piloted(false)
	return {"interacted":true,"entityId":entity_id,"kind":"drivable-j20","feedback":"已离机；继续步行探索"}

func snapshot() -> Dictionary:
	return JSON.parse_string(JSON.stringify({"format":STATE_FORMAT,"entityId":entity_id,"settings":_settings.duplicate(true),"sourceSettings":_source_settings.duplicate(true),"position":_array(global_position),"velocity":_array(velocity),"throttle":throttle,"airspeed":airspeed,"pitch":pitch,"heading":heading,"bank":bank,"gearDown":gear_down,"grounded":grounded,"crashed":crashed,"assist":assist,"afterburner":afterburner,"verticalSpeed":vertical_speed,"flightSeconds":flight_seconds,"landings":landings,"hasFlown":has_flown,"piloted":piloted,"cockpitView":cockpit_view,"boardingPosition":_array(_boarding_position)}))

func validate_state(data: Dictionary) -> String:
	var keys := ["format","entityId","settings","sourceSettings","position","velocity","throttle","airspeed","pitch","heading","bank","gearDown","grounded","crashed","assist","afterburner","verticalSpeed","flightSeconds","landings","hasFlown","piloted","cockpitView","boardingPosition"]
	if not configuration_error.is_empty() or data.size() != keys.size(): return "J20_STATE_INVALID"
	for key in keys:
		if not data.has(key): return "J20_STATE_INVALID"
	if data.format != STATE_FORMAT or data.entityId != entity_id or data.sourceSettings != _source_settings or not data.settings is Dictionary or data.settings.size() != 1 or not data.settings.get("name") is String or data.settings.name.is_empty() or data.settings.name.length() > 80: return "J20_STATE_IDENTITY_INVALID"
	for key in ["position","velocity","boardingPosition"]:
		if not data[key] is Array or data[key].size() != 3: return "J20_STATE_VECTOR_INVALID"
		for value in data[key]:
			if not _finite(value,-20000,20000): return "J20_STATE_VECTOR_INVALID"
	for key in ["throttle","airspeed","pitch","heading","bank","verticalSpeed","flightSeconds","landings"]:
		if not _finite(data[key],-1000000,1000000): return "J20_STATE_NUMBER_INVALID"
	if data.throttle < 0 or data.throttle > 1 or data.airspeed < 0 or data.airspeed > 430 or absf(data.pitch) > 1.15 or absf(data.heading) > PI or absf(data.bank) > 1.45 or data.flightSeconds < 0 or data.landings < 0 or data.landings != floorf(data.landings): return "J20_STATE_RANGE_INVALID"
	for key in ["gearDown","grounded","crashed","assist","afterburner","hasFlown","piloted","cockpitView"]:
		if not data[key] is bool: return "J20_STATE_FLAG_INVALID"
	# Collision recovery can displace an accident pose from the ideal taxi
	# elevation. Preserve that actual stopped pose; restored overlap is still
	# checked against native world collision instead of snapping it back.
	if data.grounded and (not data.gearDown or (not data.crashed and absf(data.position[1]-rest_height) > 0.005)): return "J20_GROUND_STATE_INVALID"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	_settings = data.settings.duplicate(true)
	global_position = _vector(data.position)
	velocity = _vector(data.velocity)
	throttle = data.throttle
	airspeed = data.airspeed
	pitch = data.pitch
	heading = data.heading
	bank = data.bank
	rotation = Vector3(pitch,heading,bank)
	gear_down = data.gearDown
	grounded = data.grounded
	crashed = data.crashed
	assist = data.assist
	afterburner = data.afterburner
	vertical_speed = data.verticalSpeed
	flight_seconds = data.flightSeconds
	landings = int(data.landings)
	has_flown = data.hasFlown
	cockpit_view = data.cockpitView
	_boarding_position = _vector(data.boardingPosition)
	# The unchanged native restore guard checks the real on-foot controller
	# while paused. Flight presentation activates on ordinary resume, after that
	# check; aircraft state itself has already been restored exactly above.
	_set_piloted(data.piloted,false)
	if crashed: message = "飞机发生事故；Enter 结束驾驶，飞机保留在事故位置"
	_gear.visible = gear_down
	return ""

func validate_restored_state() -> String:
	var active := 0
	for aircraft in get_tree().get_nodes_in_group("craftmine_aircraft"):
		if aircraft.get("piloted") == true: active += 1
	if active > 1: return "J20_MULTIPLE_ACTIVE_PILOTS"
	if piloted and _player.global_position.distance_to(_boarding_position) > 0.1: return "J20_BOARDING_STATE_CHANGED"
	force_update_transform()
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = _hull.shape
	query.transform = _hull.global_transform
	query.collision_mask = collision_mask
	query.exclude = [get_rid()]
	query.margin = 0.0
	return "" if get_world_3d().direct_space_state.intersect_shape(query,1).is_empty() else "J20_RESTORE_OVERLAP"

func _exit_tree() -> void:
	if is_instance_valid(_player):
		_player.set_movement_lock(self,false)
		if piloted: _player.input_enabled = _input_before
	if piloted and is_instance_valid(_previous_camera): _previous_camera.make_current()

func _array(value: Vector3) -> Array:
	return [value.x,value.y,value.z]

func _vector(value: Array) -> Vector3:
	return Vector3(value[0],value[1],value[2])

func _finite(value: Variant,low: float,high: float) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and value >= low and value <= high
