extends "res://scripts/creation_world.gd"

# Additive weather skill. Base entities, player controller, save/restore and host bridge stay intact.
const COURT = preload("res://assets/blender/rainatelier.glb")
const WATER = preload("res://shaders/rain_water.gdshader")
const STORM_SKY = preload("res://shaders/rain_sky.gdshader")
const RIPPLE = preload("res://shaders/rain_ripple.gdshader")
const DROP_COUNT := 2200
const FLOOR_Y := 0.2
const CEILING_Y := 14.0
const FALL_SPEED := -8.5
const RISE_SPEED := 5.6
const PHASE_NAMES := ["雨落", "凝雨", "悬停", "逆流", "升雨", "归雨"]
enum RainPhase { FALL, BRAKE, HOLD, LIFT, RISE, RETURN }
var rain_phase: int = RainPhase.FALL
var rain_speed := FALL_SPEED
var phase_age := 0.0
var rain_clock := 0.0
var auto_performance := false
var cast_count := 0
var rain_ready := false
var drop_positions := PackedVector3Array()
var drop_sizes := PackedFloat32Array()
var drop_rates := PackedFloat32Array()
var rain_mesh: MultiMesh
var rain_material: ShaderMaterial
var ripple_material: ShaderMaterial
var rain_draw: MultiMeshInstance3D
var skill_hud: Control
var phase_text: Label
var phase_detail: Label
var steps_text: Label
var next_button: Button
var auto_button: Button
var phase_bar: ProgressBar
var rain_audio: AudioStreamPlayer
var cast_audio: AudioStreamPlayer
var self_probe: Dictionary = {}

func _ready() -> void:
	super._ready()
	if not ready_for_play: return
	_setup_court()
	_setup_weather()
	_setup_rain()
	_setup_skill_hud()
	if DisplayServer.get_name() != "headless": _setup_audio()
	rain_ready = rain_mesh != null
	_sync_drops()
	_update_skill_hud()
	if DisplayServer.get_name() == "headless": call_deferred("_run_skill_probe")

func _setup_court() -> void:
	var court: Node3D = COURT.instantiate()
	court.name = "RainAtelier"
	court.set_meta("entity_id", "rain-atelier-courtyard")
	court.set_meta("sourceJobId", "e4c5df9f-e4ae-4957-b56b-596be319be7e")
	add_child(court)
	# Keep original sandbox collision and all creation entities. New scenery has independent colliders.
	for side in [-1, 1]:
		_solid(court, Vector3(0.65,1.8,33), Vector3(side*14,0.9,0), "stone-parapet")
	_solid(court, Vector3(29,1.8,0.7), Vector3(0,0.9,-16), "stone-parapet")
	_solid(court, Vector3(4,9.2,31), Vector3(-16,4.6,1), "garden-hall")
	for x in [-8.0, 8.0]:
		_solid(court, Vector3(3,1.3,0.85), Vector3(x,0.65,-11.9), "bench")
	for p in [Vector3(-11,0.6,3),Vector3(11,0.6,2),Vector3(-10,0.6,-8),Vector3(10,0.6,-9)]:
		_solid(court,Vector3(1.3,1.2,1.3),p,"planter")
	for p in [Vector3(-13.25,3.25,3),Vector3(-13.25,3.25,-8),Vector3(13.1,3,-8),Vector3(7,3.3,-15.7),Vector3(-7,3.3,-15.7),Vector3(-5,3.2,3)]:
		var light := OmniLight3D.new()
		light.position = p
		light.light_color = Color(1.0,0.56,0.25)
		light.light_energy = 3.2
		light.omni_range = 10.5
		light.omni_attenuation = 1.0
		court.add_child(light)
		_solid(court,Vector3(0.2,p.y,0.2),Vector3(p.x,p.y*0.5,p.z),"lantern-post")
	# Neutralize only the empty base's bare wall visuals, not entities or their continuity.
	for node in get_children():
		if node is MeshInstance3D and node.mesh is BoxMesh:
			var box_mesh: BoxMesh = node.mesh
			if box_mesh.size.y == 3.0: node.visible = false

