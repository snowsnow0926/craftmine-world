extends Control

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(queue_redraw)

func _draw() -> void:
	var center := size / 2.0
	draw_line(center + Vector2(-7, 0), center + Vector2(7, 0), Color.WHITE, 2)
	draw_line(center + Vector2(0, -7), center + Vector2(0, 7), Color.WHITE, 2)
