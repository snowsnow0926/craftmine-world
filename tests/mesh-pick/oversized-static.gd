extends SceneTree
const Picker = preload("res://craftmine_shared/scene_mesh_picker_v2.gd")
var failures := []
var checks := 0
func check(value: bool, label: String) -> void:
	checks += 1
	if not value: failures.append(label)
func _initialize() -> void:
	call_deferred("run")
func run() -> void:
	var world := Node3D.new()
	root.add_child(world)
	current_scene = world
	var camera := Camera3D.new()
	world.add_child(camera)
	camera.current = true
	var mesh := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-1,-1,0),Vector3(1,-1,0),Vector3(0,1,0)])
	var indices := PackedInt32Array()
	for i in 4097: indices.append_array(PackedInt32Array([0,2,1]))
	arrays[Mesh.ARRAY_INDEX] = indices
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var large := MeshInstance3D.new()
	large.mesh = mesh
	large.position = Vector3(10,0,-3)
	world.add_child(large)
	var cube := MeshInstance3D.new()
	cube.mesh = BoxMesh.new()
	cube.position = Vector3(0,0,-5)
	world.add_child(cube)
	await process_frame
	var picker := Picker.new()
	var away: Dictionary = picker.pick(world,camera,[])
	check(away.status=="hit" and away.get("node")==cube,"off-ray oversized static mesh permits exact target")
	check(away.counts.facesRead==1,"oversized mesh allocates no arrays")
	large.position.x = 0
	var near: Dictionary = picker.pick(world,camera,[])
	check(near.status=="fallback" and near.reason=="mesh-triangle-budget","nearer oversized mesh remains uncertainty blocker")
	large.position.z = -10
	var behind: Dictionary = picker.pick(world,camera,[])
	check(behind.status=="hit" and behind.get("node")==cube,"oversized mesh behind exact hit does not block")
	large.position = Vector3(10,0,-3)
	large.custom_aabb = AABB(Vector3(-1,-1,-1),Vector3.ONE*2)
	check(picker.pick(world,camera,[]).reason=="custom-array-bounds","overridden bounds remain globally untrusted")
	large.custom_aabb = AABB()
	var shader := Shader.new()
	shader.code = "shader_type spatial; void vertex(){VERTEX.x += 100.0;}"
	var material := ShaderMaterial.new()
	material.shader = shader
	large.material_override = material
	check(picker.pick(world,camera,[]).status=="fallback","shader displacement remains unbounded despite exceeded budget")
	large.material_override = null
	# A later surface must still be inspected after the first exceeds the budget.
	var second := []
	second.resize(Mesh.ARRAY_MAX)
	second[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-1,-1,0),Vector3(1,-1,0),Vector3(0,1,0)])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,second)
	mesh.surface_set_material(1,material)
	check(picker.pick(world,camera,[]).status=="fallback","later unbounded material cannot hide behind budget early return")
	print("OVERSIZED_STATIC_RESULT="+JSON.stringify({"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
