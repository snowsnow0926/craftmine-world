extends SceneTree
const Picker = preload("res://scene_mesh_picker.gd")
var world: Node3D
var camera: Camera3D
var failures := []
var checks := 0
var imported := []
func _initialize() -> void:
	run.call_deferred()
func check(value: bool, message: String) -> void:
	checks += 1
	if not value: failures.append(message)
func reset() -> void:
	for node in world.get_children():
		if node != camera: node.free()
	camera.position = Vector3.ZERO
	camera.rotation = Vector3.ZERO
func pick() -> Dictionary:
	return Picker.new().pick(world, camera, [])
func triangle(z := 0.0, x := 0.0) -> PackedVector3Array:
	return PackedVector3Array([Vector3(-1+x,-1,z),Vector3(x,1,z),Vector3(1+x,-1,z)])
func surface(mesh: ArrayMesh, vertices: PackedVector3Array, indexed := false, cull := BaseMaterial3D.CULL_BACK, lods := {}) -> void:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	if indexed: arrays[Mesh.ARRAY_INDEX] = PackedInt32Array(range(vertices.size()))
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], lods)
	var material := StandardMaterial3D.new()
	material.cull_mode = cull
	mesh.surface_set_material(mesh.get_surface_count()-1, material)
func instance(mesh: Mesh, z := -3.0) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	world.add_child(node)
	node.position.z = z
	return node
