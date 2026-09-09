## Deterministic finite terrain generation (SPEC section 2).
##
## Generation is a pure integer function of (seed, tx, ty, generation params):
## no floating point, no engine RNG, no wall-clock, no iteration-order
## dependence beyond the documented in-place vein walk. `hash3` is the frozen
## mixing function; every other value is derived from it.
##
## The map is finite: tiles outside `map_size` are not generated and are
## rejected by the terrain service instead of being invented here.
class_name MiningTerrainGenerator
extends RefCounted

const ALGORITHM := "craftmine.deterministic-terrain/1"
const AIR := "air"
const BEDROCK := "bedrock"

var map_size: Vector2i = Vector2i.ZERO
var chunk_tiles: Vector2i = Vector2i(16, 16)
var terrain_seed: int = 0
var load_error: String = ""

var _generation: Dictionary = {}
var _cells: PackedStringArray = PackedStringArray()
var _built: bool = false


## Frozen mixing function. Must stay byte-identical to docs/SPEC.md section 2:
## the independent acceptance matrix re-implements exactly this arithmetic.
static func hash3(x: int, y: int, salt: int) -> int:
	var h: int = x * 73856093 + y * 19349663 + salt * 83492791
	h = (h ^ (h >> 13)) * 1274126177
	h = h ^ (h >> 16)
	return h & 0x7FFFFFFF


func configure(generation: Dictionary, chunk: Vector2i) -> void:
	_generation = generation.duplicate(true)
	chunk_tiles = chunk if chunk.x > 0 and chunk.y > 0 else Vector2i(16, 16)
	terrain_seed = int(_generation.get("seed", 0))
	var raw_size: Variant = _generation.get("mapSize", [])
	if raw_size is Array and raw_size.size() == 2:
		map_size = Vector2i(int(raw_size[0]), int(raw_size[1]))
	else:
		map_size = Vector2i.ZERO
	_built = false
	_cells = PackedStringArray()
	load_error = ""
	if str(_generation.get("algorithm", "")) != ALGORITHM:
		load_error = "unsupported terrain algorithm %s" % str(_generation.get("algorithm", ""))
	elif map_size.x <= 0 or map_size.y <= 0:
		load_error = "mapSize is invalid"


func is_valid() -> bool:
	return load_error.is_empty() and map_size.x > 0 and map_size.y > 0


func chunk_id_of(tx: int, ty: int) -> String:
	return "%d_%d" % [tx / chunk_tiles.x, ty / chunk_tiles.y]


func in_bounds(tx: int, ty: int) -> bool:
	return tx >= 0 and ty >= 0 and tx < map_size.x and ty < map_size.y


func chunk_count() -> Vector2i:
	return Vector2i((map_size.x + chunk_tiles.x - 1) / chunk_tiles.x, (map_size.y + chunk_tiles.y - 1) / chunk_tiles.y)


## Material the generator produces for a tile, "" outside the map.
func generate_cell(tx: int, ty: int) -> String:
	if not in_bounds(tx, ty):
		return ""
	_ensure_built()
	return _cells[ty * map_size.x + tx]


## Generated cells of one chunk, only the tiles that exist, sorted by (ty, tx).
func generate_chunk(cx: int, cy: int) -> Array:
	_ensure_built()
	var cells: Array = []
	var x0 := cx * chunk_tiles.x
	var y0 := cy * chunk_tiles.y
	var x1 := mini(x0 + chunk_tiles.x, map_size.x)
	var y1 := mini(y0 + chunk_tiles.y, map_size.y)
	for ty in range(y0, y1):
		for tx in range(x0, x1):
			cells.append([tx, ty, _cells[ty * map_size.x + tx]])
	return cells


## SHA-256 over "<tx>,<ty>,<material>" for every tile, joined with "\n" in
## (ty, tx) order. This is the determinism fingerprint of the generated map.
func terrain_hash() -> String:
	_ensure_built()
	var parts := PackedStringArray()
	var width := map_size.x
	for ty in range(map_size.y):
		var row := ty * width
		for tx in range(width):
			parts.append("%d,%d,%s" % [tx, ty, _cells[row + tx]])
	return "\n".join(parts).sha256_text()


# --------------------------------------------------------------- generation

func _ensure_built() -> void:
	if _built:
		return
	_built = true
	_build()


func _surface_row(tx: int) -> int:
	var surface: Dictionary = _generation.get("surface", {})
	var base_row := int(surface.get("baseRow", 8))
	var amplitude := int(surface.get("amplitude", 0))
	var span := 2 * amplitude + 1
	return base_row + (hash3(tx, 0, terrain_seed) % span) - amplitude


