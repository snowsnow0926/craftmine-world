## Renders durable world/creation.json entities in the top-down world.
## The file is optional: an empty or missing document leaves the authored map intact.
class_name CreationRenderer
extends Node2D

const PATH := "res://world/creation.json"
const SCALE := 32.0
var entities: Array = []
var revision := 0

func _ready() -> void:
	_reload()

func _valid_entity(value: Variant) -> bool:
	if not value is Dictionary or not value.get("id") is String or not value.get("kind") in ["tree", "rock", "chest", "door", "marker"]:
		return false
	for key in ["position", "scale"]:
		var vector: Variant = value.get(key)
		if not vector is Array or vector.size() != 3:
			return false
		for item in vector:
			if not (item is int or item is float) or not is_finite(float(item)):
				return false
	for item in value.scale:
		if item < 0.25 or item > 4: return false
	var angle: Variant = value.get("rotationY")
	return (angle is int or angle is float) and is_finite(float(angle)) and absf(float(angle)) <= 180 and value.get("color") is String and Color.html_is_valid(value.color)

func _reload() -> void:
	entities.clear()
	var file := FileAccess.open(PATH, FileAccess.READ)
	if file == null:
		queue_redraw()
		return
	if file.get_length() > 131072:
		file.close()
		return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if not parsed is Dictionary or parsed.get("format") != "craftmine.creation-scene/1" or not parsed.get("entities") is Array or parsed.entities.size() > 128:
		queue_redraw()
		return
	revision = int(parsed.get("revision", 0))
	for value in parsed.entities:
		if _valid_entity(value):
			entities.append(value)
	queue_redraw()

func _draw() -> void:
	for entity in entities:
		var p: Variant = entity.get("position", [])
		if not p is Array or p.size() != 3: continue
		var at := Vector2(float(p[0]) * SCALE + 192.0, float(p[2]) * SCALE + 128.0)
		var entity_scale: Variant = entity.get("scale", [1, 1, 1])
		var sx := float(entity_scale[0]) if entity_scale is Array and entity_scale.size() > 0 else 1.0
		var sy := float(entity_scale[1]) if entity_scale is Array and entity_scale.size() > 1 else 1.0
		var kind := String(entity.get("kind", "marker"))
		var color := Color(String(entity.get("color", "#84A866")))
		match kind:
			"tree":
				draw_rect(Rect2(at + Vector2(-8 * sx, -2 * sy), Vector2(16 * sx, 18 * sy)), Color("#76502f"))
				draw_circle(at + Vector2(0, -10 * sy), 15 * sx, color)
			"rock": draw_circle(at + Vector2(0, -5 * sy), 11 * sx, color)
			"chest":
				draw_rect(Rect2(at + Vector2(-11 * sx, -8 * sy), Vector2(22 * sx, 16 * sy)), color)
				draw_line(at + Vector2(-11 * sx, 0), at + Vector2(11 * sx, 0), Color("#3b281b"), 2)
			"door": draw_rect(Rect2(at + Vector2(-12 * sx, -24 * sy), Vector2(24 * sx, 24 * sy)), color)
			_: draw_circle(at + Vector2(0, -6 * sy), 5 * sx, color)
		# Keep identity available to observation and interaction tooling.
		draw_string(ThemeDB.fallback_font, at + Vector2(-18, 24), String(entity.id), HORIZONTAL_ALIGNMENT_LEFT, -1, 9, Color.WHITE)
