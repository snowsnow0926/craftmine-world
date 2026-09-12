// Fixed authored native API investigation; no user project, OS input or model.
import fs from 'node:fs';import path from 'node:path';import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/pose-api-')),project=path.join(out,'project');fs.mkdirSync(project);
fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Native pose API probe"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
fs.writeFileSync(path.join(project,'probe.gd'),`extends SceneTree
func _initialize(): call_deferred("run")
func run():
 var world := Node3D.new()
 root.add_child(world)
 current_scene = world
 var skeleton := Skeleton3D.new()
 skeleton.name = "Skeleton"
 skeleton.add_bone("root")
 skeleton.set_bone_rest(0, Transform3D.IDENTITY)
 world.add_child(skeleton)
 var skin := Skin.new()
 skin.add_bind(0, Transform3D.IDENTITY)
 var arrays := []
 arrays.resize(Mesh.ARRAY_MAX)
 arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-0.5,-0.5,0),Vector3(0.5,-0.5,0),Vector3(0,0.5,0)])
 arrays[Mesh.ARRAY_NORMAL] = PackedVector3Array([Vector3.BACK,Vector3.BACK,Vector3.BACK])
 arrays[Mesh.ARRAY_BONES] = PackedInt32Array([0,0,0,0,0,0,0,0,0,0,0,0])
 arrays[Mesh.ARRAY_WEIGHTS] = PackedFloat32Array([1,0,0,0,1,0,0,0,1,0,0,0])
 var mesh := ArrayMesh.new()
 mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
 var instance := MeshInstance3D.new()
 instance.mesh = mesh
 instance.skin = skin
 instance.skeleton = NodePath("..")
 skeleton.add_child(instance)
 var records := []
 for displacement in [0.0,2.0,-1.0]:
  skeleton.set_bone_pose_position(0,Vector3(displacement,0,0))
  await process_frame
  await process_frame
  var reference := instance.get_skin_reference()
  if reference == null or not reference.get_skeleton().is_valid():
   records.append({"poseX":displacement,"nativeBoneX":skeleton.get_bone_global_pose(0).origin.x,"bakeStatus":"unavailable","reason":"registered-renderer-skeleton-unavailable"})
   continue
  var baked := instance.bake_mesh_from_current_skeleton_pose()
  assert(baked != null)
  var points: PackedVector3Array = baked.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
  assert(absf(points[0].x - (displacement-0.5)) < 0.0001)
  records.append({"poseX":displacement,"firstVertex":[points[0].x,points[0].y,points[0].z],"surfaceCount":baked.get_surface_count(),"skinReference":instance.get_skin_reference()!=null,"nativeClass":baked.get_class()})
 print("POSE_API="+JSON.stringify({"records":records,"bakeMethod":ClassDB.class_has_method("MeshInstance3D","bake_mesh_from_current_skeleton_pose"),"skinMethod":ClassDB.class_has_method("MeshInstance3D","get_skin_reference")}))
 quit()
`);
const probe=await createGodotProbeEnvironment(out);
const log=await probe.run('pose-api',['--path',project,'--script','res://probe.gd','--quit-after','120'],{timeout:10000});
const result=JSON.parse(log.split(/\r?\n/).find(line=>line.startsWith('POSE_API=')).slice(9));
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({engine:probe.actualVersion,result},null,2));console.log(JSON.stringify({out,engine:probe.actualVersion,...result}));
