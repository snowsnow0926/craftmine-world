class_name SaveStore
extends Node

## Durable progress storage. Writes are validated, written to a temporary file
## and only then renamed over the previous save, so an interrupted write cannot
## leave a half-written save behind.

const FORMAT := "craftmine.godot-base-state/1"

@export var world_id := "local-world"


func directory() -> String:
	return "user://worlds/" + world_id.sha256_text()


func state_file() -> String:
	return directory() + "/state.json"


func temporary_file() -> String:
	return directory() + "/state.json.tmp"


func has_state() -> bool:
	return FileAccess.file_exists(state_file())


## Returns "" on success, otherwise why the save was refused.
func save(state: Dictionary) -> String:
	var problem := validate(state)
	if not problem.is_empty():
		return problem
	if DirAccess.make_dir_recursive_absolute(directory()) != OK:
		return "Save directory could not be created"
	var payload := state.duplicate(true)
	payload["savedAt"] = Time.get_datetime_string_from_system(true) + "Z"
	var file := FileAccess.open(temporary_file(), FileAccess.WRITE)
	if file == null:
		return "Save file could not be opened"
	file.store_string(JSON.stringify(payload, "\t"))
	var write_error := file.get_error()
	file.close()
	if write_error != OK:
		return "Save file write failed"
	var dir := DirAccess.open(directory())
	if dir == null:
		return "Save directory could not be reopened"
	if dir.file_exists("state.json"):
		var remove_error := dir.remove("state.json")
		if remove_error != OK:
			return "Previous save could not be replaced"
	if dir.rename("state.json.tmp", "state.json") != OK:
		return "Save file could not be committed"
	return ""


## Returns {"state": {...}} on success or {"error": "..."}.
func load_state() -> Dictionary:
	if not has_state():
		return {"error": "Progress is missing"}
	var file := FileAccess.open(state_file(), FileAccess.READ)
	if file == null:
		return {"error": "Progress could not be read"}
	var text := file.get_as_text()
	file.close()
	var parsed = JSON.parse_string(text)
	if not parsed is Dictionary:
		return {"error": "Progress is not a JSON object"}
	if parsed.get("format") != FORMAT:
		return {"error": "Progress format is not supported"}
	if str(parsed.get("worldId", "")) != world_id:
		return {"error": "Progress belongs to another world"}
	return {"state": parsed}


func validate(state: Dictionary) -> String:
	if state.get("format") != FORMAT:
		return "State format is not supported"
	var version = state.get("stateVersion")
	if not (version is float or version is int) or float(version) != floorf(float(version)) or int(version) < 1:
		return "State version is invalid"
	if str(state.get("worldId", "")) != world_id:
		return "State belongs to another world"
	return ""


func erase() -> String:
	if not has_state():
		return ""
	var dir := DirAccess.open(directory())
	if dir == null:
		return "Save directory could not be opened"
	return "" if dir.remove("state.json") == OK else "Save file could not be removed"
