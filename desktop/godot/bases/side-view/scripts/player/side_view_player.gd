## Side-view player controller.
##
## Node origin is at the player's feet, so `position.y` is the ground contact
## height and all world geometry can be expressed as top-left rectangles.
##
## Movement is a real CharacterBody2D simulation: horizontal acceleration, an
## impulse jump, optional impulse double jump, coyote time and a jump buffer.
## There is deliberately no teleport helper. The only code that writes
## `position` is `place_at`, which is called by the room manager on spawn, room
## transition and respawn.
class_name SideViewPlayer
extends CharacterBody2D

const ABILITY_DOUBLE_JUMP := "double_jump"

signal died(cause: String)
signal respawned(checkpoint_id: String)
signal attack_started(facing: int)
signal hazard_entered(hazard_id: String)

var config: SideViewConfig
var state: WorldState
var runtime: Node

var health: int = 3
var alive: bool = true
var facing: int = 1
var double_jump_available: bool = false
var on_ground: bool = false

var _coyote_timer: float = 0.0
var _jump_buffer_timer: float = 0.0
var _attack_cooldown_timer: float = 0.0
var _attack_active_timer: float = 0.0
var _invulnerable_timer: float = 0.0
var _respawn_timer: float = 0.0
var _jump_was_held: bool = false
var _swing_hits: Dictionary = {}
var _spawn_point: Vector2 = Vector2.ZERO

var body_shape: CollisionShape2D
var attack_area: Area2D
var attack_shape: CollisionShape2D
var camera: Camera2D
var visual: Sprite2D

func setup(config_value: SideViewConfig, state_value: WorldState, runtime_node: Node) -> void:
	config = config_value
	state = state_value
	runtime = runtime_node
	health = config.max_health()
	restore_vitals()

func _ready() -> void:
	_build_nodes()

func _build_nodes() -> void:
	collision_layer = 1
	collision_mask = 2
	motion_mode = CharacterBody2D.MOTION_MODE_GROUNDED
	up_direction = Vector2.UP

	body_shape = CollisionShape2D.new()
	body_shape.name = "BodyShape"
	var rect := RectangleShape2D.new()
	rect.size = Vector2(config.player_half_width() * 2.0, config.player_height())
	body_shape.shape = rect
	body_shape.position = Vector2(0.0, -config.player_height() * 0.5)
	add_child(body_shape)

	visual = Sprite2D.new()
	visual.name = "Visual"
	var image := Image.create(int(config.player_half_width() * 2.0), int(config.player_height()), false, Image.FORMAT_RGBA8)
	image.fill(Color(0.36, 0.78, 0.96, 1.0))
	visual.texture = ImageTexture.create_from_image(image)
	visual.position = Vector2(0.0, -config.player_height() * 0.5)
	add_child(visual)

	attack_area = Area2D.new()
	attack_area.name = "AttackArea"
	attack_area.collision_layer = 0
	attack_area.collision_mask = 4
	attack_area.monitoring = false
	attack_shape = CollisionShape2D.new()
	var attack_rect := RectangleShape2D.new()
	attack_rect.size = Vector2(config.attack_reach(), config.attack_height())
	attack_shape.shape = attack_rect
	attack_area.add_child(attack_shape)
	add_child(attack_area)
	_update_attack_area()

	camera = Camera2D.new()
	camera.name = "Camera"
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = config.camera_smoothing()
	camera.position = Vector2(0.0, -config.player_height() * 0.5)
	add_child(camera)

func _update_attack_area() -> void:
	var offset := config.attack_reach() * 0.5 + config.player_half_width() * 0.5
	attack_area.position = Vector2(offset * float(facing), -config.player_height() * 0.5)

func _physics_process(delta: float) -> void:
	on_ground = is_on_floor()
	if not alive:
		_tick_death(delta)
		sync_vitals()
		return

	_tick_timers(delta)
	var input_source: InputSource = runtime.input_source
	input_source.poll(delta)

	_apply_horizontal(delta, input_source)
	_apply_jump(delta, input_source)
	_apply_gravity(delta)
	_apply_attack(delta, input_source)

	move_and_slide()
	_sync_state_placement()
	_check_hazards()
	_check_bounds()
	_check_grounded_reset()

## Keeps the persistent record of where the player is, so any save (event-driven
## or on quit) restores the real position instead of the room entry point.
func _sync_state_placement() -> void:
	if state == null:
		return
	state.player["x"] = position.x
	state.player["y"] = position.y
	state.player["facing"] = facing
	sync_vitals()

