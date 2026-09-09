## Autoload `SideView`.
##
## Owns configuration, persistent state, the event log and the active input
## source. It deliberately does not own the scene tree: rooms and the player are
## built by Main so the same runtime can be reused by another entry scene.
##
## Host boundary: this script never builds, exports or launches Godot, never
## reads credentials and never writes outside the configured save directory.
extends Node

const BASE_ID := "side-view"
const PROBE_FORMAT := "craftmine.godot-sideview-probe/1"
const INPUT_ACTIONS := {
	"sv_move_left": [KEY_LEFT, KEY_A],
	"sv_move_right": [KEY_RIGHT, KEY_D],
	"sv_jump": [KEY_SPACE, KEY_Z],
	"sv_attack": [KEY_J, KEY_X],
	"sv_interact": [KEY_E, KEY_UP],
}

signal event_emitted(name: String, data: Dictionary)
signal state_saved(result: Dictionary)
signal world_ready()

var config: SideViewConfig
var state: WorldState
var save_store: SaveStore
var input_source: InputSource
var events: Array[Dictionary] = []
var boot_report: Dictionary = {}
var world_data: Dictionary = {}
var elapsed_ticks: int = 0
var world_ready_emitted: bool = false
var room_manager: Node = null
var player: Node = null
var current_room_id: String = ""

func _init() -> void:
	_register_actions()

func _ready() -> void:
	config = SideViewConfig.load_default()
	if not config.is_valid():
		push_error("SideView: %s" % config.load_error)
	events.clear()

func _physics_process(_delta: float) -> void:
	# Physics frames, not idle frames: the probe, events and acceptance samples
	# then share one monotonic clock at exactly 60 Hz.
	elapsed_ticks += 1

func _register_actions() -> void:
	for action: String in INPUT_ACTIONS.keys():
		if not InputMap.has_action(action):
			InputMap.add_action(action, 0.2)
		for keycode: int in INPUT_ACTIONS[action]:
			var event := InputEventKey.new()
			event.physical_keycode = keycode
			InputMap.action_add_event(action, event)

## Called by Main once the world and player exist.
func bind_world(data: Dictionary, loaded_state: WorldState, store: SaveStore, report: Dictionary) -> void:
	world_data = data
	state = loaded_state
	save_store = store
	boot_report = report
	if input_source == null:
		input_source = HumanInputSource.new()

func emit_event(name: String, data: Dictionary = {}) -> void:
	var record := {
		"tick": elapsed_ticks,
		"name": name,
		"data": data,
	}
	events.append(record)
	event_emitted.emit(name, data)

func save_now(reason: String) -> Dictionary:
	if ProjectSettings.get_setting("craftmine/runtime/enabled", false):
		return {"saved": false, "managed": true, "reason": reason}
	if state == null or save_store == null:
		return {"saved": false, "error": "runtime not bound"}
	var result := save_store.save(state)
	result["reason"] = reason
	result["tick"] = elapsed_ticks
	state_saved.emit(result)
	if not result.get("saved", false):
		push_error("SideView: save failed (%s): %s" % [reason, result.get("error", "")])
	return result

func mark_world_ready() -> void:
	if world_ready_emitted:
		return
	world_ready_emitted = true
	world_ready.emit()

## Read-only snapshot. There is no matching setter: acceptance can observe the
## runtime but cannot write expectations into it.
func probe() -> Dictionary:
	return {
		"format": PROBE_FORMAT,
		"baseId": BASE_ID,
		"baseVersion": config.base_version if config != null else "",
		"worldId": state.world_id if state != null else "",
		"stateVersion": state.state_version if state != null else 0,
		"stateHash": persistent_hash(),
		"tick": elapsed_ticks,
		"time": float(elapsed_ticks) / 60.0,
		"abilities": state.to_persistent_dict().get("abilities", {}) if state != null else {},
		"checkpoints": {
			"activated": state.to_persistent_dict().get("checkpoints", {}) if state != null else {},
			"active": state.active_checkpoint if state != null else "",
		},
		"rewards": state.to_persistent_dict().get("rewards", {}) if state != null else {},
		"rooms": state.to_dict().get("rooms", {}) if state != null else {},
		"counters": state.counters if state != null else {},
		"inventory": state.inventory if state != null else {},
	}

func persistent_hash() -> String:
	if state == null:
		return ""
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(JSON.stringify(state.to_persistent_dict(), "", true, true).to_utf8_buffer())
	return ctx.finish().hex_encode()

## Progress mapping for the host application receipt (see task B, section 6.2).
## The host shape is 3D; a side-view world maps its plane to x/y and pins z/yaw/pitch.
func progress_dict() -> Dictionary:
	var placement: Dictionary = state.player if state != null else {}
	return {
		"format": "craftmine.progress/1",
		"player": {
			"x": float(placement.get("x", 0.0)),
			"y": float(placement.get("y", 0.0)),
			"z": 0.0,
			"yaw": 0.0,
			"pitch": 0.0,
		},
	}
