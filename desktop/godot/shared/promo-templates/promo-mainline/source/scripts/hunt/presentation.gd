extends Node

# Presentation only. This node never joins the persistent ledger, changes input,
# starts a hunt, changes actor health, or writes inventory/weapon/pet progress.
const DESIGN_SIZE := Vector2(1280, 720)
var world: Node3D
var duel: Node3D
var boss: Node3D
var weapon: Node3D
var pet: Node3D
var overlay: CanvasLayer
var root: Control
var canvas: Control
var hunt_panels: Array[Control] = []
var boss_title: Label
var boss_detail: Label
var boss_bar: ProgressBar
var health_title: Label
var stamina_title: Label
var health_bar: ProgressBar
var stamina_bar: ProgressBar
var weapon_title: Label
var weapon_detail: Label
var weapon_controls: Label
var notice_panel: PanelContainer
var notice_label: Label
var result_panel: PanelContainer
var result_title: Label
var result_detail: Label
var result_footer: Label
var entry_panel: PanelContainer
var damage_overlay: ColorRect
var hidden_hints: Dictionary = {}
var legacy_hud: CanvasLayer
var legacy_hud_visible := true
var last_size := Vector2.ZERO

func _ready() -> void:
	world = get_parent() as Node3D
	duel = world.get_node("GreatHunt") as Node3D
	boss = duel.get_node("Riftbeast") as Node3D
	weapon = world.get_node_or_null("AK47Equipment") as Node3D
	pet = world.get_node_or_null("PetDog") as Node3D
	process_priority = 100
	# UI may read the newly restored state while the host has gameplay paused.
	process_mode = Node.PROCESS_MODE_ALWAYS
	call_deferred("_setup")

func _panel(parent: Control, rect: Rect2, border: Color) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(panel)
	panel.position = rect.position
	panel.size = rect.size
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.025, 0.040, 0.049, 0.91)
	style.border_color = border
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.content_margin_left = 18.0
	style.content_margin_right = 18.0
	style.content_margin_top = 12.0
	style.content_margin_bottom = 12.0
	panel.add_theme_stylebox_override("panel", style)
	return panel

func _column(parent: Node, spacing: int = 5) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", spacing)
	parent.add_child(column)
	return column

func _label(parent: Node, font_size: int, centered: bool = false) -> Label:
	var label := Label.new()
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", Color("edf3ef"))
	var font: Font = world.get("creation_font") as Font
	if font != null: label.add_theme_font_override("font", font)
	if centered: label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	parent.add_child(label)
	return label

func _bar(parent: Node, colour: Color, maximum: float) -> ProgressBar:
	var bar := ProgressBar.new()
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.max_value = maximum
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(0, 16)
	var background := StyleBoxFlat.new()
	background.bg_color = Color("171e23")
	background.set_corner_radius_all(4)
	var fill := StyleBoxFlat.new()
	fill.bg_color = colour
	fill.set_corner_radius_all(4)
	bar.add_theme_stylebox_override("background", background)
	bar.add_theme_stylebox_override("fill", fill)
	parent.add_child(bar)
	return bar

func _setup() -> void:
	overlay = CanvasLayer.new()
	overlay.name = "HuntPresentationHUD"
	overlay.layer = 6
	add_child(overlay)
	root = Control.new()
	root.name = "ViewportRoot"
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(root)
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	damage_overlay = ColorRect.new()
	damage_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(damage_overlay)
	damage_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	damage_overlay.color = Color(0.7, 0.015, 0.025, 0)
	canvas = Control.new()
	canvas.name = "SafeLayout"
	canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(canvas)
	canvas.size = DESIGN_SIZE

	var top := _panel(canvas, Rect2(330, 20, 620, 108), Color("a68152"))
	hunt_panels.append(top)
	var top_column := _column(top, 4)
	boss_title = _label(top_column, 24, true)
	boss_bar = _bar(top_column, Color("d26a43"), 1600)
	boss_detail = _label(top_column, 17, true)

	var left := _panel(canvas, Rect2(24, 500, 440, 200), Color("547369"))
	hunt_panels.append(left)
	var left_column := _column(left, 5)
	health_title = _label(left_column, 20)
	health_bar = _bar(left_column, Color("dc655e"), 100)
	stamina_title = _label(left_column, 18)
	stamina_bar = _bar(left_column, Color("e2c766"), 100)
	var movement := _label(left_column, 17)
	movement.text = "WASD 移动 · 方向键 转视角\nShift 闪避 · 1 饮药 · Esc 暂停／继续"

	var right := _panel(canvas, Rect2(816, 500, 440, 200), Color("547369"))
	hunt_panels.append(right)
	var right_column := _column(right, 7)
	weapon_title = _label(right_column, 23)
	weapon_detail = _label(right_column, 18)
	weapon_controls = _label(right_column, 17)

	notice_panel = _panel(canvas, Rect2(310, 394, 660, 82), Color("bc9558"))
	notice_label = _label(notice_panel, 21, true)
	notice_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER

	result_panel = _panel(canvas, Rect2(360, 210, 560, 240), Color("bcab73"))
	var result_column := _column(result_panel, 12)
	result_title = _label(result_column, 32, true)
	result_detail = _label(result_column, 22, true)
	result_footer = _label(result_column, 18, true)

	entry_panel = _panel(canvas, Rect2(790, 18, 466, 74), Color("547369"))
	var entry := _label(entry_panel, 19, true)
	entry.text = "裂岳兽试炼 · H 开始\n键盘与鼠标均可操作"
	_layout()
	_refresh()

