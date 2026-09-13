extends "res://scripts/orgrimmar_world.gd"
# A live overview rendered in a separate viewport. The supported first-person
# controller and active camera binding of the main viewport remain unchanged.
var city_overview_layer: CanvasLayer
var city_overview_view: SubViewport

func _build_environment() -> void:
	super._build_environment()
	remove_child(overview)
	city_overview_layer = CanvasLayer.new()
	city_overview_layer.name = "LiveCityOverview"
	city_overview_layer.layer = 0
	add_child(city_overview_layer)
	var container := SubViewportContainer.new()
	container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	container.stretch = true
	container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	city_overview_layer.add_child(container)
	city_overview_view = SubViewport.new()
	city_overview_view.world_3d = get_world_3d()
	city_overview_view.size = Vector2i(1280,720)
	city_overview_view.render_target_update_mode = SubViewport.UPDATE_DISABLED
	container.add_child(city_overview_view)
	city_overview_view.add_child(overview)
	overview.clear_current(false)
	city_overview_layer.hide()
	player.camera_rig.camera.make_current()
	_apply_soft_daylight()

func _apply_soft_daylight() -> void:
	# Appearance only. Keep every imported mesh, transform and collision intact.
	# Explicit low-energy lighting, rather than relying on HDR-only web effects.
	for child in get_children():
		if child is WorldEnvironment:
			var env: Environment = child.environment
			env.ambient_light_color = Color("a5b1c0")
			env.ambient_light_energy = 0.32
			env.ambient_light_sky_contribution = 0.0
			env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
			env.tonemap_exposure = 0.85
			env.fog_light_color = Color("ad9b8e")
			env.fog_light_energy = 0.45
			env.fog_density = 0.0007
			var sky_material := env.sky.sky_material as ProceduralSkyMaterial
			if sky_material != null:
				sky_material.sky_top_color = Color("557e9a")
				sky_material.sky_horizon_color = Color("a5b3bd")
				sky_material.ground_horizon_color = Color("9d8c7e")
				sky_material.ground_bottom_color = Color("5c493e")
				sky_material.sky_energy_multiplier = 0.72
	for key in city_materials:
		var gain := 0.9
		if str(key).begins_with("wood") or key == "trunk": gain = 0.86
		elif str(key).begins_with("rock") or key in ["sand","stone"]: gain = 0.84
		elif key in ["iron","edge","gold"]: gain = 0.96
		elif key in ["fire","heart","water","foam"]: gain = 1.0
		city_materials[key].set_shader_parameter("albedo_gain",gain)

func _update_time() -> void:
	# Preserve the existing sun direction and saved time-of-day behavior.
	super._update_time()
	if sun == null: return
	sun.light_color = Color("fff1df")
	sun.light_energy = 0.12 + 0.60 * maxf(0.0,sin(time_of_day / 24.0 * PI))

func _ready() -> void:
	super._ready()
	if not ready_for_play: return
	_style_readable_label(city_title,Color("f3cf91"),28,true)
	_style_readable_label(district_label,Color("eee5d7"),16,true)
	_style_readable_label(status_label,Color("fff7e8"),18,true)
	_style_readable_label(guide_label,Color("f0d9ae"),16,true)
	_style_readable_label(message_label,Color("fff4df"),17,true)
	_style_readable_label(selection_label,Color("fff4df"),17,false)
	city_title.position = Vector2(20,12)
	district_label.position = Vector2(20,60)
	status_label.position = Vector2(20,94)
	status_label.text = "WASD 行走 · 空格 跳跃 · E 交谈\n方向键 环顾 · M 地图 · V 俯瞰 · Esc 释放鼠标"
	selection_label.position = Vector2(20,146)
	guide_label.position = Vector2(20,166)
	message_label.position = Vector2(20,205)
	message_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	message_label.custom_minimum_size = Vector2(570,0)
	message_label.size.x = 570
	city_map.position.y = 274
	for entry in [["org_look_left",KEY_LEFT],["org_look_right",KEY_RIGHT],["org_look_up",KEY_UP],["org_look_down",KEY_DOWN]]:
		if not InputMap.has_action(entry[0]):
			InputMap.add_action(entry[0])
			var key := InputEventKey.new()
			key.physical_keycode = entry[1]
			InputMap.action_add_event(entry[0],key)

func _style_readable_label(label: Label, color: Color, text_size: int, backing: bool) -> void:
	label.add_theme_color_override("font_color",color)
	label.add_theme_font_size_override("font_size",text_size)
	label.add_theme_color_override("font_outline_color",Color("100e0d"))
	label.add_theme_constant_override("outline_size",3)
	label.add_theme_color_override("font_shadow_color",Color(0.02,0.015,0.01,0.95))
	label.add_theme_constant_override("shadow_offset_x",1)
	label.add_theme_constant_override("shadow_offset_y",2)
	if backing:
		var panel := StyleBoxFlat.new()
		panel.bg_color = Color(0.065,0.05,0.04,0.88)
		panel.border_color = Color(0.50,0.37,0.21,0.8)
		panel.set_border_width_all(1)
		panel.set_corner_radius_all(4)
		panel.content_margin_left = 10
		panel.content_margin_right = 10
		panel.content_margin_top = 4
		panel.content_margin_bottom = 4
		label.add_theme_stylebox_override("normal",panel)

func _process(delta: float) -> void:
	super._process(delta)
	# Keep the existing flicker, but prevent braziers washing out nearby wood.
	for light in fire_lights:
		light.light_energy *= 0.4
	if not ready_for_play or not player.input_enabled or get_tree().paused or overview.current or player.movement_locked(): return
	if get_viewport().gui_get_focus_owner()!=null: return
	var axis := Input.get_vector("org_look_left","org_look_right","org_look_up","org_look_down")
	if axis.length_squared()>0:
		var pose := player.look()
		player.set_look(float(pose.yaw)-axis.x*deg_to_rad(85.0)*delta,float(pose.pitch)-axis.y*deg_to_rad(60.0)*delta)

func _unhandled_input(event: InputEvent) -> void:
	if ready_for_play and event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_V:
		var enter := not overview.current
		player.set_movement_lock(self,enter)
		if enter:
			city_overview_layer.show()
			city_overview_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
			overview.make_current()
		else:
			city_overview_layer.hide()
			city_overview_view.render_target_update_mode = SubViewport.UPDATE_DISABLED
			overview.clear_current(false)
		get_viewport().set_input_as_handled()
		return
	super._unhandled_input(event)
