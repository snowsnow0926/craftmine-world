## Real StaticBody2D collision for the finite tile map.
##
## Collision is built per chunk, lazily, for a small neighbourhood around the
## player. Every maximal horizontal run of solid tiles becomes one rectangle, so
## wall and floor collision is genuine physics rather than a scripted check, and
## digging a tile immediately invalidates that chunk's shapes.
class_name MiningTerrainCollider
extends StaticBody2D

var terrain: MiningTerrainService
var generator: MiningTerrainGenerator

var radius: int = 2
var tile_size: int = 16

var _center: Vector2i = Vector2i(-99999, -99999)
var _chunks: Dictionary = {}      # chunk_id -> Array[CollisionShape2D]
var _pending: Dictionary = {}     # chunk_id -> true (needs a rebuild)


func setup(terrain_value: MiningTerrainService, generator_value: MiningTerrainGenerator) -> void:
	terrain = terrain_value
	generator = generator_value
	tile_size = terrain.tile_size
	collision_layer = 2
	collision_mask = 0


func ensure_around(world_position: Vector2) -> void:
	if generator == null:
		return
	var chunk := Vector2i(int(floor(world_position.x / float(tile_size * generator.chunk_tiles.x))), int(floor(world_position.y / float(tile_size * generator.chunk_tiles.y))))
	if chunk == _center and _pending.is_empty():
		return
	_center = chunk
	_rebuild_neighbourhood()


func invalidate(cx: int, cy: int) -> void:
	var chunk_id := "%d_%d" % [cx, cy]
	if _chunks.has(chunk_id):
		_build_chunk(cx, cy)
	else:
		_pending[chunk_id] = true


func rebuild_all() -> void:
	_chunks.clear()
	_pending.clear()
	for child in get_children():
		child.queue_free()
	_center = Vector2i(-99999, -99999)


func _rebuild_neighbourhood() -> void:
	var wanted: Dictionary = {}
	for cy in range(_center.y - radius, _center.y + radius + 1):
		for cx in range(_center.x - radius, _center.x + radius + 1):
			if cx < 0 or cy < 0 or cx >= generator.chunk_count().x or cy >= generator.chunk_count().y:
				continue
			wanted["%d_%d" % [cx, cy]] = Vector2i(cx, cy)
	for chunk_id in _chunks.keys():
		if not wanted.has(chunk_id):
			for shape in _chunks[chunk_id]:
				shape.queue_free()
			_chunks.erase(chunk_id)
			_pending.erase(chunk_id)
	for chunk_id in wanted.keys():
		var coords: Vector2i = wanted[chunk_id]
		if not _chunks.has(chunk_id) or _pending.has(chunk_id):
			_build_chunk(coords.x, coords.y)


func _build_chunk(cx: int, cy: int) -> void:
	var chunk_id := "%d_%d" % [cx, cy]
	if _chunks.has(chunk_id):
		for shape in _chunks[chunk_id]:
			shape.queue_free()
	var shapes: Array = []
	_pending.erase(chunk_id)
	var x0 := cx * generator.chunk_tiles.x
	var y0 := cy * generator.chunk_tiles.y
	var x1 := mini(x0 + generator.chunk_tiles.x, generator.map_size.x)
	var y1 := mini(y0 + generator.chunk_tiles.y, generator.map_size.y)
	for ty in range(y0, y1):
		var tx := x0
		while tx < x1:
			if not terrain.is_solid(tx, ty):
				tx += 1
				continue
			var start := tx
			while tx < x1 and terrain.is_solid(tx, ty):
				tx += 1
			var width := (tx - start) * tile_size
			var rect := RectangleShape2D.new()
			rect.size = Vector2(float(width), float(tile_size))
			var shape := CollisionShape2D.new()
			shape.shape = rect
			shape.position = Vector2(float(start * tile_size) + float(width) * 0.5, float(ty * tile_size) + float(tile_size) * 0.5)
			add_child(shape)
			shapes.append(shape)
	_chunks[chunk_id] = shapes