func _layout() -> void:
	var viewport_size := get_viewport().get_visible_rect().size
	if viewport_size.x <= 0 or viewport_size.y <= 0: return
	last_size = viewport_size
	# A real Control parent and a single fitted coordinate space avoid CanvasLayer
	# negative-offset anchors. Every panel fits inside the viewport at any aspect ratio.
	var factor := minf(viewport_size.x / DESIGN_SIZE.x, viewport_size.y / DESIGN_SIZE.y)
	canvas.scale = Vector2.ONE * factor
	canvas.position = (viewport_size - DESIGN_SIZE * factor) * 0.5

func _hide_hint(node: Object) -> void:
	if not is_instance_valid(node): return
	if not (node is CanvasItem or node is CanvasLayer or node is Node3D): return
	if not hidden_hints.has(node): hidden_hints[node] = bool(node.get("visible"))
	node.set("visible", false)

func _restore_hints() -> void:
	for node in hidden_hints:
		if is_instance_valid(node): node.set("visible", hidden_hints[node])
	hidden_hints.clear()

func _sync_legacy_visibility(in_hunt: bool) -> void:
	# Replace only the clipped hunt presentation; its combat component keeps running unchanged.
	var old_hud: CanvasLayer = duel.get("hud") as CanvasLayer
	if old_hud != null:
		if legacy_hud == null:
			legacy_hud = old_hud
			legacy_hud_visible = old_hud.visible
		old_hud.visible = false
	if in_hunt:
		_hide_hint(world.get("status_label"))
		_hide_hint(world.get("selection_label"))
		if pet != null:
			_hide_hint(pet.get("hud"))
			_hide_hint(pet.get("name_tag"))
		if weapon != null: _hide_hint(weapon.get("ammo_label"))
		# The small-monster encounter already owns its HUD suspension. Only its
		# unrelated floating labels are hidden here, never its actors or save data.
		for label in world.get_node("MonsterEncounter").find_children("*", "Label3D", true, false):
			_hide_hint(label)
	else:
		_restore_hints()

func _process(_delta: float) -> void:
	if canvas == null or world.get("ready_for_play") != true: return
	if last_size != get_viewport().get_visible_rect().size: _layout()
	_refresh()

func _refresh() -> void:
	if canvas == null: return
	var mode := str(duel.get("status"))
	var in_hunt := mode != "ready"
	_sync_legacy_visibility(in_hunt)
	for panel in hunt_panels: panel.visible = in_hunt
	entry_panel.visible = not in_hunt
	var hp := int(boss.get("health"))
	boss_title.text = "裂岳兽 · 已讨伐" if hp == 0 else ("裂岳兽 · 怒化" if hp <= 720 else "裂岳兽 · 大型怪物")
	boss_detail.text = "巨怪生命  %d / 1600" % hp
	boss_bar.value = hp
	health_title.text = "生命 %d / 100    ·    药剂 %d" % [int(duel.get("health")), int(duel.get("potions"))]
	stamina_title.text = "耐力 %d / 100" % roundi(float(duel.get("stamina")))
	health_bar.value = int(duel.get("health"))
	stamina_bar.value = float(duel.get("stamina"))
	damage_overlay.color.a = float(duel.get("damage_flash")) * 0.70 if in_hunt else 0.0

	var has_rifle := weapon != null and bool(weapon.get("equipped"))
	if has_rifle:
		weapon_title.text = "AK47 · 弹匣 %d / 30" % int(weapon.get("rounds"))
		var reloading := float(weapon.get("reload_remaining"))
		weapon_detail.text = "换弹中…… %.1f 秒" % reloading if reloading > 0.0 else "备用弹药 ∞"
		weapon_controls.text = "J／左键 连射 · K／右键 瞄准\nR 换弹 · 3 切回重刃\nB 返回树林"
	else:
		weapon_title.text = "重刃"
		weapon_detail.text = "出刀消耗耐力，留出闪避的余量"
		weapon_controls.text = "J／左键 轻斩 · K／右键 重斩\n2 装备 AK47\nB 返回树林"

	var terminal := mode in ["won", "failed"]
	result_panel.visible = terminal
	var paused := mode == "active" and bool(duel.get("duel_paused"))
	notice_panel.visible = mode == "active" and (paused or float(duel.get("notice_time")) > 0.0)
	notice_label.text = "试炼已暂停\nEsc 继续 · B 返回树林" if paused else str(duel.get("notice"))
	if mode == "won":
		result_title.text = "讨 伐 成 功"
		result_title.modulate = Color("a5e9c2")
		result_detail.text = "用时 %.1f 秒\n累计胜利 %d 次 · 挑战 %d 次" % [float(duel.get("elapsed")), int(duel.get("wins")), int(duel.get("attempts"))]
		result_footer.text = "B 返回树林 · H 再次挑战\n本次结果保留，不会自动重开"
	elif mode == "failed":
		result_title.text = "讨 伐 失 败"
		result_title.modulate = Color("f0b5a5")
		result_detail.text = "观察出招前摇，别把耐力用尽"
		result_footer.text = "H 重新挑战 · B 返回树林\n物品、小麦和已有进度不会丢失"

func _exit_tree() -> void:
	_restore_hints()
	if is_instance_valid(legacy_hud): legacy_hud.visible = legacy_hud_visible
