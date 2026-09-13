extends SceneTree

const Companion = preload("res://companion.gd")
const Model = preload("res://model.glb")
var checks: Array[String] = []
var failed := false
var stage: Node3D

func verify(condition: bool, label: String) -> void:
	if condition:
		checks.append(label)
	else:
		failed = true
		push_error(label)

func _initialize() -> void:
	_run.call_deferred()

func ticks(count: int) -> void:
	for tick in count:
		await physics_frame

func make_pet(identity: String, at: Vector3) -> CharacterBody3D:
	var pet := Companion.new()
	pet.entity_id = identity
	pet.pomeranian_visual = Model
	pet.position = at
	stage.add_child(pet)
	return pet

func meshes(node: Node) -> Array[MeshInstance3D]:
	var found: Array[MeshInstance3D] = []
	if node is MeshInstance3D:
		found.append(node)
	for child in node.get_children():
		found.append_array(meshes(child))
	return found

func colors(node: Node) -> Array:
	var result: Array = []
	for mesh in meshes(node):
		for surface in mesh.get_surface_override_material_count():
			var material := mesh.get_active_material(surface)
			if material is StandardMaterial3D:
				result.append(material.albedo_color)
	return result

func _run() -> void:
	stage = Node3D.new()
	root.add_child(stage)
	var player := Node3D.new()
	player.name = "Player"
	player.position = Vector3(0, 0, -3)
	stage.add_child(player)
	var camera_rig := Node3D.new()
	camera_rig.name = "CameraRig"
	player.add_child(camera_rig)
	var pitch := Node3D.new()
	pitch.name = "PitchPivot"
	camera_rig.add_child(pitch)
	var eye := Camera3D.new()
	eye.name = "Camera3D"
	eye.position.y = 1.2
	pitch.add_child(eye)
	var ground := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(30, 1, 30)
	shape.shape = box
	ground.position.y = -0.5
	ground.add_child(shape)
	stage.add_child(ground)
	var first := make_pet("pet-first", Vector3(-1.5, 0, 0))
	var second := make_pet("pet-second", Vector3(1.5, 0, 0))
	second.set_following(false)
	var original_visual := Model.instantiate()
	var original_colors := colors(original_visual)
	verify(first.configuration_error.is_empty() and second.configuration_error.is_empty(), "real accepted model and behavior initialize")
	verify(meshes(first).size() == 19, "accepted GLB has nineteen actual mesh parts")
	verify(colors(first) == original_colors and colors(second) == original_colors, "both instances retain accepted white materials")
	var bounds := AABB()
	var initialized := false
	for mesh in meshes(first):
		var local_box: AABB = first.global_transform.affine_inverse() * mesh.global_transform * mesh.get_aabb()
		bounds = bounds.merge(local_box) if initialized else local_box
		initialized = true
	verify(bounds.position.y >= -0.005 and bounds.end.y <= first.pomeranian_collision_height, "accepted visual fits vertical collision envelope")
	verify(maxf(absf(bounds.position.x), absf(bounds.end.x)) <= first.pomeranian_collision_radius and maxf(absf(bounds.position.z), absf(bounds.end.z)) <= first.pomeranian_collision_radius, "accepted visual fits horizontal collision envelope")
	var initial_first: Vector3 = first.position
	var initial_second: Vector3 = second.position
	await ticks(90)
	verify(first.position.distance_to(initial_first) > 0.5, "first pet follows a real scene player on the floor")
	verify(Vector2(second.position.x-initial_second.x, second.position.z-initial_second.z).length() < 0.001, "waiting second pet stays put while first follows")
	first.set_following(false)
	await ticks(30)
	var still: Vector3 = first.position
	await ticks(30)
	verify(first.position.distance_to(still) < 0.005, "wait stops first pet after deceleration")
	var result: Dictionary = first.interact(player)
	verify(result.interacted == true and result.interactionCount == 1, "nearby player pets first companion")
	verify(second.snapshot().interactionCount == 0, "second interaction count remains independent")
	var peer_state: Dictionary = second.snapshot()
	verify(first.set_appearance_key("pomeranian-cream").is_empty(), "first pet accepts explicit cream variant")
	verify(colors(first) != original_colors, "first instance materials visibly change color")
	verify(colors(second) == original_colors and colors(original_visual) == original_colors, "second instance and library packed scene materials stay unchanged")
	first.set_companion_name("Cream Mochi")
	var saved: Dictionary = first.snapshot()
	verify(first.validate_state(saved).is_empty(), "first snapshot validates")
	verify(not second.validate_state(saved).is_empty(), "another instance cannot restore first identity")
	first.set_appearance_key("pomeranian-white")
	first.set_companion_name("Temporary")
	first.set_following(true)
	verify(first.restore(saved).is_empty() and first.snapshot() == saved, "restore preserves first name appearance wait state and pet count")
	verify(second.snapshot() == peer_state, "restoring first does not mutate second persistent state")
	await process_frame
	var reopened := Companion.new()
	reopened.entity_id = "pet-first"
	reopened.pomeranian_visual = Model
	stage.remove_child(first)
	first.queue_free()
	stage.add_child(reopened)
	verify(reopened.restore(saved).is_empty() and reopened.snapshot() == saved, "fresh component reopens serialized progress")
	original_visual.free()
	print("APPROVED_POMERANIAN_TEST=" + JSON.stringify({"ok": not failed, "headless": DisplayServer.get_name() == "headless", "checks": checks, "bounds": {"position": [bounds.position.x,bounds.position.y,bounds.position.z], "size": [bounds.size.x,bounds.size.y,bounds.size.z]}, "modelCalls": 0, "scope": "isolated native component fixture; not player acceptance"}))
	quit(1 if failed else 0)