func _tick_timers(delta: float) -> void:
	_coyote_timer = maxf(0.0, _coyote_timer - delta)
	_jump_buffer_timer = maxf(0.0, _jump_buffer_timer - delta)
	_attack_cooldown_timer = maxf(0.0, _attack_cooldown_timer - delta)
	_invulnerable_timer = maxf(0.0, _invulnerable_timer - delta)
	if _attack_active_timer > 0.0:
		_attack_active_timer = maxf(0.0, _attack_active_timer - delta)
		_resolve_attack_hits()
		if _attack_active_timer == 0.0:
			attack_area.monitoring = false

func _apply_horizontal(delta: float, input_source: InputSource) -> void:
	var target := input_source.move_axis * config.run_speed()
	if absf(input_source.move_axis) > 0.01:
		facing = 1 if input_source.move_axis > 0.0 else -1
		_update_attack_area()
		visual.flip_h = facing < 0
	var accel := config.ground_accel() if on_ground else config.air_accel()
	var decel := config.ground_decel() if on_ground else config.air_decel()
	var rate := accel if absf(target) > absf(velocity.x) else decel
	velocity.x = move_toward(velocity.x, target, rate * delta)

func _apply_jump(delta: float, input_source: InputSource) -> void:
	if input_source.jump_pressed:
		_jump_buffer_timer = config.jump_buffer_time()
	if on_ground:
		_coyote_timer = config.coyote_time()
		double_jump_available = state.has_ability(ABILITY_DOUBLE_JUMP)

	var wants_jump := _jump_buffer_timer > 0.0
	if wants_jump and _coyote_timer > 0.0:
		velocity.y = config.jump_velocity()
		_jump_buffer_timer = 0.0
		_coyote_timer = 0.0
		if runtime != null:
			runtime.emit_event("player_jump", {"kind": "ground", "y": position.y})
	elif wants_jump and not on_ground and double_jump_available:
		velocity.y = config.double_jump_velocity()
		_jump_buffer_timer = 0.0
		double_jump_available = false
		if runtime != null:
			runtime.emit_event("player_jump", {"kind": "double", "y": position.y})

	# Variable jump height: releasing early cuts the upward impulse once.
	if not input_source.jump_held and _jump_was_held and velocity.y < 0.0:
		velocity.y *= config.jump_cut_multiplier()
	_jump_was_held = input_source.jump_held

func _apply_gravity(delta: float) -> void:
	if not on_ground:
		velocity.y = minf(velocity.y + config.gravity() * delta, config.max_fall_speed())

func _apply_attack(_delta: float, input_source: InputSource) -> void:
	if not input_source.attack_pressed:
		return
	if _attack_cooldown_timer > 0.0:
		return
	_attack_cooldown_timer = config.attack_cooldown()
	_attack_active_timer = config.attack_active_time()
	_swing_hits.clear()
	attack_area.monitoring = true
	_update_attack_area()
	if runtime != null:
		runtime.emit_event("attack_started", {"facing": facing})
	attack_started.emit(facing)
	_resolve_attack_hits()

func _resolve_attack_hits() -> void:
	if attack_area == null:
		return
	for area: Area2D in attack_area.get_overlapping_areas():
		var target: Node = area
		if _swing_hits.has(target.get_instance_id()):
			continue
		if not target.has_method("receive_hit"):
			continue
		_swing_hits[target.get_instance_id()] = true
		target.call("receive_hit", config.attack_damage(), facing)

func _check_hazards() -> void:
	for area: Area2D in _hazard_areas():
		if _invulnerable_timer > 0.0:
			return
		var hazard_id: String = str(area.get("hazard_id")) if area.get("hazard_id") != null else str(area.name)
		hazard_entered.emit(hazard_id)
		if runtime != null:
			runtime.emit_event("hazard_touched", {"hazardId": hazard_id})
		take_damage(config.max_health(), "hazard:%s" % hazard_id)
		return

func _hazard_areas() -> Array[Area2D]:
	var found: Array[Area2D] = []
	if get_parent() == null:
		return found
	for node: Node in get_tree().get_nodes_in_group("sv_hazard"):
		if node is Area2D:
			var area: Area2D = node
			if area.overlaps_body(self):
				found.append(area)
	return found

