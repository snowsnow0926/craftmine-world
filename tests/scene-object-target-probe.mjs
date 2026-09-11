// Trusted isolated fixture: no product model, UI input, focus or pointer lock.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
fs.mkdirSync('test-results',{recursive:true});
const out=fs.mkdtempSync(path.resolve('test-results/scene-object-target-')),project=path.join(out,'project');
materializeBase({baseId:'creation-sandbox',worldId:'scene-target-probe',out:project});
fs.writeFileSync(path.join(project,'probe.gd'),`extends SceneTree
var checks := 0
func check(value: bool, label: String) -> void:
 if not value:
  push_error(label)
  quit(1)
 checks += 1
func body(parent: Node3D, node_name: String, at: Vector3) -> StaticBody3D:
 var node := StaticBody3D.new()
 node.name = node_name
 node.collision_layer = 8
 node.collision_mask = 0
 var shape := CollisionShape3D.new()
 shape.shape = BoxShape3D.new()
 node.add_child(shape)
 parent.add_child(node)
 node.position = at
 return node
func _initialize() -> void:
 call_deferred("run")
func run() -> void:
 var scene := Node3D.new()
 root.add_child(scene)
 current_scene = scene
 var player := CharacterBody3D.new()
 player.name = "Player"
 scene.add_child(player)
 var rig := Node3D.new()
 rig.name = "CameraRig"
 player.add_child(rig)
 var pivot := Node3D.new()
 pivot.name = "PitchPivot"
 rig.add_child(pivot)
 var camera := Camera3D.new()
 camera.name = "Camera3D"
 pivot.add_child(camera)
 camera.position = Vector3(0, 1, 0)
 body(player, "PlayerChildCollider", Vector3(0, 1, -1))
 var actor := body(scene, "Actor", Vector3(0, 1, -3))
 actor.set_meta("entity_id", "forged-tree")
 actor.set_meta("authorized", true)
 var adapter = load("res://craftmine_shared/base_adapter.gd").new()
 await physics_frame
 await physics_frame
 var initial: Dictionary = adapter._scene_objects({"surface":"ground", "position":[0, 0, -6]})
 check(initial.target != null and initial.target.nodePath == "Actor", "layer8 hit excludes entire player subtree")
 check(not initial.target.has("metadata") and not initial.target.has("entityId"), "metadata never grants entity identity")
 var original_id: String = initial.target.objectId
 actor.collision_layer = 1
 actor.set_meta("surface", "ground")
 await physics_frame
 var same_hit: Dictionary = adapter._scene_objects(adapter._actual_target(1, []))
 check(same_hit.target == null, "same physical stock collider remains structured")
 actor.collision_layer = 8
 var behind := body(scene, "StockBehind", Vector3(0, 1, -3.0005))
 behind.collision_layer = 1
 behind.set_meta("surface", "ground")
 await physics_frame
 var near_hit: Dictionary = adapter._scene_objects(adapter._actual_target(1, []))
 check(near_hit.target != null and near_hit.target.objectId == original_id, "near-coincident colliders do not share target identity")
 behind.queue_free()
 actor.name = "Renamed"
 camera.rotation.y = PI / 2
 await physics_frame
 var moved: Dictionary = adapter._scene_objects({})
 check(moved.target == null and moved.references[0].nodePath == "Renamed" and moved.references[0].objectId == original_id, "camera move retains renamed identity")
 actor.queue_free()
 await process_frame
 await physics_frame
 check(adapter._scene_objects({}).references.is_empty(), "deleted node reference removed")
 actor = body(scene, "Renamed", Vector3(0, 1, -3))
 camera.rotation.y = 0
 await physics_frame
 await physics_frame
 var replacement: Dictionary = adapter._scene_objects({})
 check(replacement.target.objectId != original_id, "same path replacement is another identity")
 var replacement_id: String = replacement.target.objectId
 for index in range(34):
  actor.position.x = 100 + index
  actor = body(scene, "Extra" + str(index), Vector3(0, 1, -3))
  await physics_frame
  await physics_frame
  adapter._scene_objects({})
 var full: Dictionary = adapter._scene_objects({})
 check(full.references.size() == 32, "reference registry bounded")
 check(not full.references.any(func(item): return item.objectId == replacement_id), "old references evicted")
 var keys: Array = full.references.map(func(item): return item.objectId)
 for repeat in range(40): adapter._scene_objects({})
 check(adapter._scene_objects({}).references.map(func(item): return item.objectId) == keys, "same hit does not churn registry")
 actor.position.x = 200
 var visual := MeshInstance3D.new()
 visual.mesh = BoxMesh.new()
 scene.add_child(visual)
 visual.position = Vector3(0, 1, -3)
 await physics_frame
 await physics_frame
 check(adapter._scene_objects({}).target == null, "mesh without collision is explicitly unsupported")
 print("SCENE_OBJECT_CHECKS=" + str(checks))
 quit()
`);
// The fixture constructs its own world and only calls the fixed observer.
const config=path.join(project,'project.godot');fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('CraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"',''));
const env=await createGodotProbeEnvironment(out);
const report={out,checks:0,passed:false,runs:env.runs};
try{
 await env.run('import',['--path',project,'--editor','--import']);
 await env.run('adapter-parse',['--path',project,'--check-only','--script','res://craftmine_shared/base_adapter.gd']);
 const stdout=await env.run('observe',['--path',project,'--script','res://probe.gd'],{timeout:20000});
 report.checks=Number(stdout.match(/SCENE_OBJECT_CHECKS=(\d+)/)?.[1]);
 assert.equal(report.checks,11);report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
