# Four-direction walk animation driven by one sprite sheet.
#
# Sheet layout (see tools/make-assets.mjs): 4 columns = walk frames,
# 4 rows = down, left, right, up. Nothing is hidden in an engine resource, so a
# new artist or a model can replace the PNG and keep the same node.
class_name DirectionalSprite
extends Sprite2D

const ROWS := {"down": 0, "left": 1, "right": 2, "up": 3}
const COLUMNS := 4

@export var frame_time: float = 0.16

var facing: String = "down"
var moving: bool = false

var _elapsed: float = 0.0
var _column: int = 0


func _ready() -> void:
	hframes = COLUMNS
	vframes = ROWS.size()
	_apply()


func set_facing(value: String) -> void:
	if not ROWS.has(value):
		value = "down"
	if facing != value:
		facing = value
		_column = 0
		_elapsed = 0.0
	_apply()


func set_moving(value: bool) -> void:
	if moving != value:
		moving = value
		_column = 0
		_elapsed = 0.0
	_apply()


func advance(delta: float) -> void:
	if not moving:
		return
	_elapsed += delta
	while _elapsed >= frame_time:
		_elapsed -= frame_time
		_column = (_column + 1) % COLUMNS
	_apply()


func _apply() -> void:
	frame = int(ROWS[facing]) * COLUMNS + _column