func _setup_weather() -> void:
	for node in get_children():
		if node is WorldEnvironment:
			var env: Environment = node.environment
			var sky_material := ShaderMaterial.new()
			sky_material.shader = STORM_SKY
			var sky := Sky.new()
			sky.sky_material = sky_material
			env.sky = sky
			env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
			env.ambient_light_color = Color(0.47,0.60,0.79)
			env.ambient_light_energy = 0.85
			env.fog_enabled = true
			env.fog_light_color = Color(0.12,0.19,0.28)
			env.fog_light_energy = 0.5
			env.fog_density = 0.004
	_update_time()

func _update_time() -> void:
	super._update_time()
	if sun != null:
		sun.light_energy *= 0.5
		sun.light_color = Color(0.53,0.69,0.93)

func _setup_rain() -> void:
	var template := get_node("RainAtelier").find_child("*RainDropTemplate*",true,false) as MeshInstance3D
	if template == null:
		_fail("Rain bead mesh was not imported")
		return
	template.visible = false
	rain_material = ShaderMaterial.new()
	rain_material.shader = WATER
	rain_mesh = MultiMesh.new()
	rain_mesh.transform_format = MultiMesh.TRANSFORM_3D
	rain_mesh.mesh = template.mesh
	rain_mesh.instance_count = DROP_COUNT
	rain_draw = MultiMeshInstance3D.new()
	rain_draw.name = "IndividuallySimulatedRain"
	rain_draw.multimesh = rain_mesh
	rain_draw.material_override = rain_material
	rain_draw.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	rain_draw.custom_aabb = AABB(Vector3(-32,0,-32),Vector3(64,16,64))
	add_child(rain_draw)
	var rng := RandomNumberGenerator.new()
	rng.seed = 470291
	for i in range(DROP_COUNT):
		var p := Vector3(rng.randf_range(-30,30),rng.randf_range(FLOOR_Y,CEILING_Y),rng.randf_range(-30,30))
		var size := rng.randf_range(0.035,0.073)
		if i < 1700:
			p.x = rng.randf_range(-13.6,13.6)
			p.z = rng.randf_range(-15.4,15.8)
		if i < 360:
			p = Vector3(rng.randf_range(-6,6),rng.randf_range(0.35,6.5),rng.randf_range(-6,10))
			size = rng.randf_range(0.10,0.20)
		drop_positions.append(p)
		drop_sizes.append(size)
		drop_rates.append(rng.randf_range(0.8,1.2))
	var ripples := MultiMesh.new()
	ripples.transform_format = MultiMesh.TRANSFORM_3D
	ripples.use_custom_data = true
	var plane := PlaneMesh.new()
	plane.size = Vector2(1,1)
	ripples.mesh = plane
	ripples.instance_count = 180
	for i in range(180):
		var s := rng.randf_range(0.4,1.2)
		var at := Vector3(rng.randf_range(-13,13),0.115,rng.randf_range(-15,15))
		ripples.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3(s,1,s)),at))
		ripples.set_instance_custom_data(i,Color(rng.randf(),0,0,1))
	ripple_material = ShaderMaterial.new()
	ripple_material.shader = RIPPLE
	var ripple_draw := MultiMeshInstance3D.new()
	ripple_draw.name = "RainImpactRipples"
	ripple_draw.multimesh = ripples
	ripple_draw.material_override = ripple_material
	ripple_draw.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ripple_draw)

func _unhandled_input(event: InputEvent) -> void:
	super._unhandled_input(event)
	if not rain_ready or get_tree().paused: return
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode if event.physical_keycode != 0 else event.keycode:
			KEY_Q:
				advance_rain()
				get_viewport().set_input_as_handled()
			KEY_R:
				resume_rain()
				get_viewport().set_input_as_handled()
			KEY_F:
				perform_rain()
				get_viewport().set_input_as_handled()
			KEY_H:
				skill_hud.visible = not skill_hud.visible
				get_viewport().set_input_as_handled()

func advance_rain() -> void:
	auto_performance = false
	if rain_phase == RainPhase.FALL or rain_phase == RainPhase.RETURN:
		cast_count += 1
		_change_phase(RainPhase.BRAKE)
	elif rain_phase == RainPhase.HOLD:
		_change_phase(RainPhase.LIFT)
	elif rain_phase == RainPhase.RISE or rain_phase == RainPhase.LIFT:
		_change_phase(RainPhase.RETURN)

