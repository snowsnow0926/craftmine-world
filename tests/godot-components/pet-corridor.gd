extends SceneTree
var Pet = preload("res://pet_companion.gd")
var checks := []
var world: Node3D
var player: CharacterBody3D
var pet: CharacterBody3D
var walls: Array[StaticBody3D] = []
func _initialize(): call_deferred("run")
func verify(ok: bool, name: String):
 if ok: checks.append(name)
 else: checks.append("FAIL:"+name); push_error(name)
func box(size: Vector3, at: Vector3) -> StaticBody3D:
 var body:=StaticBody3D.new();body.position=at;body.collision_layer=1;var shape:=CollisionShape3D.new();var data:=BoxShape3D.new();data.size=size;shape.shape=data;body.add_child(shape);world.add_child(body);walls.append(body);return body
func reset(gap: float, corner := false):
 world=Node3D.new();root.add_child(world);current_scene=world
 player=CharacterBody3D.new();player.name="Player";player.position=Vector3(0,.9,6);player.collision_layer=8;player.collision_mask=1;var pc:=CollisionShape3D.new();var ps:=CapsuleShape3D.new();ps.radius=.3;ps.height=1.8;pc.shape=ps;player.add_child(pc);world.add_child(player)
 pet=Pet.new();pet.entity_id="pet-corridor";pet.appearance_key="dog";pet.following=true;pet.player_path=NodePath("../Player");pet.position=Vector3(0,.4,4);world.add_child(pet);walls=[]
 box(Vector3(.2,2,.2),Vector3(-(gap+.2)/2,1,1.2));box(Vector3(.2,2,3),Vector3((gap+.2)/2,1,1.2))
 box(Vector3(20,.2,20),Vector3(0,-.1,1.5))
 if corner: box(Vector3(3,2,.2),Vector3(1.5,1,-.3))
 for _i in 10: await physics_frame
func move_player(frames: int):
 player.velocity=Vector3(0,0,-2)
 for _i in frames: player.move_and_slide();await physics_frame
 player.velocity=Vector3.ZERO
 for _i in 30: await physics_frame
func run():
 await reset(1.4);var narrowShape:=pet.get_node("CollisionShape3D").shape as BoxShape3D;var gateQuery:=PhysicsShapeQueryParameters3D.new();gateQuery.shape=narrowShape;gateQuery.transform=Transform3D(Basis.IDENTITY,Vector3(0,narrowShape.size.y/2.0,1.2));gateQuery.collision_mask=1;var gateHits:=world.get_world_3d().direct_space_state.intersect_shape(gateQuery,8);verify(not gateHits.is_empty(),"1.4m straight doorway rejects long dog box by actual shape query");var narrow: Dictionary=pet.snapshot()
 await reset(1.8);await move_player(240);verify(pet.global_position.z>1.4 and pet.global_position.z<3.9,"1.8m straight doorway follows until stop distance through actual move_and_slide");var wide: Dictionary=pet.snapshot();verify(narrow.position[2]>wide.position[2],"narrow and wide door produce distinct physical outcomes")
 await reset(1.8,true);await move_player(240);verify(pet.global_position.z>-.8,"tight L corner stops instead of teleporting through side wall")
 var saved: Dictionary=pet.snapshot();pet.queue_free();await process_frame;var restored:=Pet.new();restored.entity_id="pet-corridor";restored.appearance_key="dog";restored.following=true;restored.player_path=NodePath("../Player");world.add_child(restored);verify(restored.restore(saved).is_empty(),"saved dog box state restores with exact identity");verify(restored.snapshot()==saved,"dog box position/yaw/settings survive save and restore")
 print("PET_CORRIDOR="+JSON.stringify({"checks":checks,"dogShape":restored.get_node("CollisionShape3D").shape is BoxShape3D,"dogBoxSize":Vector3(1.479582266,.762157913,1.402),"narrow":narrow.position,"wide":wide.position}));quit(0)

