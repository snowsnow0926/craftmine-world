class_name MeleeAttack
extends Node

## Real melee attack: a sphere sweep in front of the camera, filtered by the
## arc and reach of the active EquipmentDefinition. Uses the same camera origin
## as the aim ray and the ranged attack.

signal hit_landed(target: Object, amount: float, point: Vector3)

@export var max_targets := 8

var camera_rig: CameraRig


func bind_world(world: BaseWorld) -> void:
	camera_rig = world.camera_rig()


func execute(definition: EquipmentDefinition) -> Dictionary:
	if camera_rig == null:
		return {"fired": false, "reason": "no-camera", "hits": [], "damage": 0.0}
	var origin := camera_rig.eye_position()
	var direction := camera_rig.aim_direction()
	var reach := definition.range_meters
	var half_arc := deg_to_rad(clampf(definition.melee_arc_degrees, 1.0, 360.0) * 0.5)

	var shape := SphereShape3D.new()
	shape.radius = maxf(0.25, reach * 0.75)
	var params := PhysicsShapeQueryParameters3D.new()
	params.shape = shape
	params.transform = Transform3D(Basis(), origin + direction * reach * 0.5)
	params.collision_mask = definition.hit_mask
	params.collide_with_bodies = true
	params.collide_with_areas = false
	params.exclude = _excluded()

	var candidates: Array = camera_rig.camera.get_world_3d().direct_space_state.intersect_shape(params, max_targets * 4)
	var hits := []
	var total_damage := 0.0
	var seen := {}
	var considered := []
	for candidate in candidates:
		var collider = candidate.get("collider")
		if collider == null or seen.has(collider):
			continue
		seen[collider] = true
		if not collider is Node3D:
			continue
		var point: Vector3 = _aim_point(collider)
		var to_target := point - origin
		var distance := to_target.length()
		var angle := direction.angle_to(to_target.normalized()) if distance > 0.001 else 0.0
		considered.append({"collider": collider.name, "distance": distance, "angle": angle})
		if distance > reach + 0.5:
			continue
		if distance > 0.001 and angle > half_arc:
			continue
		var applied := _apply_damage(collider, definition.damage, point, direction)
		total_damage += applied
		hits.append({"collider": collider.name, "point": [point.x, point.y, point.z], "damage": applied})
		if applied > 0.0:
			hit_landed.emit(collider, applied, point)
		if hits.size() >= max_targets:
			break
	return {
		"fired": true,
		"reason": "",
		"hits": hits,
		"damage": total_damage,
		"hit": not hits.is_empty(),
		"candidateCount": candidates.size(),
		"considered": considered,
		"reach": reach,
		"arcDegrees": definition.melee_arc_degrees,
	}


## Direction is measured towards the body of the target, not towards its scene
## origin, which for a standing character sits on the floor.
func _aim_point(collider: Node3D) -> Vector3:
	for child in collider.get_children():
		if child is CollisionShape3D:
			return child.global_position
	return collider.global_position


func _apply_damage(collider: Object, damage: float, point: Vector3, direction: Vector3) -> float:
	if not collider.has_method("apply_damage"):
		return 0.0
	var result = collider.apply_damage(damage, {"point": point, "direction": direction, "source": self})
	if result is Dictionary:
		return float(result.get("applied", damage))
	return damage


func _excluded() -> Array[RID]:
	var bodies: Array[RID] = []
	var node: Node = self
	while node != null:
		if node is CollisionObject3D:
			bodies.append(node.get_rid())
			break
		node = node.get_parent()
	return bodies
