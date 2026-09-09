extends Node

## Headless acceptance driver.
##
## It reads a command list from a JSON file, runs every operation through the
## same BaseOps used by the Web bridge, and prints one machine-readable line.
## The scene, physics, collision, ammunition, damage and file writes are all
## real; only the input source is scripted.
##
## Usage:
##   godot --headless --path <project> -- --base-script=res://probe_script.json
##       [--base-world-id=<id>] [--base-output=user://probe_result.json]
##
## The script file is a JSON array of {"op": "...", "args": {...}} objects.

var ops: BaseOps
var script_path := ""
var output_path := ""
var world_id := ""


func _ready() -> void:
	name = "ProbeRunner"
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--base-script="):
			script_path = argument.trim_prefix("--base-script=")
		elif argument.begins_with("--base-world-id="):
			world_id = argument.trim_prefix("--base-world-id=")
		elif argument.begins_with("--base-output="):
			output_path = argument.trim_prefix("--base-output=")
	if script_path.is_empty():
		set_process(false)
		return
	var root := get_parent()
	if not root is BaseWorld:
		_report({"base": "first-person", "error": "Probe runner is not under a BaseWorld"})
		return
	ops = BaseOps.new(root)
	await get_tree().process_frame
	await get_tree().physics_frame
	if not world_id.is_empty():
		root.set_world_id(world_id)
	_run()


func _run() -> void:
	var file := FileAccess.open(script_path, FileAccess.READ)
	if file == null:
		_report({"base": "first-person", "error": "Command file is missing: " + script_path})
		return
	var text := file.get_as_text()
	file.close()
	var commands: Variant = JSON.parse_string(text)
	if not commands is Array:
		_report({"base": "first-person", "error": "Command file is not a JSON array"})
		return
	var results := []
	for command in commands:
		if not command is Dictionary:
			results.append({"op": "<invalid>", "error": "Command is not an object"})
			continue
		var op := str(command.get("op", ""))
		var args: Variant = command.get("args", {})
		if not args is Dictionary:
			results.append({"op": op, "error": "Command arguments are not an object"})
			continue
		var started := Time.get_ticks_usec()
		var outcome: Dictionary = await ops.execute(op, args)
		var entry := {
			"op": op,
			"args": args,
			"elapsedMs": float(Time.get_ticks_usec() - started) / 1000.0,
		}
		if outcome.has("result"):
			entry["result"] = outcome.result
		if outcome.has("error"):
			entry["error"] = outcome.error
		results.append(entry)
	var payload := {
		"base": "first-person",
		"headless": DisplayServer.get_name() == "headless",
		"worldId": world_id,
		"persistentStorage": OS.is_userfs_persistent(),
		"results": results,
	}
	if not output_path.is_empty():
		var out := FileAccess.open(output_path, FileAccess.WRITE)
		if out != null:
			out.store_string(JSON.stringify(payload))
			out.close()
	_report(payload)


func _report(payload: Dictionary) -> void:
	print("CRAFTMINE_FP_BASE=" + JSON.stringify(payload))
	get_tree().quit()
