## Typed view over params/side_view_params.json.
##
## The JSON file is the single source of truth for tuning so that the runtime,
## the acceptance harness and the documentation never drift apart. Nothing here
## reads or writes outside the project.
class_name SideViewConfig
extends RefCounted

const PARAMS_PATH := "res://params/side_view_params.json"
const EXPECTED_FORMAT := "craftmine.godot-sideview-params/1"

var format: String = ""
var base_id: String = ""
var base_version: String = ""
var movement: Dictionary = {}
var combat: Dictionary = {}
var respawn: Dictionary = {}
var camera: Dictionary = {}
var world: Dictionary = {}
var gates: Dictionary = {}
var load_error: String = ""

static func load_default() -> SideViewConfig:
	var config := SideViewConfig.new()
	config._read(PARAMS_PATH)
	return config

static func load_from(path: String) -> SideViewConfig:
	var config := SideViewConfig.new()
	config._read(path)
	return config

func _read(path: String) -> void:
	if not FileAccess.file_exists(path):
		load_error = "missing params file: %s" % path
		return
	var raw := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		load_error = "params file is not a JSON object: %s" % path
		return
	var data: Dictionary = parsed
	format = str(data.get("format", ""))
	if format != EXPECTED_FORMAT:
		load_error = "unexpected params format %s" % format
		return
	base_id = str(data.get("baseId", "side-view"))
	base_version = str(data.get("baseVersion", "0.0.0"))
	movement = data.get("movement", {})
	combat = data.get("combat", {})
	respawn = data.get("respawn", {})
	camera = data.get("camera", {})
	world = data.get("world", {})
	gates = data.get("gates", {})

func is_valid() -> bool:
	return load_error == ""

# --- movement -------------------------------------------------------------

func gravity() -> float:
	return float(movement.get("gravity", 1800.0))

func max_fall_speed() -> float:
	return float(movement.get("maxFallSpeed", 1200.0))

func run_speed() -> float:
	return float(movement.get("runSpeed", 260.0))

func ground_accel() -> float:
	return float(movement.get("groundAccel", 2400.0))

func ground_decel() -> float:
	return float(movement.get("groundDecel", 2600.0))

func air_accel() -> float:
	return float(movement.get("airAccel", 1800.0))

func air_decel() -> float:
	return float(movement.get("airDecel", 900.0))

func jump_velocity() -> float:
	return float(movement.get("jumpVelocity", -700.0))

func double_jump_velocity() -> float:
	return float(movement.get("doubleJumpVelocity", -640.0))

func coyote_time() -> float:
	return float(movement.get("coyoteTime", 0.1))

func jump_buffer_time() -> float:
	return float(movement.get("jumpBufferTime", 0.12))

func jump_cut_multiplier() -> float:
	return float(movement.get("jumpCutMultiplier", 0.45))

# --- combat ---------------------------------------------------------------

func max_health() -> int:
	return int(combat.get("maxHealth", 3))

func invulnerable_time() -> float:
	return float(combat.get("invulnerableTime", 0.8))

func attack_cooldown() -> float:
	return float(combat.get("attackCooldown", 0.35))

func attack_active_time() -> float:
	return float(combat.get("attackActiveTime", 0.12))

func attack_damage() -> int:
	return int(combat.get("attackDamage", 1))

func attack_reach() -> float:
	return float(combat.get("attackReach", 34.0))

func attack_height() -> float:
	return float(combat.get("attackHeight", 30.0))

# --- respawn / camera / world --------------------------------------------

func respawn_delay() -> float:
	return float(respawn.get("delaySeconds", 0.6))

func camera_smoothing() -> float:
	return float(camera.get("smoothing", 8.0))

func camera_look_ahead_x() -> float:
	return float(camera.get("lookAheadX", 48.0))

func clamp_camera_to_room() -> bool:
	return bool(camera.get("clampToRoomBounds", true))

func player_half_width() -> float:
	return float(world.get("playerHalfWidth", 10.0))

func player_height() -> float:
	return float(world.get("playerHeight", 40.0))

# --- derived jump metrics -------------------------------------------------
# These are the arithmetic facts the gate check depends on. A jump is modelled
# as a pure impulse against constant gravity, which is exactly what the player
# controller does (no air control on Y, no wall interaction).

func single_jump_rise() -> float:
	var v := jump_velocity()
	return (v * v) / (2.0 * gravity())

func double_jump_extra_rise() -> float:
	var v := double_jump_velocity()
	return (v * v) / (2.0 * gravity())

## Maximum height reachable when the second jump is triggered at the apex of
## the first one. Triggering earlier is strictly worse because the second jump
## sets vertical velocity instead of adding to it.
func double_jump_total_rise() -> float:
	return single_jump_rise() + double_jump_extra_rise()

func single_jump_air_time() -> float:
	return 2.0 * absf(jump_velocity()) / gravity()

func single_jump_horizontal_reach() -> float:
	return run_speed() * single_jump_air_time()

func gate_margin_report(required_rise: float) -> Dictionary:
	var single := single_jump_rise()
	var double_total := double_jump_total_rise()
	var min_single := float(gates.get("minimumSingleJumpMargin", 16.0))
	var min_double := float(gates.get("minimumDoubleJumpMargin", 16.0))
	return {
		"requiredRise": required_rise,
		"singleJumpRise": single,
		"doubleJumpTotalRise": double_total,
		"singleJumpMargin": required_rise - single,
		"doubleJumpMargin": double_total - required_rise,
		"singleJumpBlocked": (required_rise - single) >= min_single,
		"doubleJumpPasses": (double_total - required_rise) >= min_double,
	}
