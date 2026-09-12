extends RefCounted

const GROUP := "craftmine_persistent_components"
const MAX_COMPONENTS := 64
const MAX_STATE_BYTES := 65536
var retained: Dictionary = {}
var had_ledger := false
var fault := ""

static func live(root: Variant, node: Variant, id: String) -> bool:
	return is_instance_valid(root) and is_instance_valid(node) and node is Node and node.is_inside_tree() and root.is_ancestor_of(node) and not node.is_queued_for_deletion() and node.get("entity_id") == id

static func identifier(value: Variant) -> bool:
	if not value is String or value.is_empty() or value.length() > 128: return false
	var pattern := RegEx.new()
	pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]*$")
	var found := pattern.search(value)
	return found != null and found.get_string() == value

static func json_value(value: Variant, depth := 0) -> bool:
	if depth > 8: return false
	if value is Dictionary:
		if value.size() > 128: return false
		for key in value:
			if not key is String or key.length() > 128 or not json_value(value[key], depth + 1): return false
	elif value is Array:
		if value.size() > 1024: return false
		for item in value:
			if not json_value(item, depth + 1): return false
	elif value is float or value is int:
		return is_finite(float(value))
	elif value is String: return value.length() <= 4096
	elif value != null and not value is bool: return false
	return true

static func valid_state(id: String, state: Variant) -> bool:
	if not state is Dictionary or not json_value(state) or JSON.stringify(state).to_utf8_buffer().size() > MAX_STATE_BYTES: return false
	if state.get("entityId") != id or not state.get("format") is String or state.format.is_empty() or state.format.length() > 128: return false
	var settings: Variant = state.get("settings")
	var source: Variant = state.get("sourceSettings")
	if not settings is Dictionary or not source is Dictionary or source.size() > 16 or source.size() != settings.size(): return false
	for key in source:
		if not identifier(key) or not settings.has(key): return false
		if source[key] is Array or source[key] is Dictionary or settings[key] is Array or settings[key] is Dictionary: return false
		if typeof(source[key]) != typeof(settings[key]) and not ((source[key] is float or source[key] is int) and (settings[key] is float or settings[key] is int)): return false
	return true

func nodes(root: Node) -> Dictionary:
	var result := {}
	if not fault.is_empty(): return {"error": fault}
	if not is_instance_valid(root) or not root.is_inside_tree(): return {"error": "Component world is unavailable"}
	for node in root.get_tree().get_nodes_in_group(GROUP):
		if not root.is_ancestor_of(node): continue
		var id: Variant = node.get("entity_id")
		if not identifier(id) or result.has(id) or result.size() >= MAX_COMPONENTS or node.is_queued_for_deletion(): return {"error": "Invalid, duplicate or excessive component identity"}
		for method in ["snapshot", "validate_state", "restore"]:
			if not node.has_method(method): return {"error": "Component is missing " + method + ": " + id}
		result[id] = node
	return {"error": "", "nodes": result}

func capture(root: Node) -> Dictionary:
	var found := nodes(root)
	if not found.error.is_empty(): return found
	var states := retained.duplicate(true)
	for id in found.nodes:
		if not live(root, found.nodes[id], id): return {"error": "Component changed during capture: " + id}
		var state: Variant = found.nodes[id].snapshot()
		if not live(root, found.nodes[id], id): return {"error": "Component changed during snapshot: " + id}
		if not valid_state(id, state): return {"error": "Invalid component snapshot: " + id}
		# Match the actual JSON wire representation, not extra in-memory float
		# digits that Godot never writes. This is not a numeric error tolerance.
		state = JSON.parse_string(JSON.stringify(state))
		if states.has(id) and states[id].format != state.format: return {"error": "Component state format changed: " + id}
		var problem := _validate_node(root, found.nodes[id], id, state)
		if not problem.is_empty(): return {"error": "Component rejected its snapshot: " + id + ": " + problem}
		states[id] = state.duplicate(true)
	var after := nodes(root)
	if not after.error.is_empty() or after.nodes != found.nodes: return {"error": "Components changed during capture"}
	if states.size() > MAX_COMPONENTS: return {"error": "Component ledger exceeds limit"}
	retained = states.duplicate(true)
	had_ledger = had_ledger or not states.is_empty()
	return {"error": "", "states": states, "present": had_ledger or not states.is_empty()}

