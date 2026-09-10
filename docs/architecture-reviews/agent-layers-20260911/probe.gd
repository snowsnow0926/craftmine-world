extends SceneTree

class RuleHost extends Node:
	var calls: Array = []
	func set_door_open(id: String, opened: bool) -> void:
		calls.append([id, opened])

func _initialize() -> void:
	call_deferred("run_audit")

func counts(node: Node) -> Dictionary:
	var result := {"meshes": 0, "physics_bodies": 0, "collision_shapes": 0}
	if node is MeshInstance3D: result.meshes += 1
	if node is PhysicsBody3D: result.physics_bodies += 1
	if node is CollisionShape3D: result.collision_shapes += 1
	for child in node.get_children():
		var found := counts(child)
		for key in result: result[key] += found[key]
	return result

func run_audit() -> void:
	var source: Script = load("res://rule.gd")
	var cases := {
		"normal": ["blue", "red", "green"],
		"repeat_first": ["blue", "blue", "red", "green"],
		"unrelated": ["blue", "unrelated", "red", "green"]
	}
	var sequences := {}
	for name in cases:
		var host := RuleHost.new()
		var rule = source.new()
		rule.configure(host, {})
		for item in cases[name]: rule.on_entity_interacted(item)
		sequences[name] = {"open": not host.calls.is_empty(), "snapshot": rule.snapshot()}
		rule.free()
		host.free()
	var renderer_script: Script = load("res://creation_renderer.gd")
	var renderer = renderer_script.new()
	root.add_child(renderer)
	await process_frame
	await process_frame
	var before := counts(renderer)
	var entities_before: int = renderer.entities.size()
	var handles_door: bool = renderer.has_method("set_door_open")
	var invalid := FileAccess.open("res://world/creation.json", FileAccess.WRITE)
	invalid.store_string("{")
	invalid.close()
	renderer._reload()
	await process_frame
	await process_frame
	var after := counts(renderer)
	print("LAYER_AUDIT_JSON=" + JSON.stringify({
		"sequence": sequences,
		"renderer": {"before_invalid": before, "entities_before": entities_before,
			"has_set_door_open": handles_door, "after_invalid": after, "entities_after": renderer.entities.size()}
	}))
	renderer.queue_free()
	await process_frame
	quit(0)
