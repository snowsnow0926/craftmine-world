# Builds a real TileMapLayer plus real StaticBody2D collision from a text map.
#
# Maps live in res://data/maps/<id>.json as character rows with a legend. That
# keeps the map editable in a plain text editor (or by a model) and avoids a
# binary tile_map_data blob. Collision comes from a layer flagged
# `"collision": true`: every maximal horizontal run of solid cells becomes one
# rectangle, so wall collision is genuine physics, not a scripted check.
class_name MapRenderer
extends Node2D

@export var map_id: String = ""
@export var tile_set_path: String = "res://assets/tiles/town_tiles.tres"
@export var build_collision: bool = true

var map: Dictionary = {}
var build_report: Dictionary = {}


func _ready() -> void:
	add_to_group("maps")
	build()


func build() -> Dictionary:
	map = _load_map()
	if map.is_empty():
		build_report = {"ok": false, "error": "map_not_found", "mapId": map_id}
		push_error("Map '%s' could not be loaded" % map_id)
		return build_report

	var tile_size := int(map.get("tileSize", 16))
	var legend: Dictionary = map.get("legend", {})
	var tile_layer := get_node_or_null("Tiles") as TileMapLayer
	var collision_body := get_node_or_null("Collision") as StaticBody2D
	if tile_layer != null:
		tile_layer.clear()

	var cells := 0
	var solid_cells := 0
	var effective_width := 0
	var effective_height := 0
	for layer in map.get("layers", []):
		if not layer is Dictionary:
			continue
		var rows: Array = layer.get("rows", [])
		effective_height = maxi(effective_height, rows.size())
		var is_collision := bool(layer.get("collision", false))
		for y in range(rows.size()):
			var row := String(rows[y])
			effective_width = maxi(effective_width, row.length())
			for x in range(row.length()):
				var entry: Variant = legend.get(row[x])
				if not entry is Dictionary:
					continue
				if is_collision:
					if bool(entry.get("solid", false)):
						solid_cells += 1
					continue
				var coords: Array = entry.get("atlas", [])
				if coords.size() != 2 or tile_layer == null:
					continue
				tile_layer.set_cell(Vector2i(x, y), 0, Vector2i(int(coords[0]), int(coords[1])))
				cells += 1

	var shapes := 0
	if build_collision and collision_body != null:
		shapes = _build_collision(collision_body, tile_size)

	build_report = {
		"ok": true,
		"mapId": map_id,
		"tileSize": tile_size,
		"tiles": cells,
		"solidCells": solid_cells,
		"collisionShapes": shapes,
		"width": int(map.get("width", 0)),
		"height": int(map.get("height", 0)),
		"effectiveWidth": effective_width,
		"effectiveHeight": effective_height,
	}
	# Limits follow the actual row data, so a row longer than the declared width
	# still gets a camera that can reach it.
	call_deferred("_apply_camera_limits", effective_width * tile_size, effective_height * tile_size)
	return build_report


# Keeps the viewport inside the map when the map is larger than the viewport.
# A map smaller than the viewport still shows background around it, which is
# expected and visible in the blank start world.
func _apply_camera_limits(width_px: int, height_px: int) -> void:
	# A managed restore may replace this scene before the deferred call runs.
	if not is_inside_tree():
		return
	if width_px <= 0 or height_px <= 0:
		return
	for node in get_tree().get_nodes_in_group("camera"):
		var camera := node as Camera2D
		if camera == null:
			continue
		camera.limit_left = 0
		camera.limit_top = 0
		camera.limit_right = width_px
		camera.limit_bottom = height_px


func _build_collision(body: StaticBody2D, tile_size: int) -> int:
	for child in body.get_children():
		child.queue_free()
	var legend: Dictionary = map.get("legend", {})
	var shapes := 0
	for layer in map.get("layers", []):
		if not layer is Dictionary or not bool(layer.get("collision", false)):
			continue
		var rows: Array = layer.get("rows", [])
		for y in range(rows.size()):
			var row := String(rows[y])
			var x := 0
			while x < row.length():
				if not _is_solid(legend, row[x]):
					x += 1
					continue
				var start := x
				while x < row.length() and _is_solid(legend, row[x]):
					x += 1
				var width := (x - start) * tile_size
				var rect := RectangleShape2D.new()
				rect.size = Vector2(width, tile_size)
				var shape := CollisionShape2D.new()
				shape.shape = rect
				shape.position = Vector2(start * tile_size + width * 0.5, y * tile_size + tile_size * 0.5)
				body.add_child(shape)
				shapes += 1
	return shapes


static func _is_solid(legend: Dictionary, symbol: String) -> bool:
	var entry: Variant = legend.get(symbol)
	return entry is Dictionary and bool(entry.get("solid", false))


func _load_map() -> Dictionary:
	var path := "res://data/maps/%s.json" % map_id
	if not FileAccess.file_exists(path):
		return {}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	return parsed if parsed is Dictionary else {}