func _validate_node(root: Node, node: Variant, id: String, state: Dictionary) -> String:
	if not live(root, node, id): return "Component changed before validation"
	var before: Variant = node.snapshot()
	if not live(root, node, id) or not valid_state(id, before): return "Invalid live component snapshot"
	before = JSON.parse_string(JSON.stringify(before))
	var candidate := state.duplicate(true)
	var problem: Variant = node.validate_state(candidate)
	if not live(root, node, id):
		fault = "Component disappeared during validation: " + id
		return fault
	var after: Variant = node.snapshot()
	if not live(root, node, id):
		fault = "Component disappeared during validation snapshot: " + id
		return fault
	if not valid_state(id, after) or JSON.parse_string(JSON.stringify(after)) != before:
		var rollback: Variant = node.restore(before.duplicate(true))
		if not live(root, node, id) or rollback != "" or JSON.parse_string(JSON.stringify(node.snapshot())) != before:
			fault = "Validator changed live state; rollback failed: " + id
			return fault
		return "Validator changed live state"
	if candidate != state: return "Validator changed its input"
	return problem if problem is String else "Validator did not return a result"

func validate(root: Node, states: Variant) -> String:
	if not states is Dictionary or states.size() > MAX_COMPONENTS: return "Invalid component ledger"
	for id in states:
		if not identifier(id) or not valid_state(id, states[id]): return "Invalid saved component: " + str(id)
	var found := nodes(root)
	if not found.error.is_empty(): return found.error
	for id in found.nodes:
		if not states.has(id): return "Component default must be merged before restore: " + id
		var problem := _validate_node(root, found.nodes[id], id, states[id])
		if not problem.is_empty(): return "Component rejected saved state: " + id + ": " + problem
	return ""

# The adapter retains its native snapshot and rolls it back if this transaction
# fails. Every component is validated before any restore method is invoked.
func restore(root: Node, states: Dictionary, present: bool) -> String:
	var problem := validate(root, states)
	if not problem.is_empty(): return problem
	var before := capture(root)
	if not before.error.is_empty(): return before.error
	var found := nodes(root)
	if not found.error.is_empty(): return found.error
	for id in found.nodes:
		if not live(root, found.nodes[id], id):
			problem = "Component changed before restore: " + id
			break
		var result: Variant = found.nodes[id].restore(states[id].duplicate(true))
		if not live(root, found.nodes[id], id):
			problem = "Component changed during restore: " + id
			break
		if not result is String or not result.is_empty():
			problem = "Component restore failed: " + id + ": " + str(result)
			break
		var actual: Variant = found.nodes[id].snapshot()
		if not live(root, found.nodes[id], id) or not valid_state(id, actual) or JSON.parse_string(JSON.stringify(actual)) != JSON.parse_string(JSON.stringify(states[id])):
			problem = "Component restore did not preserve state: " + id
			break
	if problem.is_empty():
		for id in found.nodes:
			if not live(root, found.nodes[id], id):
				problem = "Component changed before restored validation: " + id
				break
			if found.nodes[id].has_method("validate_restored_state"):
				var result: Variant = found.nodes[id].validate_restored_state()
				if not result is String or not result.is_empty():
					problem = "Component rejected restored placement: " + id + ": " + str(result)
					break
			if not live(root, found.nodes[id], id):
				problem = "Component changed during restored validation: " + id
				break
	if problem.is_empty():
		for id in found.nodes:
			if not live(root, found.nodes[id], id):
				problem = "Component changed after restore: " + id
				break
			var actual: Variant = found.nodes[id].snapshot()
			if not live(root, found.nodes[id], id) or not valid_state(id, actual) or JSON.parse_string(JSON.stringify(actual)) != JSON.parse_string(JSON.stringify(states[id])):
				problem = "Component state changed after restore: " + id
				break
	var after := nodes(root)
	if not after.error.is_empty() or after.nodes != found.nodes: problem = "Components changed during restore"
	if not problem.is_empty():
		for id in found.nodes:
			if not live(root, found.nodes[id], id):
				fault = "Component rollback missing member: " + id
				problem += "; " + fault
				continue
			var node: Node = found.nodes[id]
			var rollback: Variant = node.restore(before.states[id].duplicate(true))
			if not live(root, node, id) or rollback != "" or JSON.parse_string(JSON.stringify(node.snapshot())) != before.states[id]:
				fault = "Component rollback failed: " + id
				problem += "; " + fault
		return problem
	retained = states.duplicate(true)
	had_ledger = present
	return ""
