class_name RangedAttack
extends Node

## Real ray attack. Origin and direction come from the live camera rig, so the
## shot follows the actual view. Damage is read from the active
## EquipmentDefinition; nothing here hard-codes a weapon.

signal hit_landed(target: Object, amount: float, point: Vector3)

var camera_rig: CameraRig
var _shot_index := 0


func bind_world(world: BaseWorld) -> void:
	camera_rig = world.camera_rig()


func execute(definition: EquipmentDefinition) -> Dictionary:
	if camera_rig == null:
		return {"fired": false, "reason": "no-camera", "hits": [], "damage": 0.0}
	_shot_index += 1
	var rng := RandomNumberGenerator.new()
	rng.seed = 0x5EED0000 + _shot_index
	var origin := camera_rig.eye_position()
	var direction := camera_rig.aim_direction()
	var hits := []
	var total_damage := 0.0
	var space := camera_rig.camera.get_world_3d().direct_space_state
	for pellet in maxi(1, definition.pellets):
		var shot_direction := direction
		if definition.spread_degrees > 0.0:
			shot_direction = _spread(direction, definition.spread_degrees, rng)
		var query := PhysicsRayQueryParameters3D.create(origin, origin + shot_direction * definition.range_meters, definition.hit_mask)
		query.exclude = _excluded()
		var hit: Dictionary = space.intersect_ray(query)
		if hit.is_empty():
			continue
		var collider = hit.get("collider")
		var point: Vector3 = hit.get("position", origin)
		var applied := _apply_damage(collider, definition.damage, point, shot_direction)
		total_damage += applied
		hits.append({
			"collider": collider.name if collider != null else "",
			"point": [point.x, point.y, point.z],
			"damage": applied,
			"pellet": pellet,
		})
		if applied > 0.0:
			hit_landed.emit(collider, applied, point)
	return {"fired": true, "reason": "", "hits": hits, "damage": total_damage, "hit": not hits.is_empty()}


func _spread(direction: Vector3, degrees: float, rng: RandomNumberGenerator) -> Vector3:
	var basis := Basis.looking_at(direction, Vector3.UP)
	var angle := deg_to_rad(degrees)
	return (basis * Vector3(tan(rng.randf_range(-angle, angle)), tan(rng.randf_range(-angle, angle)), -1.0)).normalized()


func _apply_damage(collider: Object, damage: float, point: Vector3, direction: Vector3) -> float:
	if collider == null or not collider.has_method("apply_damage"):
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
