class_name CameraRig
extends Node3D

## First-person look rig: yaw on this node, pitch on the child pivot, and the
## camera at the eye height. The weapon mount is a child of the camera itself,
## so the held model is always expressed in real camera space.

signal look_changed(yaw: float, pitch: float)

@export var mouse_sensitivity_degrees := 0.12
@export var pitch_limit_degrees := 89.0
@export var invert_y := false

@onready var pitch_pivot: Node3D = $PitchPivot
@onready var camera: Camera3D = $PitchPivot/Camera3D
@onready var weapon_mount: Node3D = $PitchPivot/Camera3D/WeaponMount

var yaw := 0.0
var pitch := 0.0


func _ready() -> void:
	set_look(0.0, 0.0)


func set_look(new_yaw: float, new_pitch: float) -> void:
	var limit := deg_to_rad(pitch_limit_degrees)
	yaw = wrapf(new_yaw, -PI, PI)
	pitch = clampf(new_pitch, -limit, limit)
	rotation = Vector3(0.0, yaw, 0.0)
	pitch_pivot.rotation = Vector3(pitch, 0.0, 0.0)
	look_changed.emit(yaw, pitch)


func apply_mouse_motion(relative: Vector2) -> void:
	var vertical := relative.y if invert_y else -relative.y
	set_look(yaw - deg_to_rad(relative.x * mouse_sensitivity_degrees), pitch + deg_to_rad(vertical * mouse_sensitivity_degrees))


## Eye position in world space. Ranged shots and the aim ray start here.
func eye_position() -> Vector3:
	return camera.global_position


## Normalised aim direction in world space.
func aim_direction() -> Vector3:
	return -camera.global_transform.basis.z


func camera_basis() -> Basis:
	return camera.global_transform.basis
