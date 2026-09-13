extends SceneTree

var failures: Array[String] = []
var records: Array = []

func _initialize() -> void:
	call_deferred("_run")

func _require(value: bool, message: String) -> void:
	if not value: failures.append(message)

func _run() -> void:
	var inventory: Array = JSON.parse_string(FileAccess.get_file_as_string("res://fragments.json"))
	var world := Node3D.new()
	root.add_child(world)
	var ground := StaticBody3D.new()
	ground.name = "ExistingGround"
	var shape := BoxShape3D.new()
	shape.size = Vector3(180, 1, 180)
	var collider := CollisionShape3D.new()
	collider.shape = shape
	ground.add_child(collider)
	ground.position.y = -0.5
	world.add_child(ground)
	var existing := Node3D.new()
	existing.name = "ExistingPlayerContent"
	existing.position = Vector3(0, 0, -70)
	world.add_child(existing)
	for index in range(inventory.size()):
		var item: Dictionary = inventory[index]
		var z := float(index - 1) * 45.0
		var instances: Array = []
		for copy in range(2):
			var instance = load("res://addons/" + item.id + "/fragment.tscn").instantiate()
			instance.entity_id = "city-" + str(index) + "-" + str(copy)
			instance.position = Vector3(-35 if copy == 0 else 35, 0, z)
			world.add_child(instance)
			instances.append(instance)
		await physics_frame
		_require(instances[0].entity_id != instances[1].entity_id, item.id + ": independent identity")
		_require(instances[0].collision_triangles == int(item.geometry.collisionTriangles), item.id + ": collision triangle count")
		_require(instances[0].mesh_count == int(item.geometry.meshInstances), item.id + ": mesh count")
		var record := {"id": item.id, "instances": 2, "collisionTriangles": instances[0].collision_triangles, "meshInstances": instances[0].mesh_count}
		if item.slug == "ward-building":
			var openings: Array = []
			for angle in range(0, 360, 10):
				var direction := Vector3(cos(deg_to_rad(float(angle))), 0, sin(deg_to_rad(float(angle))))
				var from: Vector3 = instances[0].position + Vector3(0, 1.2, 0)
				var query := PhysicsRayQueryParameters3D.create(from, from + direction * 9.0, 1)
				if world.get_world_3d().direct_space_state.intersect_ray(query).is_empty(): openings.append(angle)
			record.openings = openings
		var route: Dictionary = item.route
		var start: Array = route.start
		var finish: Array = route.end
		var traversals: Array = []
		for instance in instances:
			var result: Dictionary = await _walk(world, instance.position + Vector3(start[0], 0.92, start[2]), instance.position + Vector3(finish[0], 0.92, finish[2]))
			traversals.append(result)
			_require(result.reached, item.id + ": authored route did not reach target: " + str(result))
		record.traversals = traversals
		if item.slug == "ward-street":
			var entrances: Array = []
			for instance in instances:
				for local_center in [Vector3(0, 0, 11), Vector3(-1, 0, -10)]:
					var center: Vector3 = instance.position + local_center
					var angles: Array = []
					for angle in range(0, 360, 10):
						var direction := Vector3(cos(deg_to_rad(float(angle))), 0, sin(deg_to_rad(float(angle))))
						var ray := PhysicsRayQueryParameters3D.create(center + Vector3(0, 1.2, 0), center + Vector3(0, 1.2, 0) + direction * 9.0, 1)
						if world.get_world_3d().direct_space_state.intersect_ray(ray).is_empty(): angles.append(angle)
					_require(not angles.is_empty(), "Street house has no open entrance")
					if not angles.is_empty():
						var angle := float(angles[int(angles.size() / 2)])
						var direction := Vector3(cos(deg_to_rad(angle)), 0, sin(deg_to_rad(angle)))
						var walked: Dictionary = await _walk(world, center + direction * 8.0 + Vector3(0, 0.92, 0), center + Vector3(0, 0.92, 0))
						entrances.append({"center": [local_center.x, local_center.z], "angles": angles, "walked": walked})
						_require(walked.reached, "Street house entrance collision blocks actor")
			record.houseEntrances = entrances
		records.append(record)
	_require(existing.position == Vector3(0, 0, -70) and ground.get_parent() == world, "Receiving world content changed")
	print("CITY_FRAGMENTS=" + JSON.stringify({"ok": failures.is_empty(), "records": records, "failures": failures, "existingContentPreserved": true}))
	world.queue_free()
	quit(0 if failures.is_empty() else 1)

func _walk(world: Node3D, start: Vector3, target: Vector3) -> Dictionary:
	var actor := CharacterBody3D.new()
	actor.collision_layer = 8
	actor.collision_mask = 1
	actor.floor_snap_length = 0.4
	var shape := CapsuleShape3D.new()
	shape.radius = 0.3
	shape.height = 1.8
	var collision := CollisionShape3D.new()
	collision.shape = shape
	actor.add_child(collision)
	actor.position = start
	world.add_child(actor)
	var min_y := start.y
	var steps := 0
	for index in range(1600):
		await physics_frame
		var delta := target - actor.position
		delta.y = 0
		if delta.length() < 0.22: break
		var direction := delta.normalized()
		actor.velocity = Vector3(direction.x * 5.0, actor.velocity.y - 18.0 / 60.0, direction.z * 5.0)
		actor.move_and_slide()
		min_y = minf(min_y, actor.position.y)
		steps += 1
	var distance := Vector2(actor.position.x - target.x, actor.position.z - target.z).length()
	var result := {"reached": distance < 0.22, "distance": distance, "steps": steps, "minimumY": min_y, "end": [actor.position.x, actor.position.y, actor.position.z]}
	actor.queue_free()
	await physics_frame
	return result
