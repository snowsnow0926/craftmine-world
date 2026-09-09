## Attack target. Two kinds share this node:
##   dummy     - takes damage, does not disappear until health reaches zero
##   breakable - same rules, used for crates
## Defeating a target grants its one-time reward exactly once, and the reward id
## is the persistent marker: a rebuilt room will not spawn a defeated target.
class_name SideViewTarget
extends Area2D

var kind: String = "dummy"
var target_id: String = ""
var reward_id: String = ""
var grants: Dictionary = {}
var max_health: int = 2
var health: int = 2
var config: SideViewConfig
var state: WorldState
var runtime: Node
var _visual: Polygon2D
var _defeated: bool = false

func build(raw: Dictionary, config_value: SideViewConfig, state_value: WorldState, runtime_node: Node) -> void:
	kind = str(raw.get("kind", "dummy"))
	config = config_value
	state = state_value
	runtime = runtime_node
	target_id = str(raw.get("id", name))
	reward_id = str(raw.get("rewardId", ""))
	grants = raw.get("grants", {})
	max_health = maxi(1, int(raw.get("health", 2)))
	health = max_health
	if reward_id != "" and state.has_reward(reward_id):
		queue_free()
		return
	collision_layer = 4
	collision_mask = 0
	monitoring = false
	monitorable = true
	position = Vector2(float(raw.get("x", 0.0)), float(raw.get("y", 0.0)))
	var w := float(raw.get("w", 24.0))
	var h := float(raw.get("h", 32.0))
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(w, h)
	shape.shape = rect
	shape.position = Vector2(0.0, -h * 0.5)
	add_child(shape)
	_visual = Polygon2D.new()
	_visual.polygon = PackedVector2Array([
		Vector2(-w * 0.5, 0.0),
		Vector2(w * 0.5, 0.0),
		Vector2(w * 0.5, -h),
		Vector2(-w * 0.5, -h),
	])
	_visual.color = Color(0.65, 0.45, 0.3, 0.95) if kind == "breakable" else Color(0.72, 0.72, 0.78, 0.95)
	add_child(_visual)

## Called by the player's attack area. This is the only mutation path for a
## target, and it comes from the real hitbox overlap.
func receive_hit(damage: int, facing: int) -> void:
	if _defeated:
		return
	health -= damage
	if runtime != null:
		runtime.emit_event("target_hit", {"targetId": target_id, "damage": damage, "facing": facing, "health": maxi(health, 0)})
		runtime.state.add_counter("hits", 1)
	if health <= 0:
		_defeat()

func _defeat() -> void:
	_defeated = true
	if reward_id != "" and state.collect_reward(reward_id):
		for counter_key: Variant in (grants.get("counters", {}) as Dictionary).keys():
			state.add_counter(str(counter_key), int((grants.get("counters", {}) as Dictionary)[counter_key]))
		for item_key: Variant in (grants.get("items", {}) as Dictionary).keys():
			state.add_item(str(item_key), int((grants.get("items", {}) as Dictionary)[item_key]))
	if runtime != null:
		runtime.emit_event("target_defeated", {"targetId": target_id, "rewardId": reward_id, "kind": kind})
		runtime.save_now("target_defeated")
	queue_free()
