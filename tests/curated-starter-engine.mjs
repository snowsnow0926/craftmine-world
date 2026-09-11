// Trusted declarative fixture and inspected static CC0 assets; no authored game code.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const source=path.resolve('desktop/godot/components/curated-starter'),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/curated-starter-engine-')),project=path.join(out,'project');fs.mkdirSync(project);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const item of manifest.items)for(const file of item.files){const bytes=fs.readFileSync(path.join(source,file.path));assert.equal(sha(bytes),file.sha256);const target=path.join(project,'addons',item.id,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Trusted curated component import probe"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
fs.writeFileSync(path.join(project,'items.json'),JSON.stringify(manifest.items));
fs.writeFileSync(path.join(project,'probe.gd'),`extends SceneTree
var records := []
func _initialize():
 call_deferred("run")
func inspect(node: Node, record: Dictionary):
 record.nodes += 1
 if node is MeshInstance3D:
  record.meshInstances += 1
  record.triangles += node.mesh.get_faces().size() / 3
  var box: AABB = node.global_transform * node.mesh.get_aabb()
  record.bounds = box if not record.has("bounds") else record.bounds.merge(box)
  for surface in node.mesh.get_surface_count():
   var info := RenderingServer.mesh_get_surface(node.mesh.get_rid(), surface)
   if not info.get("lods", []).is_empty(): record.surfacesWithLods += 1
   var material: Material = node.get_active_material(surface)
   assert(material is StandardMaterial3D, "Missing imported native material")
   if material.albedo_texture != null:
    assert(material.albedo_texture.get_width() > 0 and material.albedo_texture.get_height() > 0)
    record.texturedSurfaces += 1
 if node is CollisionShape3D:
  assert(node.shape is ConcavePolygonShape3D)
  record.collisionTriangles += node.shape.get_faces().size() / 3
 for child in node.get_children(): inspect(child, record)
func run():
 var world := Node3D.new()
 root.add_child(world)
 current_scene = world
 var items = JSON.parse_string(FileAccess.get_file_as_string("res://items.json"))
 for item in items:
  for entry in [item.entryScene, item.visualScene] if item.entryScene != item.visualScene else [item.entryScene]:
   var packed: PackedScene = load("res://addons/" + item.id + "/" + entry)
   assert(packed != null, "Scene import failed")
   var node = packed.instantiate()
   assert(node is Node3D and node.get("entity_id") == "")
   node.set("entity_id", "fixture-" + item.id)
   world.add_child(node)
   var record = {"id":item.id, "entry":entry, "nodes":0, "meshInstances":0, "triangles":0, "collisionTriangles":0, "texturedSurfaces":0, "surfacesWithLods":0}
   inspect(node, record)
   assert(record.triangles == item.geometry.triangles, "Imported triangle count changed")
   var box: AABB = record.bounds
   assert(absf(box.position.y) < 0.0001, "Wrapper must touch ground at y=0")
   var expected: Array = item.placement.dimensionsMm
   for axis in range(3): assert(absf(box.size[axis] * 1000.0 - expected[axis]) <= 1.1, "Imported dimensions differ")
   record.bounds = {"min":[box.position.x,box.position.y,box.position.z],"size":[box.size.x,box.size.y,box.size.z]}
   if item.source == "castle": assert(record.texturedSurfaces > 0, "Castle palette texture missing")
   if entry == item.entryScene and item.collision.mode == "static-trimesh": assert(record.collisionTriangles == item.geometry.triangles)
   else: assert(record.collisionTriangles == 0)
   records.append(record)
   node.free()
 var doorway = load("res://addons/cw.castle.wall-doorway/scenes/cw.castle.wall-doorway.tscn").instantiate()
 world.add_child(doorway)
 await physics_frame
 await physics_frame
 var space = doorway.get_world_3d().direct_space_state
 var through = space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(5, 1, 0), Vector3(-5, 1, 0), 1))
 var post = space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(5, 1, 1.2), Vector3(-5, 1, 1.2), 1))
 var lintel = space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(5, 3, 0), Vector3(-5, 3, 0), 1))
 assert(through.is_empty(), "Doorway collision must preserve the opening")
 assert(not post.is_empty() and not lintel.is_empty(), "Doorway posts and lintel must collide")
 print("CURATED_DOORWAY=" + JSON.stringify({"openingClear":through.is_empty(),"postSolid":not post.is_empty(),"lintelSolid":not lintel.is_empty()}))
 doorway.free()
 print("CURATED_COMPONENTS=" + JSON.stringify(records))
 quit()
`);
const probe=await createGodotProbeEnvironment(out),report={out,engine:probe.actualVersion,sourceManifestSha256:sha(fs.readFileSync(path.join(source,'manifest.json'))),passed:false,runs:probe.runs};
try{await probe.run('import',['--editor','--path',project,'--import'],{timeout:120000});const result=await probe.run('components',['--path',project,'--script','res://probe.gd']);report.items=JSON.parse(result.split(/\r?\n/).find(line=>line.startsWith('CURATED_COMPONENTS=')).slice('CURATED_COMPONENTS='.length));report.doorway=JSON.parse(result.split(/\r?\n/).find(line=>line.startsWith('CURATED_DOORWAY=')).slice('CURATED_DOORWAY='.length));assert.equal(report.items.length,26);assert.ok(Object.values(report.doorway).every(Boolean));report.passed=true;}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,scenes:report.items?.length,lodSurfaces:report.items?.reduce((n,i)=>n+i.surfacesWithLods,0)}));}
