extends SceneTree

const Pet = preload("res://pet_companion.gd")
var results: Array[Dictionary] = []
var failures := 0

func verify(ok: bool, label: String) -> void:
	if not ok:
		failures += 1
		push_error(label)

func _initialize() -> void:
	_run.call_deferred()

func nodes(root_node: Node, type_name: String) -> Array[Node]:
	var found: Array[Node] = []
	if root_node.is_class(type_name):
		found.append(root_node)
	for child in root_node.get_children():
		found.append_array(nodes(child, type_name))
	return found

func _run() -> void:
	var world := Node3D.new()
	root.add_child(world)
	for info in [[Vector3(40, 1, 40), Vector3(0, -0.5, 0)], [Vector3(10, 2, 0.4), Vector3(0, 1, 0)]]:
		var wall := StaticBody3D.new()
		wall.position = info[1]
		var collision := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = info[0]
		collision.shape = box
		wall.add_child(collision)
		world.add_child(wall)
	var player := Node3D.new()
	player.name = "Player"
	player.position = Vector3(0, 0.9, -4)
	world.add_child(player)
	for key in ["dog", "pomeranian-white"]:
		var pet := Pet.new()
		pet.entity_id = "real-" + key
		pet.appearance_key = key
		pet.position = Vector3(0, 0, 3)
		pet.dog_visual = load("res://visuals/dog.glb") as PackedScene
		pet.pomeranian_visual = load("res://visuals/pomeranian-white.glb") as PackedScene
		world.add_child(pet)
		for _tick in 200:
			await physics_frame
		pet.set_physics_process(false)
		var collision := pet.get_node("CollisionShape3D") as CollisionShape3D
		var pivot := pet.get_node("VisualPivot") as Node3D
		verify(pivot.transform == Transform3D.IDENTITY, "visual pivot remains identity")
		var animations := nodes(pivot, "AnimationPlayer")
		verify(animations.size() == 1, "real asset has one AnimationPlayer")
		var animation_player := animations[0] as AnimationPlayer
		animation_player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
		var meshes := nodes(pivot, "MeshInstance3D")
		var radius := 0.0
		var minimum_y := INF
		var maximum_y := -INF
		var wall_clearance := INF
		var sampled := 0
		for clip in ["idle", "walk"]:
			var animation := animation_player.get_animation(clip)
			verify(animation.loop_mode == Animation.LOOP_LINEAR, "real asset clip loops")
			animation_player.play(clip, 0.0)
			var times: Array[float] = [0.0, animation.length]
			for frame in range(1, int(ceil(animation.length * 240.0))):
				times.append(frame / 240.0)
			for track in animation.get_track_count():
				for key_index in animation.track_get_key_count(track):
					var time := animation.track_get_key_time(track, key_index)
					if time not in times:
						times.append(time)
					if key_index > 0:
						var middle := (time + animation.track_get_key_time(track, key_index - 1)) / 2.0
						if middle not in times:
							times.append(middle)
			for time in times:
				animation_player.seek(time, true)
				sampled += 1
				for mesh_node in meshes:
					var mesh := (mesh_node as MeshInstance3D).mesh
					for surface in mesh.get_surface_count():
						for vertex in mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]:
							var global: Vector3 = mesh_node.global_transform * vertex
							var local := pet.to_local(global)
							radius = maxf(radius, Vector2(local.x, local.z).length())
							minimum_y = minf(minimum_y, local.y)
							maximum_y = maxf(maximum_y, local.y)
							wall_clearance = minf(wall_clearance, global.z - 0.2)
		verify(radius <= collision.shape.radius and maximum_y <= collision.shape.height and minimum_y >= -0.00001, "real animation vertices fit actual cylinder")
		verify(wall_clearance >= -0.00001, "real visible animated mesh remains outside wall after actual follow")
		results.append({"appearanceKey": key, "meshCount": meshes.size(), "sampledPoses": sampled, "radius": radius, "minY": minimum_y, "maxY": maximum_y, "collisionRadius": collision.shape.radius, "collisionHeight": collision.shape.height, "wallClearance": wall_clearance, "rootPosition": [pet.position.x, pet.position.y, pet.position.z]})
		pet.free()
		await physics_frame
	print("PET_VISUAL_ENVELOPE_TEST=" + JSON.stringify({"results": results, "ok": failures == 0, "headless": DisplayServer.get_name() == "headless", "renderedScreenshot": false}))
	quit(0 if failures == 0 else 1)
