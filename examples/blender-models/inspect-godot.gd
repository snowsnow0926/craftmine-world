extends SceneTree

# Read-only verification of the generated data-format asset in the shipped engine.
func _initialize() -> void:
	call_deferred("inspect")

func inspect() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 1:
		quit(2)
		return
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	var error := document.append_from_file(args[0], state)
	if error != OK:
		print("MODEL_INSPECTION_ERROR=" + str(error))
		quit(1)
		return
	var model := document.generate_scene(state) as Node3D
	if model == null:
		quit(1)
		return
	root.add_child(model)
	var meshes := model.find_children("*", "MeshInstance3D", true, false)
	var surfaces := 0
	var vertices := 0
	var triangles := 0
	var material_ids := {}
	var normal_materials := {}
	var bound := AABB()
	var first := true
	for item in meshes:
		var mesh := item as MeshInstance3D
		var transformed := mesh.global_transform * mesh.get_aabb()
		bound = transformed if first else bound.merge(transformed)
		first = false
		for index in mesh.mesh.get_surface_count():
			surfaces += 1
			var arrays := mesh.mesh.surface_get_arrays(index)
			vertices += arrays[Mesh.ARRAY_VERTEX].size()
			var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
			triangles += indices.size() / 3 if not indices.is_empty() else arrays[Mesh.ARRAY_VERTEX].size() / 3
			var material := mesh.get_active_material(index)
			if material != null:
				material_ids[material.get_instance_id()] = true
				if material is BaseMaterial3D and material.normal_enabled and material.normal_texture != null:
					normal_materials[material.get_instance_id()] = true
	var report := {"headless": DisplayServer.get_name() == "headless", "meshes": meshes.size(),
		"surfaces": surfaces, "vertices": vertices, "triangles": triangles,
		"materials": material_ids.size(), "materialsWithNormalMap": normal_materials.size(),
		"boundsSize": [bound.size.x, bound.size.y, bound.size.z],
		"scope": "actual Godot GLB data import; no gameplay or visual-quality claim"}
	print("CRAFTMINE_MODEL_INSPECTION=" + JSON.stringify(report))
	quit(0 if meshes.size() > 0 and triangles > 0 else 1)
