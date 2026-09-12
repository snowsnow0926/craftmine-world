extends SceneTree

var record := {"nodes":0, "meshInstances":0, "triangles":0, "collisionTriangles":0, "texturedSurfaces":0, "surfacesWithLods":0, "scripts":0, "corridorQueries":0}

func _initialize():
 call_deferred("run")

func inspect(node: Node):
 record.nodes += 1
 assert(not node is AnimationMixer and not node is Skeleton3D)
 if node.get_script() != null: record.scripts += 1
 if node is MeshInstance3D:
  assert(node.mesh is ArrayMesh and node.mesh.get_script() == null)
  assert(node.skin == null and node.mesh.get_blend_shape_count() == 0)
  record.meshInstances += 1
  record.triangles += node.mesh.get_faces().size() / 3
  var box: AABB = node.global_transform * node.mesh.get_aabb()
  record.bounds = box if not record.has("bounds") else record.bounds.merge(box)
  for surface in node.mesh.get_surface_count():
   var info := RenderingServer.mesh_get_surface(node.mesh.get_rid(), surface)
   if not info.get("lods", []).is_empty(): record.surfacesWithLods += 1
   var material: Material = node.get_active_material(surface)
   assert(material is StandardMaterial3D and material.get_script() == null)
   assert(material.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED)
   assert(not material.grow and not material.heightmap_enabled)
   if material.albedo_texture != null:
    assert(material.albedo_texture.get_width() > 0 and material.albedo_texture.get_height() > 0)
    record.texturedSurfaces += 1
 if node is CollisionShape3D:
  assert(node.shape is ConcavePolygonShape3D)
  record.collisionTriangles += node.shape.get_faces().size() / 3
 for child in node.get_children(): inspect(child)

func run():
 var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://component.json"))
 var world := Node3D.new()
 root.add_child(world)
 current_scene = world
 var scene = load("res://addons/" + manifest.id + "/" + manifest.entryScene).instantiate()
 assert(scene is Node3D and scene.get("entity_id") == "")
 scene.set("entity_id", "fixture-forest-gateway")
 world.add_child(scene)
 assert(scene.get_node("Trees").get_child_count() == 7)
 inspect(scene)
 assert(record.scripts == 1, "Only the scene root may carry the identity script")
 assert(record.surfacesWithLods == 0 and record.texturedSurfaces > 0)
 var box: AABB = record.bounds
 assert(absf(box.position.y) < 0.0001)
 assert(absf(box.get_center().x) < 0.0001 and absf(box.get_center().z) < 0.0001)
 for axis in 3: assert(absf(box.size[axis] * 1000.0 - manifest.placement.dimensionsMm[axis]) <= 1.1)
 record.bounds = {"min":[box.position.x,box.position.y,box.position.z],"size":[box.size.x,box.size.y,box.size.z],"center":[box.get_center().x,box.get_center().y,box.get_center().z]}
 await physics_frame
 await physics_frame
 var space = scene.get_world_3d().direct_space_state
 var capsule := CapsuleShape3D.new()
 capsule.radius = 0.3
 capsule.height = 1.8
 var query := PhysicsShapeQueryParameters3D.new()
 query.shape = capsule
 query.collision_mask = 1
 var start: Array = manifest.sceneContract.pathStart
 var end: Array = manifest.sceneContract.pathEnd
 for lane in [-0.4, 0.0, 0.4]:
  for step in 71:
   var center := Vector3(start[0] + lane, 0.9, lerpf(start[2], end[2], step / 70.0))
   query.transform = Transform3D(Basis.IDENTITY, center)
   assert(space.intersect_shape(query).is_empty(), "Capsule path overlaps real collision: " + str(center))
   record.corridorQueries += 1
 var gate: Node3D = scene.get_node("Gateway/OpenStoneGateway")
 for side in [-1.5, 1.5]:
  var from := gate.position + Vector3(side, 1, 3)
  var to := gate.position + Vector3(side, 1, -3)
  assert(not space.intersect_ray(PhysicsRayQueryParameters3D.create(from,to,1)).is_empty(), "Doorway post must remain solid")
 record.postsSolid = true
 var from := gate.position + Vector3(0, 4, 3)
 var to := gate.position + Vector3(0, 4, -3)
 assert(not space.intersect_ray(PhysicsRayQueryParameters3D.create(from,to,1)).is_empty(), "Lintel must remain solid")
 record.lintelSolid = true
 var camera := Camera3D.new()
 world.add_child(camera)
 camera.current = true
 var oak: Node3D = scene.get_node("Trees/OakFrontLeft")
 camera.position = oak.position + Vector3(0, 3, 5)
 camera.look_at(oak.position + Vector3(0, 3, 0))
 var picker = load("res://scene_mesh_picker.gd").new()
 var exclusions: Array[Node] = []
 var picked: Dictionary = picker.pick(world, camera, exclusions)
 assert(picked.status == "hit", "Full prefab must stay inside actual observer support: " + picked.reason)
 assert(oak.is_ancestor_of(picked.node), "Ray must identify the actual oak mesh")
 record.picker = {"status":picked.status,"node":str(scene.get_path_to(picked.node)),"counts":picked.counts}
 camera.position = gate.position + Vector3(0, 1, 5)
 camera.look_at(gate.position + Vector3(0, 1, 0))
 var through: Dictionary = picker.pick(world, camera, exclusions)
 assert(through.status == "none", "Precise mesh query must preserve the empty doorway")
 record.pickerOpeningClear = true
 print("FOREST_GATEWAY=" + JSON.stringify(record))
 quit()