func _raw_at(tx: int, ty: int) -> String:
	if not in_bounds(tx, ty):
		return ""
	return _cells[ty * map_size.x + tx]


func _build() -> void:
	var width := map_size.x
	var height := map_size.y
	if width <= 0 or height <= 0:
		return
	_cells = PackedStringArray()
	_cells.resize(width * height)

	var soil_top := str(_generation.get("soilTopMaterial", "grass"))
	var soil := str(_generation.get("soilMaterial", "dirt"))
	var rock := str(_generation.get("rockMaterial", "stone"))
	var deep_rock := str(_generation.get("deepRockMaterial", rock))
	var deep_rock_row := int(_generation.get("deepRockRow", height))
	var soil_depth := int(_generation.get("soilDepth", 0))
	var bedrock_rows := int(_generation.get("bedrockRows", 0))
	var bedrock_top := height - bedrock_rows

	for tx in range(width):
		var top := _surface_row(tx)
		for ty in range(height):
			var material := AIR
			if ty >= top:
				if ty == top:
					material = soil_top
				elif ty <= top + soil_depth:
					material = soil
				else:
					material = deep_rock if ty >= deep_rock_row else rock
			if ty >= bedrock_top:
				material = BEDROCK
			_cells[ty * width + tx] = material

	_apply_ores(width, height, bedrock_top)
	_apply_caves(width, height, bedrock_top)


func _apply_ores(width: int, height: int, bedrock_top: int) -> void:
	var ores: Variant = _generation.get("ores", [])
	if not ores is Array:
		return
	for ore_index in range(ores.size()):
		var ore: Variant = ores[ore_index]
		if not ore is Dictionary:
			continue
		var material := str(ore.get("material", ""))
		if material.is_empty():
			continue
		var min_row := maxi(0, int(ore.get("minRow", 0)))
		var max_row := mini(int(ore.get("maxRow", height - 1)), height - 1)
		var chance := int(ore.get("chancePerMille", 0))
		var vein_size := int(ore.get("veinSize", 0))
		var hosts: Array = ore.get("hostMaterials", []) if ore.get("hostMaterials") is Array else []
		var salt: int = terrain_seed ^ ((ore_index + 1) * 7919)
		var vein_salt: int = terrain_seed ^ ((ore_index + 1) * 104729)
		for ty in range(min_row, max_row + 1):
			if ty >= bedrock_top:
				continue
			for tx in range(width):
				var current := _cells[ty * width + tx]
				if not hosts.has(current):
					continue
				if hash3(tx, ty, salt) % 1000 < chance:
					_grow_vein(tx, ty, material, vein_size, vein_salt, hosts, width, height)


func _grow_vein(start_x: int, start_y: int, material: String, size: int, salt: int, allowed: Array, width: int, height: int) -> void:
	var cx := start_x
	var cy := start_y
	for _step in range(maxi(0, size)):
		var current := _raw_at(cx, cy)
		if not current.is_empty() and allowed.has(current):
			_cells[cy * width + cx] = material
		match hash3(cx, cy, salt) % 4:
			0:
				cx += 1
			1:
				cx -= 1
			2:
				cy += 1
			_:
				cy -= 1
		if cx < 0 or cy < 0 or cx >= width or cy >= height:
			return


func _apply_caves(width: int, height: int, bedrock_top: int) -> void:
	var caves: Variant = _generation.get("caves", {})
	if not caves is Dictionary:
		return
	var chance := int(caves.get("chancePerMille", 0))
	var vein_size := int(caves.get("veinSize", 0))
	if chance <= 0 or vein_size <= 0:
		return
	var min_row := maxi(0, int(caves.get("minRow", 0)))
	var max_row := mini(int(caves.get("maxRow", height - 1)), height - 1)
	var salt: int = terrain_seed ^ 0x5EED
	var vein_salt: int = terrain_seed ^ 0xCA7E
	for ty in range(min_row, max_row + 1):
		if ty >= bedrock_top:
			continue
		for tx in range(width):
			var current := _cells[ty * width + tx]
			if current == AIR or current == BEDROCK:
				continue
			if hash3(tx, ty, salt) % 1000 >= chance:
				continue
			var cx := tx
			var cy := ty
			for _step in range(vein_size):
				if cy <= _surface_row(cx) or cy >= bedrock_top:
					break
				var cell := _raw_at(cx, cy)
				if not cell.is_empty() and cell != BEDROCK:
					_cells[cy * width + cx] = AIR
				match hash3(cx, cy, vein_salt) % 4:
					0:
						cx += 1
					1:
						cx -= 1
					2:
						cy += 1
					_:
						cy -= 1
				if cx < 0 or cy < 0 or cx >= width or cy >= height:
					break
