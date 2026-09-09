class_name Crosshair
extends Control

## The real screen-centre reticle.
##
## It is a full-rect Control, so its centre is the centre of the actual viewport
## at any resolution. Its shape and colours come from the CrosshairStyle of the
## equipped item, and it reacts to the live cooldown and to confirmed hits.
## `measure()` returns exactly the geometry that `_draw()` uses, so an
## acceptance check and the visible reticle cannot drift apart.

@export var hit_flash_seconds := 0.12

var equipment_state: EquipmentState
var attack_dispatcher: AttackDispatcher
var style: CrosshairStyle
var active_id: StringName = &""
var enabled_for_equipment := false
var cooldown_ratio := 0.0
var reloading := false
var hit_flash_remaining := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(queue_redraw)
	set_process(true)


func bind_world(world: BaseWorld) -> void:
	equipment_state = world.equipment_state
	attack_dispatcher = world.attack_dispatcher
	if equipment_state != null:
		if not equipment_state.equipment_changed.is_connected(_on_equipment_changed):
			equipment_state.equipment_changed.connect(_on_equipment_changed)
		if not equipment_state.cooldown_changed.is_connected(_on_cooldown_changed):
			equipment_state.cooldown_changed.connect(_on_cooldown_changed)
		if not equipment_state.reload_changed.is_connected(_on_reload_changed):
			equipment_state.reload_changed.connect(_on_reload_changed)
		_on_equipment_changed(equipment_state.active_id, equipment_state.definition())
	if attack_dispatcher != null and not attack_dispatcher.damage_dealt.is_connected(_on_damage_dealt):
		attack_dispatcher.damage_dealt.connect(_on_damage_dealt)


func _process(delta: float) -> void:
	if hit_flash_remaining <= 0.0:
		return
	hit_flash_remaining = maxf(0.0, hit_flash_remaining - delta)
	if hit_flash_remaining == 0.0:
		queue_redraw()


func _on_equipment_changed(id: StringName, definition: EquipmentDefinition) -> void:
	active_id = id
	style = definition.crosshair_style if definition != null else null
	enabled_for_equipment = definition != null and definition.crosshair_visible
	visible = enabled_for_equipment
	queue_redraw()


func _on_cooldown_changed(_id: StringName, _remaining: float, _total: float) -> void:
	if equipment_state == null:
		return
	cooldown_ratio = equipment_state.cooldown_ratio()
	queue_redraw()


func _on_reload_changed(_id: StringName, value: bool, _progress: float) -> void:
	reloading = value
	queue_redraw()


func _on_damage_dealt(_target: Object, _amount: float, _point: Vector3) -> void:
	hit_flash_remaining = hit_flash_seconds
	queue_redraw()


## Colour of the reticle right now. Exposed so the HUD and the acceptance check
## read the same value the renderer uses.
func current_color() -> Color:
	if style == null:
		return Color.TRANSPARENT
	if hit_flash_remaining > 0.0:
		return style.hit_color
	if cooldown_ratio > 0.0 or reloading:
		return style.cooldown_color
	return style.color


## The exact line/arc geometry that `_draw()` renders, in control coordinates.
func segments() -> Array:
	var result := []
	if style == null or not enabled_for_equipment:
		return result
	var centre := size * 0.5
	var half := style.size_px * 0.5
	var gap := style.gap_px
	var shape := style.shape
	if shape == CrosshairStyle.Shape.CROSS or shape == CrosshairStyle.Shape.CROSS_DOT:
		result.append({"kind": "line", "from": [centre.x - gap - half, centre.y], "to": [centre.x - gap, centre.y]})
		result.append({"kind": "line", "from": [centre.x + gap, centre.y], "to": [centre.x + gap + half, centre.y]})
		result.append({"kind": "line", "from": [centre.x, centre.y - gap - half], "to": [centre.x, centre.y - gap]})
		result.append({"kind": "line", "from": [centre.x, centre.y + gap], "to": [centre.x, centre.y + gap + half]})
	if shape == CrosshairStyle.Shape.DOT or shape == CrosshairStyle.Shape.CROSS_DOT:
		result.append({"kind": "circle", "centre": [centre.x, centre.y], "radius": maxf(1.0, style.thickness_px * 0.8)})
	if shape == CrosshairStyle.Shape.CIRCLE:
		result.append({"kind": "arc", "centre": [centre.x, centre.y], "radius": half, "width": style.thickness_px})
	return result


func _draw() -> void:
	if style == null or not enabled_for_equipment:
		return
	var colour := current_color()
	var width := style.thickness_px
	for segment in segments():
		if style.outline:
			_draw_segment(segment, Color(0.0, 0.0, 0.0, 0.55), width + 2.0)
		_draw_segment(segment, colour, width)


func _draw_segment(segment: Dictionary, colour: Color, width: float) -> void:
	match str(segment.kind):
		"line":
			draw_line(Vector2(segment.from[0], segment.from[1]), Vector2(segment.to[0], segment.to[1]), colour, width)
		"circle":
			draw_circle(Vector2(segment.centre[0], segment.centre[1]), float(segment.radius), colour)
		"arc":
			draw_arc(Vector2(segment.centre[0], segment.centre[1]), float(segment.radius), 0.0, TAU, 32, colour, float(segment.width), true)


## Observable geometry for acceptance checks and for the HUD.
func measure() -> Dictionary:
	var viewport_size := get_viewport_rect().size
	var centre := size * 0.5
	var global_centre := global_position + centre
	var colour := current_color()
	return {
		"size": [size.x, size.y],
		"center": [centre.x, centre.y],
		"globalCenter": [global_centre.x, global_centre.y],
		"viewportSize": [viewport_size.x, viewport_size.y],
		"viewportCenter": [viewport_size.x * 0.5, viewport_size.y * 0.5],
		"offsetFromViewportCenter": [global_centre.x - viewport_size.x * 0.5, global_centre.y - viewport_size.y * 0.5],
		"visible": is_visible_in_tree(),
		"enabledForEquipment": enabled_for_equipment,
		"drawn": style != null and enabled_for_equipment,
		"shape": int(style.shape) if style != null else -1,
		"color": [colour.r, colour.g, colour.b, colour.a],
		"cooldownRatio": cooldown_ratio,
		"segments": segments(),
	}
