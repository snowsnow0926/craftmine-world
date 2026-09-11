extends SceneTree
const Picker = preload("res://scene_mesh_picker.gd")
var world: Node3D
var player: Node3D
var camera: Camera3D
var failures := []
var checks := 0
var samples := []
func _initialize() -> void:
 run.call_deferred()
func check(value: bool, message: String) -> void:
 checks += 1
 if not value: failures.append(message)
func box(position: Vector3, size := Vector3.ONE, parent: Node3D = null, shared: BoxMesh = null) -> MeshInstance3D:
 var node := MeshInstance3D.new()
 var mesh := shared if shared != null else BoxMesh.new()
 if shared == null: mesh.size = size
 node.mesh = mesh
 node.material_override = StandardMaterial3D.new()
 (world if parent == null else parent).add_child(node)
 node.position = position
 return node
func reset() -> void:
 for node in world.get_children():
  if node != player: node.free()
func pick(extra: Array[Node] = [], physics: Dictionary = {}) -> Dictionary:
 var exclude: Array[Node] = [player]
 exclude.append_array(extra)
 return Picker.new().pick(world, camera, exclude, physics)
func run() -> void:
 world = Node3D.new()
 root.add_child(world)
 player = Node3D.new()
 world.add_child(player)
 camera = Camera3D.new()
 player.add_child(camera)
 camera.current = true
 await process_frame
 var near := box(Vector3(0,0,-3))
 var far := box(Vector3(0,0,-6))
 var hit := pick()
 check(hit.status == "hit" and hit.node == near, "nearest actual box triangles")
 check(absf(hit.position.z + 2.5) < 0.0001, "surface point is actual front plane")
 check(hit.normal.z > 0.99, "surface normal faces camera")
 var other_camera:=Camera3D.new()
 world.add_child(other_camera)
 other_camera.make_current()
 check(pick().status=="fallback" and pick().reason=="unsupported-or-inactive-camera","inactive camera never supplies selection ray")
 other_camera.free()
 camera.make_current()
 near.visible = false
 check(pick().node == far, "hidden mesh is excluded")
 near.visible = true
 near.layers = 2
 camera.cull_mask = 1
 check(pick().node == far, "camera mask excludes mesh")
 near.layers = 1
 check(pick([near]).node == far, "explicit helper instance exclusion")
 check(pick([near]).excludedObjectIds.has(str(near.get_instance_id())), "exclusions recorded")
 box(Vector3(0,0,-1),Vector3.ONE,player)
 check(pick().node == near, "player subtree excluded")
 reset()
 var parent := Node3D.new()
 world.add_child(parent)
 var torso := box(Vector3.ZERO,Vector3(0.34,0.3,0.7),parent)
 parent.position = Vector3(0,0,-3)
 parent.rotation.y = 0.5
 parent.scale = Vector3(2,1,0.5)
 check(pick().node == torso, "PET-style parent transform is current")
 parent.position.x = 3
 check(pick().status == "none", "parent animation invalidates previous hit without cached transforms")
 parent.position.x = 0
 parent.scale.x = -2
 check(pick().status == "fallback" and pick().reason == "negative-scale", "negative scale refuses unsupported winding")
 reset()
 var shared := BoxMesh.new()
 near = box(Vector3(0,0,-3),Vector3.ONE,null,shared)
 far = box(Vector3(0,0,-6),Vector3.ONE,null,shared)
 check(pick().objectId == str(near.get_instance_id()), "shared resource keeps instance identity")
 near.position.x = 3
 check(pick().objectId == str(far.get_instance_id()), "shared resource second instance selected")
 shared.size = Vector3(0.2,0.2,0.2)
 check(absf(pick().position.z + 5.9)<0.0001, "resource mutation is freshly read")
 reset()
 near=box(Vector3(0.6,-0.6,-3),Vector3(2,0.1,2))
 near.rotation.z=PI/4
 var bounds: AABB=near.global_transform*near.mesh.get_aabb()
 var coarse: Variant=bounds.intersects_segment(Vector3.ZERO,Vector3(0,0,-80))
 check(coarse != null and pick().status=="none","world AABB overlap alone never becomes a hit")
 reset()
 near=box(Vector3(0,0,-3),Vector3(2,2,0.001))
 check(pick().status=="hit","thin box uses actual triangles")
 (near.material_override as StandardMaterial3D).cull_mode=BaseMaterial3D.CULL_FRONT
 check(pick().position.z < -3,"front cull finds the later back-facing triangle")
 (near.material_override as StandardMaterial3D).transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
 far=box(Vector3(0,0,-6))
 check(pick().status=="fallback","transparent foreground cannot select behind")
 near.position.x=10
 check(pick().node==far,"off-ray transparent bounds do not block")
 near.material_override=ShaderMaterial.new()
 check(pick().status=="fallback","arbitrary shader displacement has unknown coverage")
 reset()
 near=box(Vector3(0,0,-3))
 near.skin=Skin.new()
 far=box(Vector3(0,0,-6))
 check(pick().status=="fallback","skin never uses bind-pose triangles")
 reset()
 near=box(Vector3(0,0,-3))
 var scripted:=GDScript.new()
 scripted.source_code="extends BoxMesh\nvar observed_calls := 0\nfunc _get_aabb() -> AABB:\n observed_calls += 1\n return AABB()\n"
 check(scripted.reload()==OK,"custom resource fixture compiles")
 near.mesh.set_script(scripted)
 var calls_before:int=near.mesh.get("observed_calls")
 hit=pick()
 check(hit.status=="fallback" and hit.reason=="scripted-mesh-resource" and near.mesh.get("observed_calls")==calls_before,"observer never invokes custom mesh virtual method")
 reset()
 near=box(Vector3(0,0,-5))
 var marker:=MeshInstance3D.new()
 marker.mesh=SphereMesh.new()
 (marker.mesh as SphereMesh).radius=0.045
 (marker.mesh as SphereMesh).height=0.09
 world.add_child(marker)
 marker.position=Vector3(0,0,-2)
 check(pick().status=="fallback","unsupported foreground sphere never falls through to box")
 check(pick([marker]).node==near,"explicit marker exclusion permits actual mesh behind helper")
 marker.position=Vector3(0,0,-8)
 check(pick().node==near,"unsupported geometry behind exact hit does not obscure it")
 reset()
 near=box(Vector3(0,0,-3))
 var array_mesh:=ArrayMesh.new()
 check(array_mesh.has_method("surface_get_array_len") and array_mesh.has_method("surface_get_array_index_len"),"fixed engine exposes ArrayMesh allocation-free length metadata for later extension")
 array_mesh.add_blend_shape("test-shape")
 near.mesh=array_mesh
 hit=pick()
 check(hit.status=="fallback" and hit.counts.facesRead==0,"ArrayMesh and blendshape coverage is explicit fallback without array copies")
 reset()
 var multi:=MultiMeshInstance3D.new()
 world.add_child(multi)
 check(pick().status=="fallback","MultiMesh never becomes aggregate-box selection")
 reset()
 near=box(Vector3(0,0,-3))
 var label:=Label3D.new()
 label.text="label"
 world.add_child(label)
 label.position=Vector3(4,3,-2)
 label.billboard=BaseMaterial3D.BILLBOARD_ENABLED
 await process_frame
 check(pick().status=="hit","off-ray native label does not globally block selection")
 var label_bounds:=AABB(-Vector3.ONE,Vector3.ONE*2)
 var radius:float=Picker.new()._label_radius(label_bounds,Basis.IDENTITY)
 check(absf(radius-sqrt(3.0))<0.00001,"orthogonal label bound has no needless sqrt3 scale multiplier")
 var shear:=Basis(Vector3(1,0,0),Vector3(1,0.1,0),Vector3(0,0,1))
 var shear_radius:float=Picker.new()._label_radius(label_bounds,shear)
 var bounded:=true
 for x in [-1,1]:
  for y in [-1,1]:
   for z in [-1,1]:
    if (shear*Vector3(x,y,z)).length()>shear_radius:bounded=false
 check(bounded and shear_radius>radius,"sheared label basis retains a conservative corner bound")
 reset()
 near=box(Vector3(0,0,-3))
 (near.mesh as BoxMesh).subdivide_width=2
 (near.mesh as BoxMesh).subdivide_height=3
 (near.mesh as BoxMesh).subdivide_depth=4
 hit=pick()
 check(hit.status=="hit" and hit.counts.triangles==4*(3*4+3*5+4*5),"preflight triangle formula matches real subdivided BoxMesh")
 reset()
 near=box(Vector3(0,0,-3))
 (near.mesh as BoxMesh).subdivide_width=10000
 hit=pick()
 check(hit.status=="fallback" and hit.counts.facesRead==0,"huge subdivisions refused before faces are copied")
 reset()
 for index in 10:
  var dense:=box(Vector3(0,0,-3-float(index)))
  (dense.mesh as BoxMesh).subdivide_width=11
  (dense.mesh as BoxMesh).subdivide_height=11
  (dense.mesh as BoxMesh).subdivide_depth=11
 hit=pick()
 check(hit.status=="fallback" and hit.reason=="triangle-budget" and hit.counts.facesRead==0,"total triangle budget precedes all face copies")
 reset()
 for index in 65: box(Vector3(0,0,-3-float(index)),Vector3.ONE)
 hit=pick()
 check(hit.status=="fallback" and hit.reason=="candidate-budget" and hit.counts.facesRead==0,"candidate budget rejects incomplete nearest search")
 reset()
 for index in 513: world.add_child(Node3D.new())
 hit=pick()
 check(hit.status=="fallback" and hit.reason=="node-budget" and hit.counts.facesRead==0,"node budget rejects partial traversal")
 reset()
 near=box(Vector3(0,0,-3))
 far=box(Vector3(0,0,-3))
 check(pick().status=="fallback" and pick().reason=="ambiguous-coincident-meshes","coincident instances are not arbitrarily selected")
 reset()
 near=box(Vector3(0,0,-5))
 var blocker:=StaticBody3D.new()
 var shape:=CollisionShape3D.new()
 var physical_box:=BoxShape3D.new()
 physical_box.size=Vector3.ONE
 shape.shape=physical_box
 blocker.add_child(shape)
 world.add_child(blocker)
 blocker.position=Vector3(0,0,-2)
 await physics_frame
 await physics_frame
 var query:=PhysicsRayQueryParameters3D.create(Vector3.ZERO,Vector3(0,0,-80))
 var physics_hit:=world.get_world_3d().direct_space_state.intersect_ray(query)
 check(not physics_hit.is_empty(),"real physics collider is observed")
 check(pick([],physics_hit).status=="blocked","nearer actual physics blocks mesh selection")
 near.position=blocker.position
 check(pick([],physics_hit).status=="blocked","tied actual physics keeps existing target priority")
 near.position=Vector3(0,0,-1)
 check(pick([],physics_hit).status=="hit","only a strictly closer mesh replaces physics target")
 reset()
 for index in 20: box(Vector3(0,0,-3-float(index)),Vector3(0.34,0.3,0.7))
 var started:=Time.get_ticks_usec()
 var first:=pick()
 var cold_us:=Time.get_ticks_usec()-started
 started=Time.get_ticks_usec()
 for iteration in 50: pick()
 var average_us:float=float(Time.get_ticks_usec()-started)/50.0
 check(first.status=="hit" and first.counts.facesRead==20,"twenty independent primitive instances remain bounded")
 print("MESH_PICK_RESULT="+JSON.stringify({"failures":failures,"checks":checks,"pixelAccurate":false,"cache":"none","headless":true,"twentyMeshTiming":{"coldMicroseconds":cold_us,"averageMicroseconds":average_us},"twentyMeshCounts":first.counts}))
 quit(0 if failures.is_empty() else 1)
