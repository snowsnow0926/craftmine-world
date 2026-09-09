## Hazard volume (spikes, pits). Touching it costs all remaining health, which
## routes through the real damage/death path so the checkpoint respawn is real.
class_name SideViewHazard
extends Area2D

var hazard_id: String = ""
var config: SideViewConfig
var state: WorldState
var runtime: Node

func build(raw: Dictionary, config_value: SideViewConfig, state_value: WorldState, runtime_node: Node) -> void:
	config = config_value
	state = state_value
	runtime = runtime_node
	hazard_id = str(raw.get("id", name))
	collision_layer = 0
	collision_mask = 1
	monitoring = true
	monitorable = false
	add_to_group("sv_hazard")
	var w := float(raw.get("w", 32.0))
	var h := float(raw.get("h", 16.0))
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(w, h)
	shape.shape = rect
	shape.position = Vector2(float(raw.get("x", 0.0)) + w * 0.5, float(raw.get("y", 0.0)) + h * 0.5)
	add_child(shape)
	var visual := Polygon2D.new()
	visual.color = Color(0.9, 0.25, 0.35, 0.9)
	var points := PackedVector2Array()
	var teeth := maxi(2, int(w / 10.0))
	for index in range(teeth):
		var left := float(index) / float(teeth) * w
		var right := float(index + 1) / float(teeth) * w
		points.append(Vector2(left, h))
		points.append(Vector2((left + right) * 0.5, 0.0))
	points.append(Vector2(w, h))
	visual.polygon = points
	visual.position = Vector2(float(raw.get("x", 0.0)), float(raw.get("y", 0.0)))
	add_child(visual)
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node2D) -> void:
	if not (body is SideViewPlayer):
		return
	var player: SideViewPlayer = body
	if not player.alive:
		return
	if runtime != null:
		runtime.emit_event("hazard_touched", {"hazardId": hazard_id, "x": player.position.x, "y": player.position.y})
	player.take_damage(config.max_health(), "hazard:%s" % hazard_id)
