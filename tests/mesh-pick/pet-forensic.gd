extends SceneTree
const Picker=preload("res://forensic_mesh_picker.gd")
var failures:=[]
var observations:=[]
var scope:Dictionary
var bridge:Node
func _initialize() -> void:
 run.call_deferred()
func send(op:String,args:Dictionary={}) -> Dictionary:
 var request:=scope.duplicate()
 request.op=op
 request.args=args
 return await bridge.handle_request(request)
func run() -> void:
 change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
 bridge=root.get_node("CraftmineRuntime")
 for frame in 300:
  await process_frame
  if bridge.initialized: break
 if not bridge.initialized:
  print("PET_MESH_FORENSIC="+JSON.stringify({"failures":["runtime not initialized"],"bodyHits":0}))
  quit(1);return
 scope={"worldId":ProjectSettings.get_setting("craftmine/runtime/world_id"),"buildId":"forensic-mesh-copy","instanceId":"__INSTANCE__"}
 await send("load")
 await send("resume")
 await send("wait",{"frames":120})
 var world:=current_scene as Node3D
 var dog:=world.get_node_or_null("PetDog") as Node3D
 if dog==null: failures.append("PetDog missing")
 var camera:=world.get_viewport().get_camera_3d()
 var player:=world.get_node("Player") as Node3D
 var excludes:Array[Node]=[player]
 for name in ["marker","selection_box"]:
  var node:Variant=world.get(name)
  if node is MeshInstance3D and world.is_ancestor_of(node): excludes.append(node)
 var body_hits:=0
 var angles:Array[Vector2]=[Vector2(-1.2,-0.55),Vector2(-1.0,-0.4),Vector2(-1.4,-0.65),Vector2(-1.1,-0.7)]
 if dog!=null:
  var torso:=dog.get_node_or_null("BodyRoot/Torso") as Node3D
  if torso!=null:
   var direction:Vector3=(torso.global_position-camera.global_position).normalized()
   angles.append(Vector2(atan2(-direction.x,-direction.z),asin(direction.y)))
 for angle in angles:
  var look:=await send("look",{"yaw":angle.x,"pitch":angle.y})
  if look.has("error"): failures.append(str(look.error));continue
  camera=world.get_viewport().get_camera_3d()
  var center:=camera.get_viewport().get_visible_rect().size*0.5
  var origin:=camera.project_ray_origin(center)
  var direction:=camera.project_ray_normal(center)
  var query:=PhysicsRayQueryParameters3D.create(origin,origin+direction*80,4294967295)
  var rids:Array[RID]=[]
  if player is CollisionObject3D:rids.append(player.get_rid())
  for child in player.find_children("*","CollisionObject3D",true,false):rids.append(child.get_rid())
  query.exclude=rids
  query.collide_with_areas=true
  var hit:=camera.get_world_3d().direct_space_state.intersect_ray(query)
  var selected:=Picker.new().pick(world,camera,excludes,hit)
  var node:Node=selected.get("node")
  var is_body:bool=node!=null and dog!=null and dog.is_ancestor_of(node)
  if is_body:body_hits+=1
  observations.append({"yaw":angle.x,"pitch":angle.y,"status":selected.status,"reason":selected.reason,"nodePath":str(world.get_path_to(node)) if node!=null else "","petAncestor":is_body,"counts":selected.counts})
 if body_hits==0:failures.append("no ordinary controller look selected the actual pet body")
 print("PET_MESH_FORENSIC="+JSON.stringify({"failures":failures,"bodyHits":body_hits,"observations":observations,"playerPosition":[player.global_position.x,player.global_position.y,player.global_position.z],"headless":true,"pixelAccurate":false,"diagnosticOnly":true}))
 quit(0 if failures.is_empty() else 1)
