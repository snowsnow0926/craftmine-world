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
##
## Commit order: keep the previous save as `state.json.bak`, move the validated
## temporary file into place, and only then delete the backup. A crash between
## any two steps leaves either the previous or the new save, never neither.
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
	if dir.file_exists(backup_name()) and dir.remove(backup_name()) != OK:
		return "Stale save backup could not be removed"
	var had_previous := dir.file_exists("state.json")
	if had_previous and dir.rename("state.json", backup_name()) != OK:
		return "Previous save could not be set aside"
	if dir.rename("state.json.tmp", "state.json") != OK:
		if had_previous:
			dir.rename(backup_name(), "state.json")
		return "Save file could not be committed"
	if dir.file_exists(backup_name()):
		dir.remove(backup_name())
	return ""


func backup_name() -> String:
	return "state.json.bak"


## Returns {"state": {...}} on success or {"error": "..."}.
func load_state() -> Dictionary:
	for candidate in ["state.json", backup_name()]:
		var result := _read(candidate)
		if result.has("state"):
			return result
	return {"error": "Progress is missing"}


func _read(file_name: String) -> Dictionary:
	var path := directory() + "/" + file_name
	if not FileAccess.file_exists(path):
		return {"error": "Progress is missing"}
	var file := FileAccess.open(path, FileAccess.READ)
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
