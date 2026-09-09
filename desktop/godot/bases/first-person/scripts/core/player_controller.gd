class_name PlayerController
extends CharacterBody3D

## Real first-person movement: a CharacterBody3D with gravity, acceleration,
## jumping and slide collision against the scene. There is no teleport path in
## normal play; even the scripted acceptance walk moves through this controller.

signal capture_changed(captured: bool)

@export var move_speed := 4.5
@export var sprint_multiplier := 1.7
@export var jump_velocity := 4.2
@export var acceleration := 14.0
@export var air_acceleration := 3.0
@export var gravity_scale := 1.0
@export var max_fall_speed := 30.0
## A real click captures the mouse. Automated runs never click, so they never
## request pointer lock.
@export var capture_mouse_on_click := true
@export var input_enabled := true

@onready var camera_rig: CameraRig = get_node_or_null("CameraRig")

var captured := false
var _gravity := 9.8
var _override_axis := Vector2.ZERO
var _override_remaining := 0


func _ready() -> void:
	_gravity = float(ProjectSettings.get_setting("physics/3d/default_gravity", 9.8))
	if camera_rig == null:
		push_warning("PlayerController has no CameraRig child")


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed and not captured:
		if capture_mouse_on_click and input_enabled and DisplayServer.get_name() != "headless":
			set_captured(true)
	if event is InputEventMouseMotion and captured and camera_rig != null:
		camera_rig.apply_mouse_motion(event.relative)
	elif event.is_action_pressed("ui_cancel") and captured:
		set_captured(false)


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y = maxf(velocity.y - _gravity * gravity_scale * delta, -max_fall_speed)
	elif velocity.y < 0.0:
		velocity.y = -0.1

	var axis := _read_move_axis()
	var wish := movement_direction(axis)
	if is_on_floor() and _override_remaining <= 0 and input_enabled and Input.is_action_pressed("jump"):
		velocity.y = jump_velocity

	var speed := move_speed
	if is_on_floor() and _override_remaining <= 0 and input_enabled and Input.is_action_pressed("move_forward"):
		speed *= sprint_multiplier
	var target := wish * speed
	var rate := acceleration if is_on_floor() else air_acceleration
	velocity.x = move_toward(velocity.x, target.x, rate * delta)
	velocity.z = move_toward(velocity.z, target.z, rate * delta)
	move_and_slide()


## Movement axis for this physics frame. A scripted override wins, otherwise the
## real key actions are read, so scripted acceptance exercises the same movement
## and collision code as a player.
func _read_move_axis() -> Vector2:
	if _override_remaining > 0:
		_override_remaining -= 1
		return _override_axis
	if not input_enabled:
		return Vector2.ZERO
	return Input.get_vector("move_left", "move_right", "move_forward", "move_back")


## Converts a movement axis into a world-space direction relative to the camera.
func movement_direction(axis: Vector2) -> Vector3:
	var basis := camera_rig.camera_basis() if camera_rig != null else global_transform.basis
	var forward := -basis.z
	forward.y = 0.0
	forward = forward.normalized() if forward.length() > 0.001 else Vector3.FORWARD
	var right := basis.x
	right.y = 0.0
	right = right.normalized() if right.length() > 0.001 else Vector3.RIGHT
	var wish := right * axis.x + forward * -axis.y
	return wish.normalized() if wish.length() > 1.0 else wish


## Feeds a movement axis through the real controller for a number of physics
## frames. Used by scripted acceptance; it still accelerates and collides.
func walk(axis: Vector2, frames: int) -> void:
	_override_axis = axis
	_override_remaining = maxi(0, frames)
	while _override_remaining > 0:
		await get_tree().physics_frame
	_override_axis = Vector2.ZERO


func set_captured(value: bool) -> void:
	if captured == value:
		return
	captured = value
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if captured else Input.MOUSE_MODE_VISIBLE
	capture_changed.emit(captured)


func set_look(yaw: float, pitch: float) -> void:
	if camera_rig != null:
		camera_rig.set_look(yaw, pitch)


func look() -> Dictionary:
	if camera_rig == null:
		return {"yaw": 0.0, "pitch": 0.0}
	return {"yaw": camera_rig.yaw, "pitch": camera_rig.pitch}


func snapshot() -> Dictionary:
	return {
		"position": [global_position.x, global_position.y, global_position.z],
		"yaw": camera_rig.yaw if camera_rig != null else 0.0,
		"pitch": camera_rig.pitch if camera_rig != null else 0.0,
		"onFloor": is_on_floor(),
	}


## Returns "" on success, otherwise why the player state was rejected.
func restore(data: Dictionary) -> String:
	var position = data.get("position")
	if not (position is Array) or position.size() != 3:
		return "Player position must be a three element array"
	for value in position:
		if not (value is float or value is int) or not is_finite(float(value)):
			return "Player position contains a non-finite value"
	var yaw = data.get("yaw")
	var pitch = data.get("pitch")
	if not (yaw is float or yaw is int) or not is_finite(float(yaw)) or absf(float(yaw)) > PI + 0.001:
		return "Player yaw is invalid"
	if not (pitch is float or pitch is int) or not is_finite(float(pitch)) or absf(float(pitch)) > PI:
		return "Player pitch is invalid"
	global_position = Vector3(float(position[0]), float(position[1]), float(position[2]))
	velocity = Vector3.ZERO
	set_look(float(yaw), float(pitch))
	return ""
