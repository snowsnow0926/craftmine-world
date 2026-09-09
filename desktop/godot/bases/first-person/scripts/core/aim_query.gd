class_name AimQuery
extends Node

## Continuous pointing interaction. Every physics frame a real ray is cast from
## the camera through the screen centre; the hit drives the HUD prompt, the
## target highlight and the interact action. The ranged attack reads the same
## origin and direction so what you see is what you shoot.

signal aim_changed(collider: Object, point: Vector3, interactable: bool)

@export var collision_mask: int = 7  # world | damageable | interactable
@export var max_distance := 60.0
@export var interaction_distance := 3.5
@export var probe_interval_frames := 1

var camera_rig: CameraRig


## Called once by the world root after the whole scene is ready. Wiring in one
## place keeps the base working after a scene is copied or rearranged.
func bind_world(world: BaseWorld) -> void:
	camera_rig = world.camera_rig()
	if camera_rig == null:
		push_warning("AimQuery could not find the camera rig")

var collider: Object = null
var point := Vector3.ZERO
var normal := Vector3.ZERO
var has_hit := false
var _last_collider: Object = null
var _frame_counter := 0


func _physics_process(_delta: float) -> void:
	_frame_counter += 1
	if probe_interval_frames > 1 and _frame_counter % probe_interval_frames != 0:
		return
	probe()
	if collider != _last_collider:
		_last_collider = collider
		aim_changed.emit(collider, point, can_interact())


func probe() -> Dictionary:
	collider = null
	has_hit = false
	point = Vector3.ZERO
	normal = Vector3.ZERO
	if camera_rig == null:
		return {"hit": false}
	var origin := camera_rig.eye_position()
	var direction := camera_rig.aim_direction()
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * max_distance, collision_mask)
	query.exclude = _excluded_bodies()
	var space := camera_rig.camera.get_world_3d().direct_space_state
	var hit: Dictionary = space.intersect_ray(query)
	if hit.is_empty():
		return {"hit": false}
	has_hit = true
	collider = hit.get("collider")
	point = hit.get("position", origin)
	normal = hit.get("normal", Vector3.UP)
	return {"hit": true, "collider": collider, "position": point, "normal": normal}


func _excluded_bodies() -> Array[RID]:
	var bodies: Array[RID] = []
	var player := _player_body()
	if player != null:
		bodies.append(player.get_rid())
	return bodies


func _player_body() -> CollisionObject3D:
	var node: Node = self
	while node != null:
		if node is CollisionObject3D:
			return node
		node = node.get_parent()
	return null


## True when the current aim ray hits an interactable inside interaction range.
func can_interact() -> bool:
	if not has_hit or collider == null or not collider.has_method("interact"):
		return false
	if camera_rig == null:
		return false
	return camera_rig.eye_position().distance_to(point) <= interaction_distance


func prompt() -> String:
	if not can_interact():
		return ""
	if collider.has_method("interaction_prompt"):
		return str(collider.interaction_prompt())
	return "Interact"


## Calls the aimed interactable. Returns {"handled": false, "reason": ...} when
## there is nothing in range.
func interact() -> Dictionary:
	if not can_interact():
		return {"handled": false, "reason": "no-target"}
	if collider.has_method("can_interact") and not bool(collider.can_interact()):
		return {"handled": false, "reason": "refused"}
	return collider.interact()


func snapshot() -> Dictionary:
	return {
		"hit": has_hit,
		"collider": collider.name if collider != null else "",
		"position": [point.x, point.y, point.z],
		"interactable": can_interact(),
		"prompt": prompt(),
	}
