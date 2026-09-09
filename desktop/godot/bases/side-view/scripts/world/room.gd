## One side-view room, built from world data.
##
## The room owns static geometry and non-player entities. It never writes state
## directly for persistent facts: every pickup, checkpoint and target calls into
## WorldState through the runtime, and is rebuilt from that state on entry. That
## is what makes "switch room, save, restart" keep the same facts.
class_name SideViewRoom
extends Node2D

signal transition_requested(target_room: String, target_spawn: String)

var room_id: String = ""
var data: Dictionary = {}
var config: SideViewConfig
var state: WorldState
var runtime: Node
var bounds: Rect2 = Rect2()
var _spawns: Dictionary = {}

func build(room_data: Dictionary, config_value: SideViewConfig, state_value: WorldState, runtime_node: Node) -> void:
	data = room_data
	room_id = str(room_data.get("id", "room"))
	config = config_value
	state = state_value
	runtime = runtime_node
	name = room_id
	_build_bounds()
	_build_spawns()
	_build_solids()
	_build_doors()
	_build_checkpoints()
	_build_abilities()
	_build_rewards()
	_build_targets()
	_build_hazards()
	queue_redraw()

func _build_bounds() -> void:
	var raw: Dictionary = data.get("bounds", {})
	bounds = Rect2(
		float(raw.get("x", 0.0)),
		float(raw.get("y", 0.0)),
		float(raw.get("w", 640.0)),
		float(raw.get("h", 360.0))
	)

func get_room_bounds() -> Rect2:
	return bounds

func _build_spawns() -> void:
	for raw_spawn: Variant in data.get("spawns", []):
		if typeof(raw_spawn) != TYPE_DICTIONARY:
			continue
		var spawn: Dictionary = raw_spawn
		_spawns[str(spawn.get("id", ""))] = {
			"x": float(spawn.get("x", bounds.position.x)),
			"y": float(spawn.get("y", bounds.position.y)),
			"facing": int(spawn.get("facing", 1)),
		}

func spawn_point(spawn_id: String) -> Dictionary:
	if _spawns.has(spawn_id):
		return _spawns[spawn_id]
	# Fall back to the first declared spawn so a mistyped id cannot strand the player.
	for key: Variant in _spawns.keys():
		return _spawns[key]
	return {"x": bounds.position.x + bounds.size.x * 0.5, "y": bounds.position.y + bounds.size.y * 0.5, "facing": 1}

## Respawn target for the player's death path.
func respawn_point(checkpoint_id: String) -> Vector2:
	for raw_checkpoint: Variant in data.get("checkpoints", []):
		if typeof(raw_checkpoint) != TYPE_DICTIONARY:
			continue
		var checkpoint: Dictionary = raw_checkpoint
		if str(checkpoint.get("id", "")) == checkpoint_id:
			return Vector2(float(checkpoint.get("x", 0.0)), float(checkpoint.get("y", 0.0)))
	return Vector2(bounds.position.x + 40.0, bounds.position.y + bounds.size.y - config.player_height())

func _build_solids() -> void:
	for raw_solid: Variant in data.get("solids", []):
		if typeof(raw_solid) != TYPE_DICTIONARY:
			continue
		var solid: Dictionary = raw_solid
		var body := StaticBody2D.new()
		body.name = "solid_%s" % str(solid.get("id", "unnamed"))
		body.collision_layer = 2
		body.collision_mask = 0
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		var w := float(solid.get("w", 0.0))
		var h := float(solid.get("h", 0.0))
		rect.size = Vector2(w, h)
		shape.shape = rect
		shape.position = Vector2(float(solid.get("x", 0.0)) + w * 0.5, float(solid.get("y", 0.0)) + h * 0.5)
		body.add_child(shape)
		var visual := Polygon2D.new()
		visual.color = Color(str(solid.get("color", "#2a3542")))
		visual.polygon = PackedVector2Array([
			Vector2(0.0, 0.0),
			Vector2(w, 0.0),
			Vector2(w, h),
			Vector2(0.0, h),
		])
		visual.position = Vector2(float(solid.get("x", 0.0)), float(solid.get("y", 0.0)))
		body.add_child(visual)
		add_child(body)

func _build_doors() -> void:
	for raw_door: Variant in data.get("doors", []):
		if typeof(raw_door) != TYPE_DICTIONARY:
			continue
		var door := SideViewDoor.new()
		door.name = "door_%s" % str((raw_door as Dictionary).get("id", "unnamed"))
		add_child(door)
		door.build(raw_door, config, state, runtime)
		door.transition_requested.connect(_on_transition_requested)

func _on_transition_requested(target_room: String, target_spawn: String) -> void:
	transition_requested.emit(target_room, target_spawn)

func _build_checkpoints() -> void:
	for raw_checkpoint: Variant in data.get("checkpoints", []):
		if typeof(raw_checkpoint) != TYPE_DICTIONARY:
			continue
		var checkpoint := SideViewCheckpoint.new()
		checkpoint.name = "checkpoint_%s" % str((raw_checkpoint as Dictionary).get("id", "unnamed"))
		add_child(checkpoint)
		checkpoint.build(raw_checkpoint, config, state, runtime)

func _build_abilities() -> void:
	for raw_ability: Variant in data.get("abilities", []):
		if typeof(raw_ability) != TYPE_DICTIONARY:
			continue
		var pickup := SideViewPickup.new()
		pickup.name = "ability_%s" % str((raw_ability as Dictionary).get("id", "unnamed"))
		add_child(pickup)
		pickup.build("ability", raw_ability, config, state, runtime)

func _build_rewards() -> void:
	for raw_reward: Variant in data.get("rewards", []):
		if typeof(raw_reward) != TYPE_DICTIONARY:
			continue
		var pickup := SideViewPickup.new()
		pickup.name = "reward_%s" % str((raw_reward as Dictionary).get("id", "unnamed"))
		add_child(pickup)
		pickup.build("reward", raw_reward, config, state, runtime)

func _build_targets() -> void:
	for raw_target: Variant in data.get("targets", []):
		if typeof(raw_target) != TYPE_DICTIONARY:
			continue
		var target := SideViewTarget.new()
		target.name = "target_%s" % str((raw_target as Dictionary).get("id", "unnamed"))
		add_child(target)
		target.build(raw_target, config, state, runtime)

func _build_hazards() -> void:
	for raw_hazard: Variant in data.get("hazards", []):
		if typeof(raw_hazard) != TYPE_DICTIONARY:
			continue
		var hazard := SideViewHazard.new()
		hazard.name = "hazard_%s" % str((raw_hazard as Dictionary).get("id", "unnamed"))
		add_child(hazard)
		hazard.build(raw_hazard, config, state, runtime)

func _draw() -> void:
	draw_rect(bounds, Color(str(data.get("background", "#0f141a"))), true)
	draw_rect(bounds, Color(0.22, 0.28, 0.34, 0.9), false, 2.0)
