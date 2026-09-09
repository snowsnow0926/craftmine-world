# Root script for every world scene. Binding the scene is what registers stable
# entity ids and places the player at the right spawn.
class_name WorldRoot
extends Node2D

@export var scene_id: String = "overworld"


func _ready() -> void:
	Game.bind_scene(self, scene_id)


func _process(_delta: float) -> void:
	Game.tick(self)
