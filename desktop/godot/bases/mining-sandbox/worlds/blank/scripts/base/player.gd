## Side-view sandbox player controller (reuses the side-view movement model).
##
## Node origin is at the player's feet, so `position.y` is the ground contact
## height and every tile is a top-left rectangle. The body is 12x26 px, which fits
## a one-tile-wide shaft at tileSize 16.
##
## Movement is a real CharacterBody2D simulation: horizontal acceleration,
## an impulse jump, coyote time and a jump buffer. There is deliberately no
## teleport helper; the only code that writes `position` is `place_at`.
class_name MiningPlayer
extends CharacterBody2D

var params: MiningParams
var state: MiningWorldState
var game: Node

var health: int = 3
var facing: int = 1
var on_ground: bool = false
var scripted_mode: bool = false
var scripted_input: Vector2 = Vector2.ZERO

var input_source: InputSource
var human_source: HumanInputSource
var scripted_source: ScriptedInputSource

var body_shape: CollisionShape2D
var visual: Sprite2D
var camera: Camera2D

var _coyote_timer: float = 0.0
var _jump_buffer_timer: float = 0.0
var _jump_was_held: bool = false
var _world_bounds: Rect2 = Rect2()


func setup(game_value: Node, params_value: MiningParams, state_value: MiningWorldState, world_size_px: Vector2) -> void:
	game = game_value
	params = params_value
	state = state_value
	_world_bounds = Rect2(Vector2.ZERO, world_size_px)
	health = int(state.player.health) if state != null else 3
	human_source = HumanInputSource.new()
	scripted_source = ScriptedInputSource.new()
	input_source = human_source


func _ready() -> void:
	_build_nodes()


func _build_nodes() -> void:
	collision_layer = 1
	collision_mask = 2
	motion_mode = CharacterBody2D.MOTION_MODE_GROUNDED
	up_direction = Vector2.UP
	floor_snap_length = 4.0

	var height := params.body_height()
	var half_width := params.half_width()

	body_shape = CollisionShape2D.new()
	body_shape.name = "BodyShape"
	var rect := RectangleShape2D.new()
	rect.size = Vector2(half_width * 2.0, height)
	body_shape.shape = rect
	body_shape.position = Vector2(0.0, -height * 0.5)
	add_child(body_shape)

	visual = Sprite2D.new()
	visual.name = "Visual"
	var image := Image.create(maxi(1, int(half_width * 2.0)), maxi(1, int(height)), false, Image.FORMAT_RGBA8)
	image.fill(Color(0.95, 0.78, 0.31, 1.0))
	visual.texture = ImageTexture.create_from_image(image)
	visual.position = Vector2(0.0, -height * 0.5)
	add_child(visual)

	camera = Camera2D.new()
	camera.name = "Camera"
	camera.position = Vector2(0.0, -height * 0.5)
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = params.camera_smoothing()
	camera.ignore_rotation = true
	# The declared deadzone is expressed as Camera2D drag margins.
	var view := Vector2(maxf(1.0, float(params.viewport_width())), maxf(1.0, float(params.viewport_height())))
	var deadzone := params.camera_deadzone()
	camera.drag_horizontal_enabled = true
	camera.drag_vertical_enabled = true
	camera.drag_left_margin = clampf(deadzone.x * 0.5 / view.x, 0.0, 0.45)
	camera.drag_right_margin = camera.drag_left_margin
	camera.drag_top_margin = clampf(deadzone.y * 0.5 / view.y, 0.0, 0.45)
	camera.drag_bottom_margin = camera.drag_top_margin
	_apply_camera_limits()
	add_child(camera)


func _apply_camera_limits() -> void:
	if camera == null:
		return
	if not params.clamp_camera_to_world() or _world_bounds.size == Vector2.ZERO:
		return
	camera.limit_left = int(_world_bounds.position.x)
	camera.limit_top = int(_world_bounds.position.y)
	camera.limit_right = int(_world_bounds.position.x + _world_bounds.size.x)
	camera.limit_bottom = int(_world_bounds.position.y + _world_bounds.size.y)