func resume_rain() -> void:
	auto_performance = false
	if rain_phase != RainPhase.FALL: _change_phase(RainPhase.RETURN)

func perform_rain() -> void:
	if auto_performance: return
	auto_performance = true
	cast_count += 1
	_change_phase(RainPhase.BRAKE)

func _change_phase(value: int) -> void:
	rain_phase = value
	phase_age = 0.0
	if value in [RainPhase.BRAKE,RainPhase.LIFT] and is_instance_valid(cast_audio): cast_audio.play()
	_update_skill_hud()

func _process(delta: float) -> void:
	if not rain_ready: return
	_step_rain(minf(delta,0.05))
	_sync_drops()
	if phase_bar != null:
		phase_bar.value = 100.0 if rain_phase == RainPhase.HOLD else absf(rain_speed)/absf(FALL_SPEED)*100.0
	if is_instance_valid(rain_audio):
		rain_audio.volume_db = linear_to_db(maxf(0.0001,absf(rain_speed)/8.5*0.68))
		rain_audio.pitch_scale = 0.76 if rain_speed > 0 else 1.0

func _step_rain(delta: float) -> void:
	phase_age += delta
	match rain_phase:
		RainPhase.BRAKE:
			rain_speed = move_toward(rain_speed,0.0,11.0*delta)
			if rain_speed == 0.0: _change_phase(RainPhase.HOLD)
		RainPhase.HOLD:
			rain_speed = 0.0
			if auto_performance and phase_age >= 3.2: _change_phase(RainPhase.LIFT)
		RainPhase.LIFT:
			rain_speed = move_toward(rain_speed,RISE_SPEED,4.7*delta)
			if rain_speed == RISE_SPEED: _change_phase(RainPhase.RISE)
		RainPhase.RISE:
			if auto_performance and phase_age >= 4.5: _change_phase(RainPhase.RETURN)
		RainPhase.RETURN:
			rain_speed = move_toward(rain_speed,FALL_SPEED,9.0*delta)
			if rain_speed == FALL_SPEED:
				auto_performance = false
				_change_phase(RainPhase.FALL)
	# The SAME positions are integrated in both directions; HOLD never respawns, jitters or moves them.
	if rain_speed != 0.0:
		rain_clock += delta*absf(rain_speed)/8.5
		for i in range(drop_positions.size()):
			var p: Vector3 = drop_positions[i]
			p.y = wrapf(p.y+rain_speed*drop_rates[i]*delta,FLOOR_Y,CEILING_Y)
			drop_positions[i] = p

func _sync_drops() -> void:
	if rain_mesh == null: return
	var motion := clampf(absf(rain_speed)/8.5,0,1)
	for i in range(drop_positions.size()):
		var s: float = drop_sizes[i]
		var width := s*lerpf(1.0,0.3,motion)
		var height := s*lerpf(1.0,7.5,motion)
		var basis := Basis.IDENTITY.scaled(Vector3(width,height,width))
		rain_mesh.set_instance_transform(i,Transform3D(basis,drop_positions[i]))
	rain_material.set_shader_parameter("magic_strength",1.0-motion*0.55)
	ripple_material.set_shader_parameter("rain_clock",rain_clock)
	ripple_material.set_shader_parameter("strength",maxf(0,-rain_speed/8.5))

