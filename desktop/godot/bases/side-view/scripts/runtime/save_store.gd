## Atomic JSON persistence for side-view state.
##
## Save root resolution order:
##   1. CRAFTMINE_SIDEVIEW_SAVE_DIR  -> <dir>/<worldId>   (isolated acceptance runs)
##   2. user://save                  -> user://save/<worldId>
## Nothing is ever written outside that root, and the base never reads host
## credentials, other worlds or the application binary.
class_name SaveStore
extends RefCounted

const STATE_FILE := "state.json"
const TEMP_FILE := "state.json.tmp"
const BACKUP_FILE := "state.json.bak"

var world_id: String = ""
var root_dir: String = ""
var last_error: String = ""

static func create(world_id_value: String) -> SaveStore:
	var store := SaveStore.new()
	store.world_id = world_id_value
	var override_dir := OS.get_environment("CRAFTMINE_SIDEVIEW_SAVE_DIR")
	if override_dir != "":
		store.root_dir = override_dir.path_join(world_id_value)
	else:
		store.root_dir = "user://save".path_join(world_id_value)
	return store

func state_path() -> String:
	return root_dir.path_join(STATE_FILE)

func exists() -> bool:
	return FileAccess.file_exists(state_path())

func ensure_dir() -> bool:
	var err := DirAccess.make_dir_recursive_absolute(root_dir)
	if err != OK and err != ERR_ALREADY_EXISTS:
		last_error = "cannot create save dir %s (error %d)" % [root_dir, err]
		return false
	return true

## Returns { "saved": bool, "created": bool, "error": String }
func save(state: WorldState) -> Dictionary:
	last_error = ""
	if not ensure_dir():
		return {"saved": false, "created": false, "error": last_error}
	var target := state_path()
	var temp := root_dir.path_join(TEMP_FILE)
	var backup := root_dir.path_join(BACKUP_FILE)
	var payload := state.to_canonical_json()

	var file := FileAccess.open(temp, FileAccess.WRITE)
	if file == null:
		last_error = "cannot open temp file %s (error %d)" % [temp, FileAccess.get_open_error()]
		return {"saved": false, "created": false, "error": last_error}
	file.store_string(payload)
	file.flush()
	file.close()

	var created := not FileAccess.file_exists(target)
	if not created and FileAccess.file_exists(backup):
		DirAccess.remove_absolute(backup)
	if not created:
		var rename_backup := DirAccess.rename_absolute(target, backup)
		if rename_backup != OK:
			last_error = "cannot move previous save aside (error %d)" % rename_backup
			return {"saved": false, "created": false, "error": last_error}
	var rename_result := DirAccess.rename_absolute(temp, target)
	if rename_result != OK:
		last_error = "cannot commit save file (error %d)" % rename_result
		# Roll the previous save back into place so the player keeps playing.
		if FileAccess.file_exists(backup):
			DirAccess.rename_absolute(backup, target)
		return {"saved": false, "created": false, "error": last_error}
	return {"saved": true, "created": created, "error": ""}

## Returns { "loaded": bool, "created": bool, "error": String, "state": WorldState|{} }
func load_into(fallback: WorldState) -> Dictionary:
	last_error = ""
	var target := state_path()
	var source := target
	if not FileAccess.file_exists(source) and FileAccess.file_exists(root_dir.path_join(BACKUP_FILE)):
		# Recover from a crash between "move aside" and "rename".
		source = root_dir.path_join(BACKUP_FILE)
	if not FileAccess.file_exists(source):
		return {"loaded": false, "created": false, "error": "", "state": fallback}
	var raw := FileAccess.get_file_as_string(source)
	if raw == "":
		last_error = "save file is empty: %s" % source
		return {"loaded": false, "created": false, "error": last_error, "state": fallback}
	var parsed: Variant = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		last_error = "save file is not valid JSON: %s" % source
		return {"loaded": false, "created": false, "error": last_error, "state": fallback}
	var data: Dictionary = parsed
	if str(data.get("format", "")) != WorldState.FORMAT:
		last_error = "unexpected save format %s" % str(data.get("format", ""))
		return {"loaded": false, "created": false, "error": last_error, "state": fallback}
	var version := int(data.get("stateVersion", 0))
	if version != fallback.state_version:
		# Refuse to guess. The host owns migrations; the base never silently
		# clears a player's progress.
		last_error = "state version mismatch: save=%d base=%d" % [version, fallback.state_version]
		return {"loaded": false, "created": false, "error": last_error, "state": fallback}
	fallback.apply_dict(data)
	return {"loaded": true, "created": source != target, "error": "", "state": fallback}

func read_raw() -> String:
	if not FileAccess.file_exists(state_path()):
		return ""
	return FileAccess.get_file_as_string(state_path())

## Removes every file this store owns. Used only by explicit acceptance resets.
func wipe() -> void:
	for name: String in [STATE_FILE, TEMP_FILE, BACKUP_FILE]:
		var path := root_dir.path_join(name)
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(path)
