extends SceneTree
const Registry = preload("res://craftmine_shared/component_state.gd")
var checks: Array = []
class FixtureComponent extends Node:
	var entity_id := ""
	var source := {"name": "pet", "following": true}
	var value: Dictionary
	var mutate_validation := false
	var delete_other: Node
	func _ready():
		value = {"format": "fixture-component/1", "entityId": entity_id, "settings": source.duplicate(), "sourceSettings": source.duplicate(), "position": [1, 0, 1], "interactionCount": 0}
		add_to_group("craftmine_persistent_components")
	func snapshot(): return value.duplicate(true)
	func validate_state(data):
		if mutate_validation: data.position = [9, 0, 9]
		return "invalid fixture" if data.get("entityId") != entity_id or data.get("sourceSettings") != source else ""
	func restore(data):
		value = data.duplicate(true)
		if data.interactionCount == 88 and is_instance_valid(delete_other): delete_other.queue_free()
		if data.interactionCount == 99: return "injected failure after mutation"
		return ""
	func validate_restored_state(): return "injected blocked placement" if value.interactionCount == 66 else ""

func _initialize(): call_deferred("run")
func check(condition: bool, label: String):
	if not condition:
		push_error(label)
		quit(1)
		assert(condition, label)
	checks.append(label)
func request(op: String, args := {}) -> Dictionary:
	var envelope: Dictionary = JSON.parse_string(JSON.stringify({"op": op, "args": args, "worldId": "component-test", "buildId": "fixture-build", "instanceId": "fixture-instance"}))
	var response: Dictionary = await root.get_node("CraftmineRuntime").handle_request(envelope)
	return JSON.parse_string(JSON.stringify(response))
func run():
	var world = load("res://scenes/creation.tscn").instantiate()
	root.add_child(world)
	current_scene = world
	for _frame in 6: await process_frame
	var loaded := await request("load")
	check(not loaded.has("error"), "empty stock world loads")
	var bridge := root.get_node("CraftmineRuntime")
	var original_adapter: RefCounted = bridge.adapter
	var interaction_events := InputMap.action_get_events("interact")
	var deadzone := InputMap.action_get_deadzone("interact")
	InputMap.erase_action("interact")
	bridge.adapter = RefCounted.new()
	paused = false
	bridge._input(InputEventAction.new()) # Pure handler call, no OS or global input injection.
	bridge.adapter = original_adapter
	bridge._input(InputEventAction.new())
	paused = true
	InputMap.add_action("interact", deadzone)
	for event in interaction_events: InputMap.action_add_event("interact", event)
	check(true, "bases without component interaction or action binding ignore the handler safely")
	var baseline: Dictionary = loaded.result.snapshot.state
	check(not baseline.body.has("components"), "old world snapshot gains no empty extension")
	check(not (await request("restore-state", {"state": baseline})).has("error"), "old snapshot round trip unchanged")
	var first := FixtureComponent.new()
	first.entity_id = "pet-one"
	world.add_child(first)
	var second := FixtureComponent.new()
	second.entity_id = "pet-two"
	world.add_child(second)
	var saved := await request("save")
	check(not saved.has("error"), "live components captured by normal save")
	var initial: Dictionary = saved.result.state
	check(initial.body.components.size() == 2, "two independent identities")
	first.mutate_validation = true
	check((await request("save")).has("error"), "mutating validator cannot rewrite captured state")
	check((await request("restore-state", {"state": initial})).has("error"), "mutating validator cannot rewrite incoming restore state")
	first.mutate_validation = false
	check((await request("save")).result.state == initial, "validation mutation leaves live state and prior saved ledger intact")
	world.remove_child(second)
	check((await request("save")).result.state.body.components.has("pet-two"), "saved defaults survive removal before any restore")
	world.add_child(second)
	check((await request("restore-state", {"state": baseline})).has("error"), "direct old restore must not invent new defaults")
	var desired := initial.duplicate(true)
	desired.body.components["pet-one"].settings.name = "小白"
	desired.body.components["pet-one"].interactionCount = 7
	desired = JSON.parse_string(JSON.stringify(desired))
	check(not (await request("restore-state", {"state": desired})).has("error"), "complete component state restored")
	check(first.value.settings.name == "小白" and second.value.settings.name == "pet", "second instance unchanged")
	var actual: Dictionary = (await request("save")).result.state
	check(actual == desired, "all fields survive save")
	var invalid := desired.duplicate(true)
	invalid.body.player.position = [7, 0.9, 7]
	invalid.body.components["pet-one"].interactionCount = 5
	invalid.body.components["pet-two"].interactionCount = 99
	check((await request("restore-state", {"state": invalid})).has("error"), "component mutation failure rejects restore")
	check((await request("save")).result.state == actual, "native player and both components roll back")
	invalid.body.components["pet-two"].interactionCount = 66
	check((await request("restore-state", {"state": invalid})).has("error"), "post-restore placement validation rejects after all nodes applied")
	check((await request("save")).result.state == actual, "post-restore rejection rolls native state and all components back")
	first.value.position = [0.000169269740581512, 0, 1]
	var wire: Dictionary = JSON.parse_string(JSON.stringify((await request("save")).result.state))
	check(not (await request("restore-state", {"state": wire})).has("error") and (await request("save")).result.state == wire, "JSON wire roundtrip keeps numeric equality without tolerance")
	actual = wire
	second.entity_id = "pet-one"
	check((await request("save")).has("error"), "duplicate identity cannot mint saved receipt")
	second.entity_id = "pet-two"
	second.value.position = [NAN, 0, 1]
	check((await request("snapshot")).has("error"), "nonfinite component capture rejected")
	second.value = actual.body.components["pet-two"].duplicate(true)
	world.remove_child(second)
	second.free()
	var removed: Dictionary = (await request("save")).result.state
	check(removed.body.components["pet-two"] == actual.body.components["pet-two"], "removed identity ledger retained")
	check(not (await request("restore-state", {"state": removed})).has("error"), "removed component state can round trip")
	var cold := FixtureComponent.new()
	cold.entity_id = "pet-two"
	world.add_child(cold)
	check(not (await request("restore-state", {"state": removed})).has("error") and cold.value == removed.body.components["pet-two"], "recreated same identity restores instead of resetting")
	first.delete_other = cold
	var broken := removed.duplicate(true)
	broken.body.components["pet-one"].interactionCount = 88
	check((await request("restore-state", {"state": broken})).has("error"), "member removed by callback rejects without calling dead node")
	check((await request("save")).has("error"), "incomplete rollback blocks further saves until reload")
	print("COMPONENT_STATE=" + JSON.stringify({"checks": checks}))
	quit(0)
