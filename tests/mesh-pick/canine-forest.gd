extends SceneTree
const Picker = preload("res://scene_mesh_picker.gd")
func _initialize(): call_deferred("run")
func run():
 var world := Node3D.new()
 root.add_child(world)
 current_scene = world
 var camera := Camera3D.new()
 world.add_child(camera)
 camera.current = true
 var forest = load("res://addons/cw.scene.forest-gateway/scenes/forest_gateway.tscn").instantiate()
 world.add_child(forest)
 var floor := MeshInstance3D.new()
 var floor_mesh := BoxMesh.new()
 floor_mesh.size = Vector3(40,0.2,40)
 floor.mesh = floor_mesh
 floor.position.y = -0.1
 world.add_child(floor)
 var pets := []
 var index := 0
 for file in ["dog.glb","pomeranian-white.glb"]:
  var pet = load("res://"+file).instantiate()
  world.add_child(pet)
  pet.position = Vector3(-1.2 if index==0 else 1.2,0,8.5)
  var meshes = pet.find_children("*","MeshInstance3D",true,false)
  assert(meshes.size()==7,"Each canine must leave shared scene-picking budget")
  var triangles := 0
  for mesh in meshes:
   assert(mesh.skin == null and mesh.mesh is ArrayMesh and mesh.mesh.get_blend_shape_count()==0)
   triangles += mesh.mesh.get_faces().size()/3
  var animations = pet.find_children("*","AnimationPlayer",true,false)
  assert(animations.size()==1)
  var animation: AnimationPlayer = animations[0]
  animation.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
  pets.append({"root":pet,"animation":animation,"file":file,"triangles":triangles})
  index+=1
 await process_frame
 var picker := Picker.new()
 var exclusions: Array[Node] = []
 var samples := []
 for pet in pets:
  for clip in ["idle","walk"]:
   assert(pet.animation.has_animation(clip))
   pet.animation.play(clip)
   pet.animation.advance(0.2)
   var body: Node3D = pet.root.find_child("BodyPivot",true,false)
   assert(body != null)
   var meshes = body.find_children("*","MeshInstance3D",true,false)
   if body is MeshInstance3D: meshes.append(body)
   assert(not meshes.is_empty())
   var mesh: MeshInstance3D = meshes[0]
   var center: Vector3 = mesh.global_transform * mesh.mesh.get_aabb().get_center()
   camera.position = center + Vector3(0,0,3)
   camera.look_at(center)
   var time: float = pet.animation.current_animation_position
   var hit: Dictionary = picker.pick(world,camera,exclusions)
   assert(hit.status=="hit" and pet.root.is_ancestor_of(hit.node),"Actual canine surface must be selected: "+str(hit.get("reason")))
   assert(hit.counts.candidates>=62 and hit.counts.candidates<=63 and hit.counts.triangles>=9480 and hit.counts.triangles<=9492,"Forest plus two pets must remain inside unchanged shared budget")
   assert(pet.animation.current_animation_position==time)
   samples.append({"file":pet.file,"animation":clip,"node":str(pet.root.get_path_to(hit.node)),"counts":hit.counts})
 var tree: Node3D = forest.get_node("Trees/OakFrontLeft")
 camera.position = tree.position + Vector3(0,3,5)
 camera.look_at(tree.position + Vector3(0,3,0))
 var tree_hit: Dictionary = picker.pick(world,camera,exclusions)
 assert(tree_hit.status=="hit" and tree.is_ancestor_of(tree_hit.node),"Static forest must remain selected with both animated pets")
 print("CANINE_FOREST="+JSON.stringify({"passed":true,"samples":samples,"treeNode":str(forest.get_path_to(tree_hit.node)),"counts":tree_hit.counts,"headless":true,"inputUsed":false,"skinnedCoverage":false}))
 quit()
