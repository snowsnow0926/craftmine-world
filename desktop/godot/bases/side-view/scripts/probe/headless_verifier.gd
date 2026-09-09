## Autoload `SideViewVerifier`.
##
## Dormant during normal play. Activated only when CRAFTMINE_SIDEVIEW_INPUT_PLAN
## points at a plan file, which is how the isolated acceptance harness drives a
## real headless process:
##
##   CRAFTMINE_SIDEVIEW_WORLD       world id (ruins / blank)
##   CRAFTMINE_SIDEVIEW_SAVE_DIR    isolated save root (per scenario)
##   CRAFTMINE_SIDEVIEW_RESET       "1" wipes that save root before boot
##   CRAFTMINE_SIDEVIEW_INPUT_PLAN  scripted button plan (JSON)
##   CRAFTMINE_SIDEVIEW_PROBE_OUT   where to write the run trace (JSON)
##   CRAFTMINE_SIDEVIEW_GATE_PROBE  asks the room manager to transition to this
##                                  room id without walking there, so the
##                                  authored gate guard can be observed
##
## The verifier can read runtime state and press buttons. It cannot write player
## position, abilities, checkpoints or rewards: there is no such entry point.
extends Node

const RUN_FORMAT := "craftmine.godot-sideview-run/1"

var active: bool = false
var input_source: ScriptedInputSource
var output_path: String = ""
var samples: Array = []
var gate_probe_room: String = ""
var _gate_probe_requested: bool = false
var _total_ticks: int = 0
var _ticks: int = 0
var _finished: bool = false
var _started: bool = false

func _ready() -> void:
	var plan_path := OS.get_environment("CRAFTMINE_SIDEVIEW_INPUT_PLAN")
	gate_probe_room = OS.get_environment("CRAFTMINE_SIDEVIEW_GATE_PROBE")
	if plan_path == "" and gate_probe_room == "":
		return
	output_path = OS.get_environment("CRAFTMINE_SIDEVIEW_PROBE_OUT")
	if plan_path != "":
		input_source = ScriptedInputSource.from_file(plan_path)
		if not input_source.is_valid():
			push_error("SideViewVerifier: %s" % input_source.last_error)
			get_tree().quit(3)
			return
		_total_ticks = input_source.duration_ticks() + input_source.settle_ticks()
	else:
		_total_ticks = 60
	active = true
	SideView.world_ready.connect(_on_world_ready)

func _on_world_ready() -> void:
	if _started:
		return
	_started = true
	if gate_probe_room != "":
		SideView.emit_event("gate_probe_started", {"targetRoom": gate_probe_room, "room": SideView.current_room_id})
		return
	SideView.input_source = input_source
	SideView.emit_event("verifier_started", {
		"plan": input_source.plan.get("name", ""),
		"totalTicks": _total_ticks,
		"source": "scripted",
	})

func _physics_process(_delta: float) -> void:
	if not active or not _started or _finished:
		return
	if SideView.player == null or SideView.state == null:
		return
	var player: SideViewPlayer = SideView.player as SideViewPlayer
	samples.append([
		SideView.elapsed_ticks,
		SideView.current_room_id,
		player.position.x,
		player.position.y,
		player.velocity.x,
		player.velocity.y,
		player.is_on_floor(),
		player.alive,
		player.has_double_jump(),
		player.double_jump_available,
	])
	_ticks += 1
	if gate_probe_room != "" and not _gate_probe_requested and _ticks >= 10:
		_gate_probe_requested = true
		# Ask the room manager for a real transition, exactly as a door would.
		# The authored gate guard must refuse it when the ability is missing.
		SideView.room_manager.request_transition(gate_probe_room, "spawn_from_ruins")
	if _ticks >= _total_ticks:
		_finish()

func _finish() -> void:
	_finished = true
	SideView.save_now("run_end")
	var probe: Dictionary = SideView.probe()
	var placement: Dictionary = SideView.state.player
	probe["player"] = {
		"room": str(placement.get("room", "")),
		"x": float(placement.get("x", 0.0)),
		"y": float(placement.get("y", 0.0)),
		"facing": int(placement.get("facing", 1)),
	}
	probe["progress"] = SideView.progress_dict()
	probe["roomBounds"] = _room_bounds_dict()
	if gate_probe_room != "":
		probe["gateProbe"] = {
			"targetRoom": gate_probe_room,
			"roomAfter": SideView.current_room_id,
			"playerRoom": str(placement.get("room", "")),
		}
	var payload := {
		"format": RUN_FORMAT,
		"worldId": SideView.state.world_id,
		"baseId": SideView.BASE_ID,
		"boot": SideView.boot_report,
		"inputPlan": input_source.plan if input_source != null else {},
		"sampleColumns": ["tick", "room", "x", "y", "vx", "vy", "onFloor", "alive", "doubleJumpUnlocked", "doubleJumpAvailable"],
		"samples": samples,
		"events": SideView.events,
		"final": probe,
		"saveRaw": SideView.save_store.read_raw() if SideView.save_store != null else "",
		"savePath": SideView.save_store.state_path() if SideView.save_store != null else "",
		"totalTicks": _total_ticks,
	}
	var text := JSON.stringify(payload, "", true, true)
	if output_path != "":
		var file := FileAccess.open(output_path, FileAccess.WRITE)
		if file == null:
			push_error("SideViewVerifier: cannot write %s" % output_path)
		else:
			file.store_string(text)
			file.flush()
			file.close()
	print("SIDEVIEW_RUN_OK ticks=%d samples=%d output=%s" % [_ticks, samples.size(), output_path])
	get_tree().quit(0)

func _room_bounds_dict() -> Dictionary:
	if SideView.room_manager == null:
		return {}
	var bounds: Rect2 = SideView.room_manager.get_room_bounds()
	return {"x": bounds.position.x, "y": bounds.position.y, "w": bounds.size.x, "h": bounds.size.y}
