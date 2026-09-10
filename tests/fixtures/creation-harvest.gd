extends Node
# Authored validation fixture. Never shipped in the base or model guidance.
var host: Node
var entity_id: String
var remaining_ticks: int = 0
var harvests: int = 0

func configure(world: Node, definition: Dictionary) -> void:
	host = world
	entity_id = definition.entityIds[0]
	apply_projection()

func on_entity_interacted(id: String) -> void:
	if id != entity_id or remaining_ticks > 0:
		return
	harvests += 1
	host.inventory["wood"] = int(host.inventory.get("wood", 0)) + 1
	remaining_ticks = 300
	apply_projection()

func _physics_process(_delta: float) -> void:
	if remaining_ticks > 0:
		remaining_ticks -= 1
		if remaining_ticks == 0:
			apply_projection()

func apply_projection() -> void:
	if host == null:
		return
	var entity: Node3D = host.entity_nodes[entity_id]
	entity.visible = remaining_ticks == 0
	var shape: CollisionShape3D = entity.get_node("Body").get_child(0)
	shape.set_deferred("disabled", remaining_ticks > 0)

func snapshot() -> Dictionary:
	return {"remainingTicks": remaining_ticks, "harvests": harvests}

func validate_state(data: Dictionary) -> String:
	if data.size() != 2 or not data.has("remainingTicks") or not data.has("harvests"):
		return "Invalid harvest keys"
	for key in data:
		var value: Variant = data[key]
		if not (value is int or value is float) or float(value) != floor(float(value)) or value < 0:
			return "Invalid harvest counters"
	if data.remainingTicks > 300 or data.harvests > 999999:
		return "Harvest state out of bounds"
	return ""

func project_entities(data: Dictionary) -> Dictionary:
	return {entity_id: {"visible": int(data.remainingTicks) == 0, "solid": int(data.remainingTicks) == 0}}

func restore(data: Dictionary) -> void:
	remaining_ticks = int(data.remainingTicks)
	harvests = int(data.harvests)
	var entity: Node3D = host.entity_nodes[entity_id]
	entity.visible = remaining_ticks == 0
	var shape: CollisionShape3D = entity.get_node("Body").get_child(0)
	shape.disabled = remaining_ticks > 0
