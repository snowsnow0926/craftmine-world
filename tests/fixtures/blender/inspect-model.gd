extends SceneTree

# Loads the actual generated GLB using Godot's runtime importer. No UI or input.
func _initialize() -> void:
	call_deferred("inspect_model")

func inspect_model() -> void:
	var editor_import := "--editor-import" in OS.get_cmdline_user_args()
	var model: Node3D
	if editor_import:
		var packed := load("res://model.glb") as PackedScene
		assert(packed != null)
		model = packed.instantiate() as Node3D
	else:
		var document := GLTFDocument.new()
		var state := GLTFState.new()
		assert(document.append_from_file("res://model.glb", state) == OK)
		model = document.generate_scene(state) as Node3D
	assert(model != null)
	root.add_child(model)
	var meshes := model.find_children("*", "MeshInstance3D", true, false)
	assert(meshes.size() >= 9, "House meshes were lost during export/import")
	var vertices := 0
	var has_blue_paint := false
	for item in meshes:
		var mesh := item as MeshInstance3D
		for surface in mesh.mesh.get_surface_count():
			vertices += mesh.mesh.surface_get_array_len(surface)
			var material := mesh.get_active_material(surface) as BaseMaterial3D
			if material and material.albedo_color.b > material.albedo_color.r * 2.0:
				has_blue_paint = true
		if mesh.name != "Door":
			mesh.create_trimesh_collision()
	var door := model.find_child("Door", true, false) as Node3D
	assert(door != null, "Door hierarchy was lost")
	var players := model.find_children("*", "AnimationPlayer", true, false)
	var animations: Array[String] = []
	var door_moved := false
	for item in players:
		var player := item as AnimationPlayer
		for animation in player.get_animation_list():
			animations.append(animation)
			if "DoorOpen" in animation:
				player.play(animation)
				player.seek(0.0, true)
				var before := door.transform.basis
				player.seek(player.get_animation(animation).length, true)
				door_moved = not before.is_equal_approx(door.transform.basis)
	assert(door_moved, "The exported door animation did not move its pivot")
	await physics_frame
	await physics_frame
	var query := PhysicsRayQueryParameters3D.create(Vector3(0, 6, 0), Vector3(0, -1, 0))
	var collision := model.get_world_3d().direct_space_state.intersect_ray(query)
	assert(not collision.is_empty(), "Imported geometry did not support Godot collision")
	print("CRAFTMINE_BLENDER_INTEGRATION=" + JSON.stringify({
		"headless": DisplayServer.get_name() == "headless",
		"meshes": meshes.size(), "vertices": vertices, "animations": animations,
		"doorMoved": door_moved, "collision": not collision.is_empty(),
		"hasBluePaint": has_blue_paint,
		"editorImport": editor_import,
		"scope": "authored-fixture-runtime-import-and-physics-not-player-quality"
	}))
	quit(0)
