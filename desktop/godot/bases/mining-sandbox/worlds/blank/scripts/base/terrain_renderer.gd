## Draws the visible terrain with draw_rect, one rectangle per tile.
##
## There is no PNG asset anywhere in the base: the material `color` from
## world.json is the only source of colour, which keeps the world project free of
## import dependencies and makes a headless run byte-identical to a windowed one.
## Only tiles inside the visible rect (plus one tile of margin) are drawn.
class_name MiningTerrainRenderer
extends Node2D

var terrain: MiningTerrainService
var generator: MiningTerrainGenerator

var _colors: Dictionary = {}
var _air_color := Color(0, 0, 0, 0)
var _last_rect := Rect2()
var _has_rect := false
var cursor_tile: Vector2i = Vector2i(-1, -1)
var _has_cursor := false


func setup(terrain_value: MiningTerrainService, generator_value: MiningTerrainGenerator, material_catalog: Array) -> void:
	terrain = terrain_value
	generator = generator_value
	_colors.clear()
	for entry in material_catalog:
		if entry is Dictionary and entry.get("id") is String:
			_colors[String(entry.id)] = Color.from_string(String(entry.get("color", "#ffffff")), Color.MAGENTA)
	z_index = -10
	z_as_relative = false


func invalidate() -> void:
	queue_redraw()


## The keyboard cursor used by human play. Purely visual: the gameplay rules still
## re-check reach, target and occupancy when an action is issued.
func set_cursor(tile: Vector2i) -> void:
	cursor_tile = tile
	_has_cursor = true
	queue_redraw()


func _process(_delta: float) -> void:
	var rect := visible_world_rect()
	if not _has_rect or rect != _last_rect:
		_last_rect = rect
		_has_rect = true
		queue_redraw()


func visible_world_rect() -> Rect2:
	var viewport := get_viewport()
	if viewport == null:
		return Rect2()
	var size := viewport.get_visible_rect().size
	if size.x <= 0.0 or size.y <= 0.0:
		return Rect2()
	return get_canvas_transform().affine_inverse() * Rect2(Vector2.ZERO, size)


func _draw() -> void:
	if terrain == null or generator == null:
		return
	var tile_size := float(terrain.tile_size)
	var rect := visible_world_rect()
	if rect.size == Vector2.ZERO:
		return
	rect = rect.grow(tile_size)
	var x0 := maxi(0, int(floor(rect.position.x / tile_size)))
	var y0 := maxi(0, int(floor(rect.position.y / tile_size)))
	var x1 := mini(generator.map_size.x - 1, int(floor((rect.end.x - 0.001) / tile_size)))
	var y1 := mini(generator.map_size.y - 1, int(floor((rect.end.y - 0.001) / tile_size)))
	for ty in range(y0, y1 + 1):
		for tx in range(x0, x1 + 1):
			var material := terrain.get_tile(tx, ty)
			if material.is_empty() or material == "air":
				continue
			var color: Color = _colors.get(material, Color.MAGENTA)
			draw_rect(Rect2(tx * tile_size, ty * tile_size, tile_size, tile_size), color, true)
			draw_rect(Rect2(tx * tile_size + 0.5, ty * tile_size + 0.5, tile_size - 1.0, tile_size - 1.0), color.darkened(0.35), false, 1.0)
	if _has_cursor and generator.in_bounds(cursor_tile.x, cursor_tile.y):
		var cursor_pos := Vector2(float(cursor_tile.x), float(cursor_tile.y)) * tile_size
		draw_rect(Rect2(cursor_pos, Vector2(tile_size, tile_size)), Color(1.0, 0.94, 0.55, 0.9), false, 2.0)
