## One-time pickup. Two kinds share this node:
##   ability - grants an ability id (for example `double_jump`)
##   reward  - grants counters / inventory items once
## Both are idempotent against WorldState, so a rebuilt room never re-grants.
class_name SideViewPickup
extends Area2D

var kind: String = "reward"
var pickup_id: String = ""
var grants: Dictionary = {}
var config: SideViewConfig
var state: WorldState
var runtime: Node
var _visual: Polygon2D

func build(kind_value: String, raw: Dictionary, config_value: SideViewConfig, state_value: WorldState, runtime_node: Node) -> void:
	kind = kind_value
	config = config_value
	state = state_value
	runtime = runtime_node
	pickup_id = str(raw.get("id", name))
	grants = raw.get("grants", {})
	if _already_taken():
		queue_free()
		return
	collision_layer = 0
	collision_mask = 1
	monitoring = true
	monitorable = false
	position = Vector2(float(raw.get("x", 0.0)), float(raw.get("y", 0.0)))
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(28.0, 36.0)
	shape.shape = rect
	shape.position = Vector2(0.0, -18.0)
	add_child(shape)
	_visual = Polygon2D.new()
	var size := 12.0
	_visual.polygon = PackedVector2Array([
		Vector2(-size, 0.0),
		Vector2(0.0, -size),
		Vector2(size, 0.0),
		Vector2(0.0, size),
	])
	_visual.position = Vector2(0.0, -18.0)
	_visual.color = Color(0.98, 0.55, 0.2, 0.95) if kind == "ability" else Color(0.98, 0.85, 0.25, 0.95)
	add_child(_visual)
	body_entered.connect(_on_body_entered)

func _already_taken() -> bool:
	if kind == "ability":
		return state.has_ability(pickup_id)
	return state.has_reward(pickup_id)

func _on_body_entered(body: Node2D) -> void:
	if not (body is SideViewPlayer):
		return
	if kind == "ability":
		if not state.grant_ability(pickup_id):
			return
		if body.has_method("grant_double_jump") and pickup_id == SideViewPlayer.ABILITY_DOUBLE_JUMP:
			body.call("grant_double_jump")
		if runtime != null:
			runtime.emit_event("ability_gained", {"abilityId": pickup_id, "source": "pickup", "x": position.x, "y": position.y})
			runtime.save_now("ability")
		queue_free()
		return
	if not state.collect_reward(pickup_id):
		return
	_apply_grants()
	if runtime != null:
		runtime.emit_event("reward_collected", {
			"rewardId": pickup_id,
			"source": "pickup",
			"grants": grants.duplicate(true),
			"x": position.x,
			"y": position.y,
		})
		runtime.save_now("reward")
	queue_free()

func _apply_grants() -> void:
	for counter_key: Variant in (grants.get("counters", {}) as Dictionary).keys():
		state.add_counter(str(counter_key), int((grants.get("counters", {}) as Dictionary)[counter_key]))
	for item_key: Variant in (grants.get("items", {}) as Dictionary).keys():
		state.add_item(str(item_key), int((grants.get("items", {}) as Dictionary)[item_key]))
