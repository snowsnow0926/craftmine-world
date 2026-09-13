extends Control
var session: Node3D
var face: Font
var start_button: Button
var back_button: Button
var menu_button: Button
var scale_ui := 1.0
var last_message := ""
var message_seconds := 0.0
const INK := Color(0.025, 0.065, 0.085, 0.47)
const MINT := Color(0.61, 0.97, 0.88)
const WHITE := Color(0.94, 0.97, 0.98)
const MUTED := Color(0.77, 0.86, 0.88)
const GOLD := Color(1.0, 0.75, 0.38)

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	face = preload("res://scripts/creation_font.gd").load_font()
	start_button = _button("开始", func(): session.start_flight(false))
	back_button = _button("返回", func(): session.leave_flight())
	menu_button = _button("Esc 菜单", func(): session.toggle_menu())

func _button(caption: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = caption
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", face)
	button.add_theme_font_size_override("font_size", 14)
	button.add_theme_color_override("font_color", WHITE)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.035, 0.10, 0.13, 0.58)
	style.border_color = Color(MINT, 0.35)
	style.set_border_width_all(1)
	style.set_corner_radius_all(4)
	button.add_theme_stylebox_override("normal", style)
	var hover: StyleBoxFlat = style.duplicate()
	hover.bg_color = Color(0.09, 0.23, 0.26, 0.86)
	button.add_theme_stylebox_override("hover", hover)
	button.pressed.connect(callback)
	add_child(button)
	return button

func _process(delta: float) -> void:
	if session == null or session.jet == null: return
	scale_ui = clampf(minf(size.x / 1280.0, size.y / 720.0), 0.72, 1.15)
	var menu: bool = session.in_menu
	var clean: bool = session.get("clean_view") == true
	start_button.visible = menu
	back_button.visible = menu
	menu_button.visible = not menu and not clean
	start_button.position = Vector2(34 * scale_ui, size.y - 80 * scale_ui)
	start_button.size = Vector2(104, 38) * scale_ui
	back_button.position = Vector2(150 * scale_ui, size.y - 80 * scale_ui)
	back_button.size = Vector2(104, 38) * scale_ui
	menu_button.position = Vector2(size.x - 108 * scale_ui, 18 * scale_ui)
	menu_button.size = Vector2(90, 28) * scale_ui
	if session.jet.message != last_message:
		last_message = session.jet.message
		message_seconds = 5.0
	message_seconds = maxf(0.0, message_seconds - delta)
	queue_redraw()

func _txt(p: Vector2, text: String, pixels: int, color := WHITE) -> void:
	draw_string(face, p + Vector2(1, 1), text, HORIZONTAL_ALIGNMENT_LEFT, -1, pixels, Color(0.015, 0.035, 0.045, 0.8))
	draw_string(face, p, text, HORIZONTAL_ALIGNMENT_LEFT, -1, pixels, color)

