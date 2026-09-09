extends Node

# Local standalone host for the existing managed protocol. No browser bridge,
# editor RPC, source mutation or synthetic input is involved.
const SAVE_FORMAT := "craftmine.standalone-save/1"
const LIMIT := 1048576
const Guard = preload("res://craftmine_shared/state_guard.gd")
var runtime: Node
var binding: Dictionary
var busy := false
var game_ready := false
var pending_quit := false
var recovered_from_backup := false
var label: Label
var folder := ""

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().auto_accept_quit = false
	make_controls()
	boot.call_deferred()

func make_controls() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 100
	add_child(layer)
	var panel := HBoxContainer.new()
	panel.position = Vector2(12, 12)
	layer.add_child(panel)
	var save := Button.new()
	save.text = "Save (F5)"
	save.pressed.connect(func(): persist(false))
	panel.add_child(save)
	label = Label.new()
	label.text = "Loading saved world..."
	panel.add_child(label)

func problem(message: String) -> void:
	label.text = "Save/load failed: " + message
	printerr("STANDALONE_ERROR: " + message)
	get_tree().paused = true
	if DisplayServer.get_name() == "headless" and "--craftmine-standalone-check" in OS.get_cmdline_user_args():
		get_tree().quit(2)

func boot() -> void:
	var input: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://_craftmine_standalone/initial.json"))
	if not input is Dictionary or input.get("format") != "craftmine.standalone-input/1":
		problem("Invalid standalone input")
		return
	binding = input
	folder = "user://standalone/" + (str(binding.worldId) + ":" + str(binding.buildId)).sha256_text()
	runtime = get_tree().root.get_node_or_null("CraftmineRuntime")
	if runtime == null:
		problem("Managed runtime is missing")
		return
	for _frame in range(600):
		if runtime.initialized:
			break
		await get_tree().process_frame
	if not runtime.initialized:
		problem("Managed runtime did not become ready")
		return
	var saved := read_saved()
	if saved.has("error"):
		problem(saved.error)
		return
	var snapshot: Variant = saved.get("snapshot", binding.snapshot)
	var loaded: Dictionary = await request("load", {"snapshot": runtime_state(snapshot)})
	if loaded.has("error"):
		problem(str(loaded.error))
		return
	game_ready = true
	label.text = "Saved world loaded" if saved.has("snapshot") else "Ready"
	await request("resume")
	var timer := Timer.new()
	timer.wait_time = 30.0
	timer.timeout.connect(func(): persist(false))
	add_child(timer)
	timer.start()
	if "--craftmine-standalone-check" in OS.get_cmdline_user_args():
		if DisplayServer.get_name() != "headless":
			problem("Acceptance requires headless display")
			return
		await request("pause")
		var before: Dictionary = await request("snapshot")
		print("STANDALONE_LOADED=" + JSON.stringify(exported_state(before.result.state)))
		if "--craftmine-standalone-equip" in OS.get_cmdline_user_args() and binding.baseId == "first-person":
			await request("resume")
			var equipped: Dictionary = await request("equip", {"value": "practice_sword"})
			if equipped.has("error"):
				problem(str(equipped.error))
				return
		await persist(true)

func request(op: String, args: Dictionary = {}) -> Dictionary:
	return await runtime.handle_request({"worldId": binding.sourceWorldId, "buildId": binding.buildId, "instanceId": "standalone", "op": op, "args": args})

# Copied worlds preserve exact source bytes. Map only explicit protocol identity
# fields at this local host boundary; never rewrite entity, room or quest IDs.
func runtime_state(input: Dictionary) -> Dictionary:
	if not Guard.validate(input, binding.worldId, binding.baseId, binding.baseVersion).is_empty():
		return {}
	var state := input.duplicate(true)
	state.worldId = binding.sourceWorldId
	state.body.worldId = binding.sourceWorldId
	if binding.baseId == "mining-sandbox":
		if not state.body.get("state") is Dictionary or state.body.state.get("worldId") != binding.worldId:
			return {}
		state.body.state.worldId = binding.sourceWorldId
	return state