func _make_label(parent: Control, text_value: String, pos: Vector2, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text_value
	label.position = pos
	label.add_theme_font_size_override("font_size",font_size)
	label.add_theme_color_override("font_color",color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func _panel_style(color: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = Color(0.35,0.57,0.7,0.35)
	style.set_border_width_all(1)
	style.set_corner_radius_all(8)
	return style

func _button(parent: Control, text_value: String, pos: Vector2, dimensions: Vector2, action: Callable) -> Button:
	var button := Button.new()
	button.text = text_value
	button.position = pos
	button.size = dimensions
	button.focus_mode = Control.FOCUS_NONE
	button.add_theme_font_size_override("font_size",16)
	button.add_theme_stylebox_override("normal",_panel_style(Color(0.055,0.11,0.16,0.92)))
	button.add_theme_stylebox_override("hover",_panel_style(Color(0.11,0.23,0.3,0.97)))
	button.add_theme_stylebox_override("pressed",_panel_style(Color(0.2,0.37,0.45,1)))
	button.pressed.connect(action)
	parent.add_child(button)
	return button

func _setup_skill_hud() -> void:
	status_label.visible = false
	selection_label.position.y = 174
	for layer in get_children():
		if layer is CanvasLayer:
			for child in layer.get_children():
				if child is Label and child.text == "+": child.visible = false
	var layer := CanvasLayer.new()
	layer.name = "RainMagicHUD"
	layer.layer = 4
	add_child(layer)
	skill_hud = Control.new()
	skill_hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	skill_hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var theme := Theme.new()
	theme.default_font = creation_font
	skill_hud.theme = theme
	layer.add_child(skill_hud)
	_make_label(skill_hud,"THE RAIN  /  REVERSED",Vector2(30,24),13,Color(0.61,0.78,0.87))
	_make_label(skill_hud,"雨 的 逆 序",Vector2(28,45),32,Color(0.9,0.96,1))
	phase_text = _make_label(skill_hud,"01  ·  雨落",Vector2(31,96),20,Color(0.76,0.9,0.99))
	phase_detail = _make_label(skill_hud,"让世界继续，只让雨停下。",Vector2(31,126),14,Color(0.68,0.77,0.83))
	var bottom := Panel.new()
	bottom.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	bottom.offset_left = -310
	bottom.offset_right = 310
	bottom.offset_top = -120
	bottom.offset_bottom = -24
	bottom.add_theme_stylebox_override("panel",_panel_style(Color(0.025,0.05,0.085,0.84)))
	skill_hud.add_child(bottom)
	steps_text = _make_label(bottom,"01 雨落    ───    02 悬停    ───    03 逆流",Vector2(28,10),13,Color(0.65,0.8,0.89))
	next_button = _button(bottom,"Q  ·  凝住雨幕",Vector2(20,42),Vector2(240,40),advance_rain)
	auto_button = _button(bottom,"F  ·  完整施法",Vector2(272,42),Vector2(158,40),perform_rain)
	_button(bottom,"R  ·  恢复降雨",Vector2(442,42),Vector2(158,40),resume_rain)
	phase_bar = ProgressBar.new()
	phase_bar.position = Vector2(30,154)
	phase_bar.size = Vector2(240,3)
	phase_bar.show_percentage = false
	phase_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	phase_bar.add_theme_stylebox_override("background",_panel_style(Color(0.1,0.18,0.24,0.7)))
	phase_bar.add_theme_stylebox_override("fill",_panel_style(Color(0.36,0.71,0.88,0.9)))
	skill_hud.add_child(phase_bar)
	var hint := _make_label(skill_hud,"WASD 移动 · 点击画面环顾 · Esc 释放鼠标 · H 隐藏界面 · F2 对话",Vector2.ZERO,12,Color(0.64,0.72,0.79))
	hint.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	hint.offset_left = 28
	hint.offset_top = -20
	hint.offset_bottom = 0

func _update_skill_hud() -> void:
	if phase_text == null: return
	var title := "01  ·  雨落"
	var detail := "让世界继续，只让雨停下。"
	var action := "Q  ·  凝住雨幕"
	match rain_phase:
		RainPhase.BRAKE:
			title = "02  ·  时间渐止"
			detail = "雨丝正在凝成水珠……"
			action = "正在凝雨…"
		RainPhase.HOLD:
			title = "02  ·  万千雨滴，悬于此刻"
			detail = "可以走进雨中。再次按 Q，让雨倒流。"
			action = "Q  ·  让雨逆流"
		RainPhase.LIFT, RainPhase.RISE:
			title = "03  ·  雨，回到天空"
			detail = "同一场雨，正在向上流动。"
			action = "Q  ·  归还重力"
		RainPhase.RETURN:
			title = "01  ·  重力归来"
			detail = "雨幕恢复，随时再次施法。"
	phase_text.text = title
	phase_detail.text = detail
	next_button.text = action
	next_button.disabled = rain_phase == RainPhase.BRAKE
	auto_button.text = "演出中…" if auto_performance else "F  ·  完整施法"

func _wave(kind: int) -> AudioStreamWAV:
	var rate := 22050
	var seconds := 1.6 if kind == 0 else 0.85
	var frames := int(rate*seconds)
	var data := PackedByteArray()
	data.resize(frames*2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 723+kind
	var filtered := 0.0
	for i in range(frames):
		var t := float(i)/rate
		var sample := rng.randf_range(-1,1)
		filtered = filtered*0.83+sample*0.17
		if kind == 0:
			sample = (sample*0.1+filtered*0.48)*0.35
		else:
			var envelope := pow(sin(PI*t/seconds),2.0)
			sample = (sin(TAU*(250*t+180*t*t))*0.21+sin(TAU*523.25*t)*0.12+filtered*0.25)*envelope
		var value := int(clampf(sample,-1,1)*32767)
		data.encode_s16(i*2,value)
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.data = data
	if kind == 0:
		wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
		wav.loop_end = frames
	return wav

func _setup_audio() -> void:
	rain_audio = AudioStreamPlayer.new()
	rain_audio.name = "RainSound"
	rain_audio.stream = _wave(0)
	add_child(rain_audio)
	rain_audio.play()
	cast_audio = AudioStreamPlayer.new()
	cast_audio.name = "RainCastSound"
	cast_audio.stream = _wave(1)
	cast_audio.volume_db = -8
	add_child(cast_audio)

func _probe_key(key: int) -> void:
	var event := InputEventKey.new()
	event.physical_keycode = key
	event.pressed = true
	_unhandled_input(event)

func _run_skill_probe() -> void:
	# This is supplementary executed gameplay evidence, never a replacement for frozen host checks.
	if not rain_ready: return
	var before := drop_positions.duplicate()
	var original_clock := rain_clock
	var first_y: float = drop_positions[0].y
	_step_rain(0.01)
	var falling := drop_positions[0].y < first_y
	_probe_key(KEY_Q)
	for tick in range(40): _step_rain(1.0/30.0)
	_sync_drops()
	var held := drop_positions.duplicate()
	var rendered_held := rain_mesh.get_instance_transform(0)
	for tick in range(60): _step_rain(1.0/30.0)
	_sync_drops()
	var stopped := rain_phase == RainPhase.HOLD and held == drop_positions and rendered_held == rain_mesh.get_instance_transform(0)
	_probe_key(KEY_Q)
	for tick in range(45): _step_rain(1.0/30.0)
	var index := 0
	for i in range(drop_positions.size()):
		if drop_positions[i].y > 2 and drop_positions[i].y < 10:
			index = i
			break
	var rising_start: float = drop_positions[index].y
	_step_rain(0.05)
	_sync_drops()
	var rising := rain_speed > 0 and rain_phase == RainPhase.RISE and rain_mesh.get_instance_transform(index).origin.y > rising_start
	_probe_key(KEY_R)
	for tick in range(55): _step_rain(1.0/30.0)
	var reset_ok := rain_phase == RainPhase.FALL and rain_speed == FALL_SPEED
	_probe_key(KEY_F)
	for tick in range(400): _step_rain(1.0/30.0)
	var performance_ok := rain_phase == RainPhase.FALL and not auto_performance
	self_probe = {"falling":falling,"frozenPositionsAndTransforms":stopped,"upwardRenderedDisplacement":rising,"reset":reset_ok,"fullSequence":performance_ok,"movementNotLocked":not player.movement_locked(),"sameDropCount":drop_positions.size()==DROP_COUNT}
	print("RAIN_MAGIC_EXECUTED_PROBE="+JSON.stringify(self_probe))
	for value in self_probe.values():
		if value != true: push_error("Rain magic executed probe failed: "+JSON.stringify(self_probe))
	drop_positions = before
	rain_speed = FALL_SPEED
	rain_clock = original_clock
	auto_performance = false
	cast_count = 0
	_change_phase(RainPhase.FALL)
	_sync_drops()

func observe() -> Dictionary:
	var result := super.observe()
	var samples := []
	for i in range(mini(4,drop_positions.size())):
		var p: Vector3 = drop_positions[i]
		samples.append([p.x,p.y,p.z])
	result.creation["rainMagic"] = {"phase":PHASE_NAMES[rain_phase],"signedVelocity":rain_speed,"dropCount":drop_positions.size(),"samplePositions":samples,"automatic":auto_performance,"casts":cast_count,"supplementaryHeadlessProbe":self_probe.duplicate(true)}
	return result
