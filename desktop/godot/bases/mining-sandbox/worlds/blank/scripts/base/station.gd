## A crafting station declared in world.json `entities[]`.
##
## The entity id is the stable string id from the world data, never a node path,
## so a save survives scene edits. `recipes` is the declared recipe list; the
## crafting service still validates the recipe's own `station` field, so a station
## cannot be used to craft something it does not declare.
class_name MiningStation
extends Area2D

var entity_id: String = ""
var display_name: String = ""
var tile: Vector2i = Vector2i.ZERO
var recipes: Array = []
var data: Dictionary = {}


func setup(entity: Dictionary, resolved_tile: Vector2i, tile_size: int) -> void:
	entity_id = String(entity.get("id", ""))
	display_name = String(entity.get("name", entity_id))
	data = entity.duplicate(true)
	tile = resolved_tile
	recipes = entity.get("recipes", []) if entity.get("recipes") is Array else []
	position = Vector2(float(resolved_tile.x * tile_size) + tile_size * 0.5, float(resolved_tile.y * tile_size) + tile_size * 0.5)


func _ready() -> void:
	collision_layer = 4
	collision_mask = 1
	monitoring = true
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(16.0, 16.0)
	shape.shape = rect
	add_child(shape)
	add_to_group("mining_stations")


func offers(recipe_id: String) -> bool:
	return recipes.has(recipe_id)
