## Typed view over params/mining_sandbox_params.json.
##
## The JSON file is the single source of truth for tuning so that the runtime,
## the probe and the documentation never drift apart. When a world project does
## not ship the file (a hand-made project) the built-in defaults below are used;
## they are byte-for-byte the values of params/mining_sandbox_params.json.
##
## Movement is inherited unchanged from side-view 1.0.0 (see docs/REUSE.md).
class_name MiningParams
extends RefCounted

const PARAMS_PATH := "res://params/mining_sandbox_params.json"
const EXPECTED_FORMAT := "craftmine.godot-mining-sandbox-params/1"

var load_error: String = ""
var format: String = ""
var base_id: String = "mining-sandbox"
var base_version: String = "1.0.0"
var movement: Dictionary = {}
var body: Dictionary = {}
var camera: Dictionary = {}
var grid: Dictionary = {}
var interaction: Dictionary = {}
var economy: Dictionary = {}
var limits: Dictionary = {}
var world: Dictionary = {}


# Avoid a self-typed static factory: Godot 4.7.2 retains the script at editor exit.
static func load_default():
	return load_from(PARAMS_PATH)


static func load_from(path: String):
	var config = load("res://scripts/base/mining_params.gd").new()
	config._read(path)
	return config


func _read(path: String) -> void:
	_apply_defaults()
	if not FileAccess.file_exists(path):
		# A missing params file is a supported fallback, not a load failure.
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(parsed) != TYPE_DICTIONARY:
		load_error = "params file is not a JSON object: %s" % path
		return
	var data: Dictionary = parsed
	format = str(data.get("format", ""))
	if format != EXPECTED_FORMAT:
		load_error = "unexpected params format %s" % format
		return
	base_id = str(data.get("baseId", base_id))
	base_version = str(data.get("baseVersion", base_version))
	movement = data.get("movement", {}) if data.get("movement") is Dictionary else {}
	body = data.get("body", {}) if data.get("body") is Dictionary else {}
	camera = data.get("camera", {}) if data.get("camera") is Dictionary else {}
	grid = data.get("grid", {}) if data.get("grid") is Dictionary else {}
	interaction = data.get("interaction", {}) if data.get("interaction") is Dictionary else {}
	economy = data.get("economy", {}) if data.get("economy") is Dictionary else {}
	limits = data.get("limits", {}) if data.get("limits") is Dictionary else {}
	world = data.get("world", {}) if data.get("world") is Dictionary else {}


func _apply_defaults() -> void:
	format = EXPECTED_FORMAT
	base_id = "mining-sandbox"
	base_version = "1.0.0"
	movement = {
		"gravity": 1800.0,
		"maxFallSpeed": 1200.0,
		"runSpeed": 260.0,
		"groundAccel": 2400.0,
		"groundDecel": 2600.0,
		"airAccel": 1800.0,
		"airDecel": 900.0,
		"jumpVelocity": -700.0,
		"coyoteTime": 0.1,
		"jumpBufferTime": 0.12,
		"jumpCutMultiplier": 0.45,
		"upDirection": "up",
	}
	body = {"halfWidth": 6.0, "height": 26.0}
	camera = {"smoothing": 8.0, "deadzoneWidth": 96.0, "deadzoneHeight": 48.0, "lookAheadX": 48.0, "clampToWorldBounds": true}
	grid = {"tileSize": 16, "chunkTiles": [16, 16]}
	interaction = {
		"reachTiles": 5.0,
		"reachOrigin": "player-center",
		"digCooldown": 0.12,
		"placeCooldown": 0.12,
		"adjacencyRequired": true,
		"buryMarginPixels": 1.0,
		"cancelWindowSeconds": 0.0,
	}
	economy = {"maxStack": 999, "ledgerLimit": 1024}
	limits = {
		"maxMapTiles": 262144,
		"maxChunks": 1024,
		"maxEditedCellsPerChunk": 4096,
		"maxProgressBytes": 4194304,
		"maxChunkBytes": 1048576,
	}
	world = {"physicsTicksPerSecond": 60, "viewportWidth": 640, "viewportHeight": 360}


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


func coyote_time() -> float:
	return float(movement.get("coyoteTime", 0.1))


func jump_buffer_time() -> float:
	return float(movement.get("jumpBufferTime", 0.12))


func jump_cut_multiplier() -> float:
	return float(movement.get("jumpCutMultiplier", 0.45))


# --- body / camera --------------------------------------------------------

func half_width() -> float:
	return float(body.get("halfWidth", 6.0))


func body_height() -> float:
	return float(body.get("height", 26.0))


func camera_smoothing() -> float:
	return float(camera.get("smoothing", 8.0))


func camera_deadzone() -> Vector2:
	return Vector2(float(camera.get("deadzoneWidth", 96.0)), float(camera.get("deadzoneHeight", 48.0)))


func camera_look_ahead_x() -> float:
	return float(camera.get("lookAheadX", 48.0))


func clamp_camera_to_world() -> bool:
	return bool(camera.get("clampToWorldBounds", true))


# --- grid / interaction / economy ----------------------------------------

func tile_size() -> int:
	return int(grid.get("tileSize", 16))


func chunk_tiles() -> Vector2i:
	var raw: Variant = grid.get("chunkTiles", [16, 16])
	if raw is Array and raw.size() == 2:
		return Vector2i(int(raw[0]), int(raw[1]))
	return Vector2i(16, 16)


## reachTiles is a count of tiles: the interaction radius in pixels is
## reachTiles * tileSize. The probe/acceptance computes the same distance in
## pixels (tile centre to player centre), so the two agree.
func reach_pixels() -> float:
	return float(interaction.get("reachTiles", 5.0)) * float(tile_size())


func adjacency_required() -> bool:
	return bool(interaction.get("adjacencyRequired", true))


func bury_margin() -> float:
	return float(interaction.get("buryMarginPixels", 1.0))


func dig_cooldown() -> float:
	return float(interaction.get("digCooldown", 0.12))


func place_cooldown() -> float:
	return float(interaction.get("placeCooldown", 0.12))


func max_stack() -> int:
	return int(economy.get("maxStack", 999))


func ledger_limit() -> int:
	return int(economy.get("ledgerLimit", 1024))


func max_edited_cells_per_chunk() -> int:
	return int(limits.get("maxEditedCellsPerChunk", 4096))


func viewport_width() -> int:
	return int(world.get("viewportWidth", 640))


func viewport_height() -> int:
	return int(world.get("viewportHeight", 360))