func _check_bounds() -> void:
	if runtime == null or runtime.room_manager == null:
		return
	var bounds: Rect2 = runtime.room_manager.get_room_bounds()
	if bounds.size == Vector2.ZERO:
		return
	if position.y > bounds.position.y + bounds.size.y + 120.0:
		take_damage(config.max_health(), "fell_out_of_room")

func _check_grounded_reset() -> void:
	if is_on_floor():
		double_jump_available = state.has_ability(ABILITY_DOUBLE_JUMP)

func _tick_death(delta: float) -> void:
	velocity = Vector2.ZERO
	_respawn_timer -= delta
	if _respawn_timer <= 0.0:
		_do_respawn()

func take_damage(amount: int, cause: String = "unknown") -> void:
	if not alive or amount <= 0:
		return
	if _invulnerable_timer > 0.0:
		return
	health -= amount
	_invulnerable_timer = config.invulnerable_time()
	if runtime != null:
		runtime.emit_event("player_damaged", {"amount": amount, "cause": cause, "health": maxi(health, 0)})
	if health <= 0:
		_die(cause)
	sync_vitals()

func _die(cause: String) -> void:
	if not alive:
		return
	alive = false
	health = 0
	_respawn_timer = config.respawn_delay()
	velocity = Vector2.ZERO
	visible = false
	if runtime != null:
		runtime.state.add_counter("deaths", 1)
		runtime.emit_event("player_died", {"cause": cause})
		sync_vitals()
		runtime.save_now("death")
	died.emit(cause)

func _do_respawn() -> void:
	alive = true
	health = config.max_health()
	visible = true
	_invulnerable_timer = config.invulnerable_time()
	_respawn_timer = 0.0
	var checkpoint_id: String = state.active_checkpoint
	var point := _spawn_point
	if runtime != null and runtime.room_manager != null:
		var resolved: Vector2 = runtime.room_manager.respawn_point(checkpoint_id)
		if resolved != Vector2.ZERO:
			point = resolved
	place_at(point, facing)
	if runtime != null:
		runtime.emit_event("player_respawned", {"checkpointId": checkpoint_id, "x": point.x, "y": point.y})
		sync_vitals()
		runtime.save_now("respawn")
	respawned.emit(checkpoint_id)

## The only position writer. Called on spawn, room transition and respawn.
func place_at(point: Vector2, facing_value: int = 1) -> void:
	position = point
	velocity = Vector2.ZERO
	facing = facing_value if facing_value != 0 else 1
	# The player is placed on solid ground, so grant coyote time immediately:
	# without it, a jump pressed on the very first tick would be read as an
	# air jump and spend the double jump.
	_coyote_timer = config.coyote_time()
	_jump_buffer_timer = 0.0
	_attack_active_timer = 0.0
	_attack_cooldown_timer = 0.0
	double_jump_available = state.has_ability(ABILITY_DOUBLE_JUMP)
	if attack_area != null:
		attack_area.monitoring = false
		_update_attack_area()
	if visual != null:
		visual.flip_h = facing < 0

func set_spawn_point(point: Vector2) -> void:
	_spawn_point = point

func has_double_jump() -> bool:
	return state.has_ability(ABILITY_DOUBLE_JUMP)

func grant_double_jump() -> void:
	if state.grant_ability(ABILITY_DOUBLE_JUMP):
		double_jump_available = true

func snapshot() -> Dictionary:
	return {
		"room": runtime.current_room_id if runtime != null else "",
		"x": position.x,
		"y": position.y,
		"vx": velocity.x,
		"vy": velocity.y,
		"onFloor": is_on_floor(),
		"facing": facing,
		"health": health,
		"alive": alive,
		"doubleJumpUnlocked": has_double_jump(),
		"doubleJumpAvailable": double_jump_available,
	}

func sync_vitals() -> void:
	state.vitals = {"health": health, "alive": alive, "invulnerableRemaining": _invulnerable_timer, "respawnRemaining": maxf(0.0, _respawn_timer)}

func restore_vitals() -> void:
	if state.vitals.is_empty():
		health = config.max_health()
		alive = true
		_invulnerable_timer = 0.0
		_respawn_timer = 0.0
	else:
		health = int(state.vitals.health)
		alive = state.vitals.alive
		_invulnerable_timer = float(state.vitals.invulnerableRemaining)
		_respawn_timer = float(state.vitals.respawnRemaining)
	visible = alive
	sync_vitals()
