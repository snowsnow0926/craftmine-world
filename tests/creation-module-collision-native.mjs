// Trusted authored physics fixtures, independent engine, no input or player relocation.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/creation-module-collision-')),project=path.join(out,'project');
materializeBase({baseId:'creation-sandbox',worldId:'collision-fixture',out:project});
fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities:[{id:'guard-door',kind:'door',position:[0,0,6],scale:[1,1,1],rotationY:0,color:'#84a866',parameters:{initiallyOpen:true}}],rules:[]}));
const config=path.join(project,'project.godot');fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('CraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"',''));
fs.writeFileSync(path.join(project,'fake_restore.gd'),'extends "res://scripts/creation_world.gd"\nfunc restore(_data: Dictionary) -> String:\n return ""\n');
fs.writeFileSync(path.join(project,'fixture.gd'),`extends SceneTree
var world: Node3D
var saved: Dictionary
var results: Array = []
var adapter: RefCounted
func _initialize() -> void: run.call_deferred()
func query() -> Dictionary:
 var shape := CapsuleShape3D.new()
 shape.radius = 0.3
 shape.height = 1.8
 var q := PhysicsShapeQueryParameters3D.new()
 q.shape = shape
 q.transform = world.player.global_transform
 q.collision_mask = world.player.collision_mask
 q.exclude = [world.player.get_rid()]
 q.collide_with_areas = false
 q.margin = 0.0
 var hits: Array = []
 for hit in world.get_world_3d().direct_space_state.intersect_shape(q, 16):
  hits.append({"nodePath":str(world.get_path_to(hit.collider)),"id":str(hit.collider.get_instance_id()),"shape":hit.shape})
 var contacts := world.get_world_3d().direct_space_state.collide_shape(q, 64)
 var depths: Array = []
 for i in range(0, contacts.size(), 2): depths.append(contacts[i].distance_to(contacts[i+1]))
 return {"hits":hits,"depths":depths}
func record(label: String) -> void:
 var legacy: String = world.validate_progress(saved)
 var before: Dictionary = world.capture()
 var error: String = await adapter.restore(saved)
 results.append({"case":label,"playerPosition":[world.player.position.x,world.player.position.y,world.player.position.z],"legacyValidation":legacy,"native":query(),"restoreError":error,"guard":adapter.observe().progressCollisionGuard,"rollbackEqual":JSON.stringify(before)==JSON.stringify(world.capture())})
func settle() -> void:
 for i in 2: await physics_frame
 await process_frame
func replace_shape() -> void:
 await physics_frame
 world.player.get_node("CollisionShape3D").shape = world.player.get_node("CollisionShape3D").shape.duplicate()
func run() -> void:
 world = load("res://scenes/creation.tscn").instantiate()
 root.add_child(world)
 current_scene = world
 adapter = load("res://craftmine_shared/base_adapter.gd").new()
 await settle()
 paused = true
 saved = world.capture()
 await record("normal-floor-contact")
 var module := Node3D.new()
 module.name = "ImportedModule"
 world.add_child(module)
 var body := StaticBody3D.new()
 body.name = "BuildingBody"
 body.collision_layer = 2
 body.collision_mask = 8
 body.set_meta("entity_id", "guard-door")
 body.set_meta("surface", "entity")
 module.add_child(body)
 var collision := CollisionShape3D.new()
 var box := BoxShape3D.new()
 box.size = Vector3(2,3,2)
 collision.shape = box
 body.add_child(collision)
 body.global_position = world.player.global_position + Vector3(1.3,0,0)
 await settle()
 await record("wall-contact")
 body.global_position = world.player.global_position + Vector3(1.15,0,0)
 await settle()
 await record("wall-penetration")
 body.global_position = world.player.global_position
 await settle()
 await record("inside-convex-building")
 collision.disabled = true
 await settle()
 await record("non-solid-building")
 world.set_door_open("guard-door", false)
 await settle()
 await record("saved-open-door")
 collision.disabled = false
 box.size = Vector3(2,3,2)
 body.global_position = world.player.global_position + Vector3(1.3 - 0.002,0,0)
 await settle()
 await record("two-mm-wall-penetration")
 body.global_position = world.player.global_position + Vector3(1.0 + 0.3/sqrt(2.0),0,1.0 + 0.3/sqrt(2.0))
 await settle()
 await record("corner-contact")
 body.global_position = world.player.global_position + Vector3(1.0 + 0.29/sqrt(2.0),0,1.0 + 0.29/sqrt(2.0))
 await settle()
 await record("corner-penetration")
 box.size = Vector3(4,1,4)
 body.rotation.z = PI / 6.0
 var normal: Vector3 = body.global_transform.basis.y
 body.global_position = world.player.global_position - Vector3(0,0.6,0) - normal * 0.8
 await settle()
 await record("slope-contact")
 body.global_position += normal * 0.02
 await settle()
 await record("slope-penetration")
 body.rotation = Vector3.ZERO
 var mesh := BoxMesh.new()
 mesh.size = Vector3(2,3,2)
 collision.shape = mesh.create_trimesh_shape()
 body.global_position = world.player.global_position + Vector3(1.15,0,0)
 await settle()
 await record("trimesh-wall-penetration")
 body.global_position = world.player.global_position
 await settle()
 await record("trimesh-room-clearance")
 collision.disabled = true
 var copies: Array[Node] = []
 for i in 65:
  var copy := StaticBody3D.new()
  copy.collision_layer = 2
  world.add_child(copy)
  copy.global_position = world.player.global_position
  var shape := CollisionShape3D.new()
  shape.shape = BoxShape3D.new()
  copy.add_child(shape)
  copies.append(copy)
 await settle()
 await record("collision-budget")
 world.queue_free()
 await process_frame
 world = load("res://scenes/creation.tscn").instantiate()
 world.set_script(load("res://fake_restore.gd"))
 root.add_child(world)
 current_scene = world
 adapter = load("res://craftmine_shared/base_adapter.gd").new()
 await settle()
 saved = world.capture()
 var requested: Dictionary = saved.duplicate(true)
 requested.player.position[0] = 2.0
 var mismatch: String = await adapter.restore(requested)
 results.append({"case":"restore-lies-about-pose","restoreError":mismatch,"guard":adapter.observe().progressCollisionGuard})
 replace_shape.call_deferred()
 var changed: String = await adapter.restore(saved)
 results.append({"case":"shape-replaced-during-sync","restoreError":changed,"guard":adapter.observe().progressCollisionGuard})
 world.player.shape_owner_set_transform(world.player.get_shape_owners()[0], Transform3D(Basis.IDENTITY, Vector3(5,0,0)))
 var transformed: String = await adapter.restore(saved)
 results.append({"case":"native-shape-owner-transform","restoreError":transformed,"guard":adapter.observe().progressCollisionGuard})
 print("COLLISION_AUDIT="+JSON.stringify(results))
 quit()
`);
const env=await createGodotProbeEnvironment(out),report={out,scope:'trusted authored candidate physics; no actual external asset executed',engine:env.actualVersion,runs:env.runs};
try{
 await env.run('import',['--path',project,'--editor','--import']);const stdout=await env.run('run',['--path',project,'--script','res://fixture.gd']);report.cases=JSON.parse(stdout.split(/\r?\n/).find(line=>line.startsWith('COLLISION_AUDIT=')).slice(16));assert.equal(report.cases.length,17);const geometry=report.cases.slice(0,14);assert.ok(geometry.every(row=>row.legacyValidation===''));
 const allowed=['normal-floor-contact','wall-contact','non-solid-building','saved-open-door','corner-contact','slope-contact','trimesh-room-clearance'];
 for(const row of geometry){assert.equal(row.restoreError==='',allowed.includes(row.case),JSON.stringify(row));if(row.restoreError)assert.equal(row.rollbackEqual,true);}
 assert.ok(geometry.every(row=>JSON.stringify(row.playerPosition)===JSON.stringify(report.cases[0].playerPosition)));
 assert.match(report.cases[14].restoreError,/RESTORED_POSE_MISMATCH/);assert.match(report.cases[15].restoreError,/SHAPE_CHANGED.*ROLLBACK_UNCONFIRMED/);assert.match(report.cases[16].restoreError,/NATIVE_SHAPE_TRANSFORM_MISMATCH/);report.reproduced=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,reproduced:report.reproduced,cases:report.cases?.map(row=>({case:row.case,error:row.restoreError,depth:row.guard.maxContactDepth}))}));}
