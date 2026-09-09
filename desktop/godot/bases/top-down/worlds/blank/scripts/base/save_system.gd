# Progress persistence for one world instance.
#
# Layout: user://worlds/<sha256(worldId)>/progress.json
# The world id is also checked inside the payload, so a progress file copied from
# another world is rejected instead of silently applied. With
# `application/config/custom_user_dir_name` set per world project (see
# tools/new-world.mjs), user:// is additionally a separate directory per world
# instance, which is what makes two town instances independent.
class_name SaveSystem
extends RefCounted


static func progress_dir(world_id: String) -> String:
	return "user://worlds/%s" % world_id.sha256_text()


static func progress_path(world_id: String) -> String:
	return progress_dir(world_id) + "/progress.json"


static func save(state: WorldState) -> Dictionary:
	if state.world_id.is_empty():
		return {"ok": false, "error": "World identity is missing"}
	var directory := progress_dir(state.world_id)
	if DirAccess.make_dir_recursive_absolute(directory) != OK:
		return {"ok": false, "error": "Progress directory could not be created"}
	var payload := {
		"format": BaseContract.PROGRESS_FORMAT,
		"worldId": state.world_id,
		"savedAt": Time.get_datetime_string_from_system(true),
		"state": state.to_dict(),
	}
	var text := JSON.stringify(payload)
	var path := progress_path(state.world_id)
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return {"ok": false, "error": "Progress could not be opened for writing"}
	file.store_string(text)
	var status := file.get_error()
	file.close()
	if status != OK:
		return {"ok": false, "error": "Progress write failed"}
	return {
		"ok": true,
		"path": ProjectSettings.globalize_path(path),
		"bytes": text.to_utf8_buffer().size(),
		"sha256": text.sha256_text(),
	}


static func restore_into(state: WorldState) -> Dictionary:
	var path := progress_path(state.world_id)
	if not FileAccess.file_exists(path):
		return {"ok": true, "restored": false, "reason": "no_progress"}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {"ok": false, "error": "Progress could not be read"}
	var text := file.get_as_text()
	file.close()
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary:
		return {"ok": false, "error": "Progress is not valid JSON"}
	if not parsed.get("format") is String or parsed.get("format") != BaseContract.PROGRESS_FORMAT:
		return {"ok": false, "error": "Progress format is not supported"}
	if not parsed.get("worldId") is String or String(parsed.worldId) != state.world_id:
		return {"ok": false, "error": "Progress belongs to another world"}
	if not parsed.get("state") is Dictionary:
		return {"ok": false, "error": "Progress state is missing"}
	var applied := state.from_dict(parsed.state, state.world_id)
	if not applied.ok:
		return {"ok": false, "error": String(applied.error)}
	return {
		"ok": true,
		"restored": true,
		"sha256": text.sha256_text(),
		"bytes": text.to_utf8_buffer().size(),
	}


static func erase(world_id: String) -> Dictionary:
	var path := progress_path(world_id)
	if not FileAccess.file_exists(path):
		return {"ok": true, "erased": false}
	var absolute := ProjectSettings.globalize_path(path)
	var status := DirAccess.remove_absolute(absolute)
	return {"ok": status == OK, "erased": status == OK, "error": "" if status == OK else "Progress could not be erased"}