func run() -> void:
	world = Node3D.new()
	root.add_child(world)
	camera = Camera3D.new()
	world.add_child(camera)
	camera.current = true
	await process_frame
	var mesh := ArrayMesh.new()
	surface(mesh, triangle(), true)
	var near := instance(mesh)
	var hit := pick()
	check(hit.status == "hit" and hit.node == near, "indexed ArrayMesh uses actual triangle")
	check(absf(hit.position.z+3) < 0.0001 and hit.normal.z > 0.99, "array surface point and transformed normal are real")
	check(hit.counts.facesRead == 1 and hit.counts.triangles == 1, "surface reads and triangle accounting are bounded")
	mesh.custom_aabb = AABB(Vector3(50,50,50), Vector3.ONE)
	check(pick().reason == "custom-array-culling-bounds" and pick().counts.facesRead == 0, "authored culling bounds cannot claim invisible or hidden geometry")
	mesh.custom_aabb = AABB()
	near.custom_aabb = AABB(Vector3(50,50,50), Vector3.ONE)
	check(pick().reason == "custom-array-culling-bounds", "instance culling override is equally unsupported")
	near.custom_aabb = AABB()
	near.scale = Vector3(2,0.5,1)
	check(pick().node == near, "positive nonuniform transform remains supported")
	near.scale.x = -2
	check(pick().reason == "negative-scale", "negative winding remains unsupported")
	reset()
	mesh = ArrayMesh.new()
	surface(mesh, triangle(0, 2))
	surface(mesh, triangle(0,-2))
	near = instance(mesh)
	var far := instance(BoxMesh.new(),-6)
	check(pick().node == far, "ray through multi-surface hole selects actual farther mesh, not AABB")
	reset()
	mesh = ArrayMesh.new()
	surface(mesh, triangle(), false, BaseMaterial3D.CULL_FRONT)
	surface(mesh, triangle(-1), true, BaseMaterial3D.CULL_BACK)
	near = instance(mesh)
	hit = pick()
	check(hit.status == "hit" and hit.surfaceIndex == 1 and absf(hit.position.z+4)<0.0001, "each surface honors its own material culling")
	var override_material := StandardMaterial3D.new()
	near.set_surface_override_material(0,override_material)
	check(pick().surfaceIndex == 0, "surface override precedes mesh material")
	override_material.cull_mode = BaseMaterial3D.CULL_FRONT
	near.material_override = override_material
	check(pick().status == "none", "whole-instance material overrides every surface")
	near.material_override = null
	near.set_surface_override_material(0,null)
	(mesh.surface_get_material(1) as StandardMaterial3D).transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	hit = pick()
	check(hit.status == "fallback" and hit.counts.facesRead == 0, "transparent secondary surface refuses before array copies")
	(mesh.surface_get_material(1) as StandardMaterial3D).transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
	near.material_overlay = StandardMaterial3D.new()
	check(pick().reason == "material-overlay", "material overlay remains untrusted")
	near.material_overlay = null
	near.material_override = ShaderMaterial.new()
	check(pick().reason == "custom-material", "custom shader remains unsupported")
	near.material_override = null
	near.skin = Skin.new()
	check(pick().reason == "skinned-or-blend-shape-mesh", "skinned array refuses bind-pose selection")
	reset()
	mesh = ArrayMesh.new()
	var lod_vertices := triangle()
	lod_vertices.append_array(triangle(-1))
	surface(mesh,lod_vertices,true,BaseMaterial3D.CULL_BACK,{5.0:PackedInt32Array([0,1,2])})
	instance(mesh)
	hit = pick()
	check(hit.status == "fallback" and hit.reason == "array-mesh-lod" and hit.counts.facesRead == 0, "native LOD metadata refuses before face decode")
	reset()
	mesh = ArrayMesh.new()
	for index in 9: surface(mesh,triangle(-index))
	instance(mesh)
	check(pick().reason == "surface-budget" and pick().counts.facesRead == 0, "surface budget is checked before face copies")
	reset()
	mesh = ArrayMesh.new()
	var large := PackedVector3Array()
	for index in 4097: large.append_array(triangle())
	surface(mesh,large)
	instance(mesh)
	check(pick().reason == "mesh-triangle-or-vertex-budget" and pick().counts.facesRead == 0, "large native mesh metadata rejects before face copies")
	reset()
	mesh = ArrayMesh.new()
	large.resize(12289)
	var sparse_arrays := []
	sparse_arrays.resize(Mesh.ARRAY_MAX)
	sparse_arrays[Mesh.ARRAY_VERTEX] = large
	sparse_arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0,1,2])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,sparse_arrays)
	instance(mesh)
	check(pick().reason == "mesh-triangle-or-vertex-budget" and pick().counts.facesRead == 0, "unused indexed vertices cannot evade allocation preflight")
	reset()
	mesh = ArrayMesh.new()
	large.resize(0)
	for index in 4096: large.append_array(triangle())
	surface(mesh,large)
	for index in 5: instance(mesh,-3-index)
	check(pick().reason == "triangle-or-vertex-budget" and pick().counts.facesRead == 0, "global array budget precedes all face copies")
	reset()
	mesh = ArrayMesh.new()
	surface(mesh,triangle())
	instance(mesh)
	world.add_child(AnimationPlayer.new())
	check(pick().reason == "animation-or-skeleton" and pick().counts.facesRead == 0, "declared animation mixer does not masquerade as static geometry")
	reset()
	mesh = ArrayMesh.new()
	surface(mesh,triangle())
	near = instance(mesh)
	var script := GDScript.new()
	script.source_code = "extends ArrayMesh\nvar calls := 0\nfunc _surface_get_arrays(_index: int) -> Array:\n calls += 1\n return []\n"
	check(script.reload() == OK, "scripted array fixture compiles")
	mesh.set_script(script)
	check(pick().reason == "scripted-mesh-resource" and mesh.get("calls") == 0, "scripted array virtual methods are never invoked")
	reset()
	if FileAccess.file_exists("res://models/nature/tree_oak.glb"):
		for file in ["nature/tree_oak.glb", "nature/rock_smallA.glb", "castle/wall-doorway.glb"]:
			reset()
			var scene := load("res://models/"+file).instantiate() as Node3D
			world.add_child(scene)
			var nodes := [scene]
			var meshes: Array[MeshInstance3D] = []
			var bounds: AABB
			var first := true
			while not nodes.is_empty():
				var node: Node = nodes.pop_back()
				nodes.append_array(node.get_children())
				if node is MeshInstance3D:
					meshes.append(node)
					var box: AABB = node.global_transform * node.mesh.get_aabb()
					bounds = box if first else bounds.merge(box)
					first = false
			var result := {}
			for factor in [0.25,0.5,0.75]:
				var point := bounds.get_center()
				point.y = bounds.position.y+bounds.size.y*factor
				camera.position = point+Vector3(0,0,maxf(4,bounds.size.z+2))
				camera.look_at(point)
				result = pick()
				if result.status != "none": break
			if file.begins_with("castle/"):
				check(result.status == "fallback" and result.reason == "array-mesh-lod", "default GLB import with auto LOD is explicitly rejected")
			else:
				check(result.status == "hit" and meshes.has(result.get("node")), "actual imported "+file+" is selectable")
			imported.append({"file":file,"status":result.status,"reason":result.reason,"counts":result.counts})
	print("ARRAYMESH_PICK_RESULT="+JSON.stringify({"checks":checks,"failures":failures,"imported":imported,"headless":true,"pixelAccurate":false}))
	quit(0 if failures.is_empty() else 1)