func _physics_process(delta: float) -> void:
	on_ground = is_on_floor()
	_tick_timers(delta)
	var source := _active_source()
	source.poll(delta)
	_apply_horizontal(delta, source)
	_apply_jump(delta, source)
	_apply_gravity(delta)
	move_and_slide()
	_update_camera()
	_sync_state()


func _active_source() -> InputSource:
	if scripted_mode:
		scripted_source.set_direction(scripted_input)
		return scripted_source
	return human_source


func _tick_timers(delta: float) -> void:
	_coyote_timer = maxf(0.0, _coyote_timer - delta)
	_jump_buffer_timer = maxf(0.0, _jump_buffer_timer - delta)


func _apply_horizontal(delta: float, source: InputSource) -> void:
	var target := source.move_axis * params.run_speed()
	if absf(source.move_axis) > 0.01:
		facing = 1 if source.move_axis > 0.0 else -1
		if visual != null:
			visual.flip_h = facing < 0
	var accel := params.ground_accel() if on_ground else params.air_accel()
	var decel := params.ground_decel() if on_ground else params.air_decel()
	var rate := accel if absf(target) > absf(velocity.x) else decel
	velocity.x = move_toward(velocity.x, target, rate * delta)


func _apply_jump(_delta: float, source: InputSource) -> void:
	if source.jump_pressed:
		_jump_buffer_timer = params.jump_buffer_time()
	if on_ground:
		_coyote_timer = params.coyote_time()
	var wants_jump := _jump_buffer_timer > 0.0
	if wants_jump and _coyote_timer > 0.0:
		velocity.y = params.jump_velocity()
		_jump_buffer_timer = 0.0
		_coyote_timer = 0.0
	# Variable jump height: releasing early cuts the upward impulse once.
	if not source.jump_held and _jump_was_held and velocity.y < 0.0:
		velocity.y *= params.jump_cut_multiplier()
	_jump_was_held = source.jump_held


func _apply_gravity(delta: float) -> void:
	if not on_ground:
		velocity.y = minf(velocity.y + params.gravity() * delta, params.max_fall_speed())


func _update_camera() -> void:
	if camera == null:
		return
	var look_ahead := params.camera_look_ahead_x() * float(facing)
	camera.position = camera.position.lerp(Vector2(look_ahead, -params.body_height() * 0.5), 0.5)


## The only position writer. Called on spawn, restore and reset.
func place_at(point: Vector2, facing_value: int = 1) -> void:
	position = point
	velocity = Vector2.ZERO
	facing = facing_value if facing_value != 0 else 1
	# The player is placed on solid ground, so grant coyote time immediately:
	# without it a jump pressed on the very first tick would be read as an air
	# jump.
	_coyote_timer = params.coyote_time() if params != null else 0.0
	_jump_buffer_timer = 0.0
	_jump_was_held = false
	if visual != null:
		visual.flip_h = facing < 0
	if camera != null:
		camera.reset_smoothing()
	_sync_state()


func set_facing(value: String) -> void:
	facing = -1 if value == "left" else 1
	if visual != null:
		visual.flip_h = facing < 0
	_sync_state()


func facing_name() -> String:
	return "left" if facing < 0 else "right"


func body_rect() -> Rect2:
	var half_width := params.half_width()
	var height := params.body_height()
	return Rect2(position.x - half_width, position.y - height, half_width * 2.0, height)


func _sync_state() -> void:
	if state == null or params == null:
		return
	state.set_player(tile_of_position(position), position, facing_name(), health)


func tile_of_position(point: Vector2) -> Vector2i:
	var size := float(params.tile_size())
	return Vector2i(int(floor(point.x / size)), int(floor((point.y - params.body_height() * 0.5) / size)))


func snapshot() -> Dictionary:
	return {
		"x": position.x,
		"y": position.y,
		"vx": velocity.x,
		"vy": velocity.y,
		"onFloor": is_on_floor(),
		"facing": facing_name(),
		"health": health,
		"scripted": scripted_mode,
	}