func _draw() -> void:
	if session == null or session.jet == null or face == null: return
	var jet: CharacterBody3D = session.jet
	var w := size.x / scale_ui
	var h := size.y / scale_ui
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE * scale_ui)
	if session.in_menu:
		draw_style_box(_panel(), Rect2(18, h - 116, minf(w - 36, 1050), 98))
		_txt(Vector2(275, h - 86), "回车继续 · W/S 油门 · ↑/↓ 俯仰 · A/D 滚转 · Q/E 方向舵", 13)
		_txt(Vector2(275, h - 62), "C 座舱 · G 起落架 · Shift 加力 · 空格 刹车 · R 重置 · F4 净画面", 13, MUTED)
		_txt(Vector2(275, h - 38), "Esc 暂停；退出前使用世界的保存功能。", 12, MUTED)
		return
	if session.get("clean_view") == true:
		if float(session.get("clean_hint_seconds")) > 0.0:
			_txt(Vector2(20, h - 20), "F4 恢复仪表 · 操纵保持不变", 12, Color(WHITE, minf(1.0, session.clean_hint_seconds)))
		return
	# Small corner identifier, not a title card across the sky.
	draw_style_box(_panel(), Rect2(18, 18, 176, 31))
	_txt(Vector2(29, 39), "歼-20  /  自由驾驶", 14)
	_txt(Vector2(w - 205, 37), "F4 净画面", 12, MUTED)
	var bearing := int(fposmod(-rad_to_deg(jet.heading), 360.0))
	_txt(Vector2(w * 0.5 - 37, 35), "%03d°" % bearing, 16, WHITE)
	draw_line(Vector2(w * 0.5 - 78, 29), Vector2(w * 0.5 - 48, 29), Color(WHITE, 0.4), 1.0)
	draw_line(Vector2(w * 0.5 + 26, 29), Vector2(w * 0.5 + 56, 29), Color(WHITE, 0.4), 1.0)
	# All flight telemetry is in a single small lower-left block.
	var y := h - 151.0
	draw_style_box(_panel(), Rect2(18, y, 188, 115))
	_txt(Vector2(29, y + 19), "空速 km/h", 11, MUTED)
	_txt(Vector2(123, y + 19), "高度 m", 11, MUTED)
	_txt(Vector2(28, y + 47), "%03d" % int(jet.airspeed * 3.6), 25, MINT)
	_txt(Vector2(122, y + 47), "%04d" % maxi(0, int(jet.position.y - jet.REST_HEIGHT)), 23)
	_txt(Vector2(29, y + 69), "油门 %d%%    升降 %+.0f" % [int(jet.throttle * 100), jet.vertical_speed], 12, MUTED)
	draw_rect(Rect2(29, y + 78, 165, 3), Color(WHITE, 0.18))
	draw_rect(Rect2(29, y + 78, 165 * jet.throttle, 3), GOLD if jet.afterburner else MINT)
	_txt(Vector2(29, y + 102), "轮 " + ("放下" if jet.gear_down else "收起") + "  ·  " + ("座舱" if session.cockpit_view else "跟随") + "  ·  C 切换", 11, MUTED)
	# Unobtrusive mini-map in the opposite corner.
	var map_center := Vector2(w - 73, h - 88)
	draw_circle(map_center, 48, INK)
	draw_arc(map_center, 47, 0, TAU, 48, Color(WHITE, 0.45), 1.0, true)
	draw_line(map_center + Vector2(0, 15), map_center - Vector2(0, 22), Color(WHITE, 0.75), 2.0)
	for i in session.gates.size():
		var p: Vector3 = session.gates[i].position
		draw_circle(map_center + Vector2(p.x, p.z) * 0.012, 2.0, GOLD if i == session.gate_index else Color(MUTED, 0.45))
	var player_map: Vector2 = (Vector2(jet.position.x, jet.position.z) * 0.012).limit_length(43)
	var marker := map_center + player_map
	draw_circle(marker, 3, MINT)
	draw_line(marker, marker + Vector2(-sin(jet.heading), -cos(jet.heading)) * 9, MINT, 2.0)
	_txt(Vector2(w - 124, h - 144), "航标 %d/%d" % [session.gate_index, session.gates.size()], 11, MUTED)
	_txt(Vector2(w - 118, h - 25), "机场 %.1f km" % (Vector2(jet.position.x, jet.position.z).length() / 1000.0), 11, MUTED)
	# Readouts are on edges; the central aircraft silhouette stays completely clear.
	if message_seconds > 0 or jet.crashed or (not jet.grounded and jet.airspeed < 63):
		_txt(Vector2(222, h - 18), jet.message, 12, GOLD if jet.crashed or jet.airspeed < 63 else WHITE)
	_txt(Vector2(21, h - 18), "W/S 油门 · ↑↓ 俯仰 · A/D 滚转", 10, MUTED)

func _panel() -> StyleBoxFlat:
	var panel := StyleBoxFlat.new()
	panel.bg_color = INK
	panel.set_corner_radius_all(5)
	return panel
