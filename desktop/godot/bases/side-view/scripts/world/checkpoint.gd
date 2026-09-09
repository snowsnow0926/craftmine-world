## Checkpoint. Touching it sets the respawn target for the whole world. The
## activation is a persistent fact, so a restart keeps it.
class_name SideViewCheckpoint
extends Area2D

var checkpoint_id: String = ""
var config: SideViewConfig
var state: WorldState
var runtime: Node
var _visual: Polygon2D

func build(raw: Dictionary, config_value: SideViewConfig, state_value: WorldState, runtime_node: Node) -> void:
	config = config_value
	state = state_value
	runtime = runtime_node
	checkpoint_id = str(raw.get("id", name))
	collision_layer = 0
	collision_mask = 1
	monitoring = true
	monitorable = false
	var x := float(raw.get("x", 0.0))
	var y := float(raw.get("y", 0.0))
	position = Vector2(x, y)
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(36.0, 60.0)
	shape.shape = rect
	shape.position = Vector2(0.0, -30.0)
	add_child(shape)
	_visual = Polygon2D.new()
	_visual.polygon = PackedVector2Array([
		Vector2(-8.0, 0.0),
		Vector2(8.0, 0.0),
		Vector2(8.0, -56.0),
		Vector2(-8.0, -56.0),
	])
	_visual.color = Color(0.45, 0.45, 0.5, 0.85)
	add_child(_visual)
	body_entered.connect(_on_body_entered)
	_refresh_visual()

func _refresh_visual() -> void:
	if _visual == null:
		return
	_visual.color = Color(0.35, 0.95, 0.55, 0.95) if state.has_checkpoint(checkpoint_id) else Color(0.45, 0.45, 0.5, 0.85)

func _on_body_entered(body: Node2D) -> void:
	if not (body is SideViewPlayer):
		return
	var first_time := state.activate_checkpoint(checkpoint_id)
	_refresh_visual()
	if runtime != null:
		runtime.emit_event("checkpoint_activated", {
			"checkpointId": checkpoint_id,
			"firstTime": first_time,
			"x": position.x,
			"y": position.y,
		})
		runtime.save_now("checkpoint")
