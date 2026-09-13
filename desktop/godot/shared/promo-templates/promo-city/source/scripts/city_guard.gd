extends CharacterBody3D
var route: Array[Vector3] = []
var next_point: int = 1
var visual: Node3D
var visitor: CharacterBody3D
var phase: float = 0.0
var greeting: String = "力量与荣耀！沿主路穿过力量谷，登上大阶梯便是酋长大厅。"
func _ready() -> void:
	collision_layer = 0
	collision_mask = 1
	floor_snap_length = 0.45
	var col := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.32
	cap.height = 2.2
	col.shape = cap
	col.position.y = 1.1
	add_child(col)
func _physics_process(delta: float) -> void:
	phase += delta
	velocity.y -= 9.8 * delta
	var dir := Vector3.ZERO
	if route.size() > 1 and is_instance_valid(visitor) and global_position.distance_to(visitor.global_position) > 3.6:
		dir = route[next_point] - global_position
		dir.y = 0
		if dir.length() < 0.45:
			next_point = (next_point + 1) % route.size()
			dir = Vector3.ZERO
		else:
			dir = dir.normalized()
	velocity.x = dir.x * 1.45
	velocity.z = dir.z * 1.45
	move_and_slide()
	if dir.length_squared() > 0.1:
		rotation.y = lerp_angle(rotation.y, atan2(dir.x, dir.z), delta * 5.0)
		visual.position.y = absf(sin(phase * 5.5)) * 0.045
	elif is_instance_valid(visitor) and global_position.distance_to(visitor.global_position) < 5.0:
		var facing := visitor.global_position - global_position
		rotation.y = lerp_angle(rotation.y, atan2(facing.x, facing.z), delta * 3.0)
