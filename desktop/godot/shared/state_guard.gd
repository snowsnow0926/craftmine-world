extends RefCounted

const FORMAT := "craftmine.godot-progress/1"
const LIMIT := 1048576

static func validate(state: Variant, world_id: String, base_id: String, base_version: String) -> String:
	if not state is Dictionary or state.get("format") != FORMAT:
		return "Unsupported complete progress format"
	for key in state:
		if not key in ["format", "worldId", "baseId", "baseVersion", "stateVersion", "body"]:
			return "Unsupported progress field: " + str(key)
	if state.get("worldId") != world_id or state.get("baseId") != base_id or state.get("baseVersion") != base_version:
		return "Progress identity or base version does not match"
	if state.get("stateVersion") != 1 or not state.get("body") is Dictionary:
		return "Unsupported progress state version or body"
	if state.body.get("worldId") != world_id:
		return "Native progress belongs to another world"
	if JSON.stringify(state).to_utf8_buffer().size() > LIMIT:
		return "Complete progress exceeds 1 MiB"
	return ""

# Unknown author-defined fields must survive the native adapter or be rejected.
# Native validators decide values and supported migrations; this checks omission.
static func omitted(input: Variant, output: Variant, at: String = "body") -> String:
	if input is Dictionary:
		if not output is Dictionary:
			return at
		for key in input:
			if not output.has(key):
				return at + "." + str(key)
			var missing := omitted(input[key], output[key], at + "." + str(key))
			if not missing.is_empty():
				return missing
	elif input is Array:
		if not output is Array or input.size() != output.size():
			return at
		for index in input.size():
			var missing := omitted(input[index], output[index], at + "[" + str(index) + "]")
			if not missing.is_empty():
				return missing
	return ""