func exported_state(input: Dictionary) -> Dictionary:
	if not Guard.validate(input, binding.sourceWorldId, binding.baseId, binding.baseVersion).is_empty():
		return {}
	var state := input.duplicate(true)
	state.worldId = binding.worldId
	state.body.worldId = binding.worldId
	if binding.baseId == "mining-sandbox":
		if not state.body.get("state") is Dictionary or state.body.state.get("worldId") != binding.sourceWorldId:
			return {}
		state.body.state.worldId = binding.worldId
	return state

func read_saved() -> Dictionary:
	var existed := false
	for name in ["state.json", "state.json.bak"]:
		var location: String = folder + "/" + str(name)
		if not FileAccess.file_exists(location):
			continue
		existed = true
		var file := FileAccess.open(location, FileAccess.READ)
		if file == null or file.get_length() > LIMIT * 2 + 4096:
			continue
		var value: Variant = JSON.parse_string(file.get_as_text())
		file.close()
		if not value is Dictionary or value.get("format") != SAVE_FORMAT or value.get("worldId") != binding.worldId or value.get("buildId") != binding.buildId:
			continue
		if not value.get("snapshotText") is String or value.snapshotText.to_utf8_buffer().size() > LIMIT or value.snapshotText.sha256_text() != value.get("snapshotSha256"):
			continue
		var state: Variant = JSON.parse_string(value.snapshotText)
		if state is Dictionary and Guard.validate(state, binding.worldId, binding.baseId, binding.baseVersion).is_empty():
			recovered_from_backup = name == "state.json.bak"
			return {"snapshot": state}
	return {"error": "No valid saved state; previous files preserved"} if existed else {}

func persist(and_quit: bool) -> void:
	pending_quit = pending_quit or and_quit
	if busy or not game_ready:
		return
	busy = true
	var was_paused := get_tree().paused
	await request("pause")
	var saved: Dictionary = await request("save")
	if saved.has("error"):
		busy = false
		problem(str(saved.error))
		return
	var state := exported_state(saved.result.state)
	if state.is_empty():
		busy = false
		problem("Saved state identity or format is invalid")
		return
	var text := JSON.stringify(state)
	var receipt := {"format": SAVE_FORMAT, "worldId": binding.worldId, "buildId": binding.buildId, "snapshotText": text, "snapshotSha256": text.sha256_text()}
	var failure := write_atomic(JSON.stringify(receipt))
	if not failure.is_empty():
		busy = false
		problem(failure)
		return
	label.text = "Saved"
	busy = false
	if "--craftmine-standalone-check" in OS.get_cmdline_user_args():
		print("STANDALONE_SAVED=" + text)
		print("STANDALONE_USER_DIR=" + OS.get_user_data_dir())
	if pending_quit:
		get_tree().quit(0)
	elif not was_paused:
		await request("resume")

func write_atomic(text: String) -> String:
	if DirAccess.make_dir_recursive_absolute(folder) != OK:
		return "Could not create save directory"
	var file := FileAccess.open(folder + "/state.json.tmp", FileAccess.WRITE)
	if file == null:
		return "Could not open temporary save"
	file.store_string(text)
	file.flush()
	var error := file.get_error()
	file.close()
	if error != OK:
		return "Could not flush temporary save"
	var dir := DirAccess.open(folder)
	if dir == null:
		return "Could not reopen save directory"
	if dir.file_exists("state.json"):
		if recovered_from_backup:
			# Never rotate a rejected primary over the only known valid backup.
			var rejected := "state.rejected." + str(Time.get_ticks_usec()) + ".json"
			if dir.rename("state.json", rejected) != OK:
				return "Could not preserve rejected primary"
		else:
			if dir.file_exists("state.json.bak") and dir.remove("state.json.bak") != OK:
				return "Could not replace previous backup"
			if dir.rename("state.json", "state.json.bak") != OK:
				return "Could not preserve previous save"
	if dir.rename("state.json.tmp", "state.json") != OK:
		if not recovered_from_backup and dir.file_exists("state.json.bak"):
			dir.rename("state.json.bak", "state.json")
		return "Could not commit saved state"
	recovered_from_backup = false
	return ""

func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F5:
		get_viewport().set_input_as_handled()
		persist(false)

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		persist(true)
