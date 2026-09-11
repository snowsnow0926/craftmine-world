// Trusted isolated fixture; fixed runtime source, no UI or input events.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/controller-binding-native-')),project=path.join(out,'project');
materializeBase({baseId:'creation-sandbox',worldId:'binding-fixture',out:project});
const config=path.join(project,'project.godot');fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('CraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"',''));
fs.writeFileSync(path.join(project,'alternate.gd'),'extends "res://scripts/reused/player_controller.gd"\nfunc walk(_axis: Vector2, _frames: int) -> void:\n global_position.z -= 50.0\n');
fs.writeFileSync(path.join(project,'subclass.gd'),'extends "res://scripts/reused/player_controller.gd"\n');
fs.writeFileSync(path.join(project,'fixture.gd'),`extends SceneTree
var adapter: RefCounted
var world: Node
var cases: Array = []
var probe = load("res://craftmine_shared/controller_evidence.gd").new()
func _initialize() -> void:
 call_deferred("run")
func fresh(override_script: String = "") -> void:
 if is_instance_valid(world):
  world.queue_free()
  await process_frame
 world = load("res://scenes/creation.tscn").instantiate()
 if not override_script.is_empty(): world.get_node("Player").set_script(load(override_script))
 root.add_child(world)
 current_scene = world
 adapter = load("res://craftmine_shared/base_adapter.gd").new()
 await physics_frame
 await process_frame
func record_case(label: String) -> void:
 cases.append({"name":label,"evidence":probe.sample(world, adapter.observed_physics_tick)})
 print("CONTROLLER_CASE=" + label)
func disturb(kind: String) -> void:
 for i in 3: await physics_frame
 var player: Node = world.get_node("Player")
 if kind == "script":
  var rig: Node = player.get_node("CameraRig")
  player.set_script(load("res://subclass.gd"))
  player.set("camera_rig", rig)
 elif kind == "shape": player.get_node("CollisionShape3D").shape.radius = 0.4
 else:
  var other := Camera3D.new()
  world.add_child(other)
  other.make_current()
func run() -> void:
 await fresh()
 record_case("baseline")
 var motion: Dictionary = await adapter.command("controller-walk",{"forward":1,"right":0,"frames":12})
 cases.append({"name":"baseline-walk","result":motion})
 for source in ["alternate", "subclass"]:
  await fresh("res://" + source + ".gd")
  world.get_node("Player").set_meta("profile", "creation-fixed-controller/1")
  record_case("static-" + source)
 await fresh()
 var original: Node = world.player
 var proxy: Node = load("res://scripts/reused/player_controller.gd").new()
 world.player = proxy
 record_case("root-player-proxy")
 world.player = original
 proxy.free()
 await fresh()
 world.player.move_speed = 9.0
 record_case("parameters")
 await fresh()
 world.player.collision_mask = 0
 record_case("mask")
 await fresh()
 world.player.get_node("CollisionShape3D").shape = world.player.get_node("CollisionShape3D").shape.duplicate()
 world.player.get_node("CollisionShape3D").shape.radius = 0.4
 record_case("shape")
 await fresh()
 var other := Camera3D.new()
 world.add_child(other)
 other.make_current()
 record_case("active-camera")
 await fresh()
 world.player.camera_rig.position.y = 0.8
 record_case("camera-offset")
 for kind in ["script", "camera", "shape"]:
  await fresh()
  world.player.get_node("CollisionShape3D").shape = world.player.get_node("CollisionShape3D").shape.duplicate()
  call_deferred("disturb", kind)
  print("CONTROLLER_WALK_CASE=" + kind)
  var result: Dictionary = await adapter.command("controller-walk",{"forward":1,"right":0,"frames":48})
  cases.append({"name":"during-walk-" + kind,"result":result})
  # Drain unchanged controller coroutines before deleting the fixture. Replacing
  # a script can itself cancel its old coroutine; that expected error is retained.
  for i in 60: await physics_frame
  await process_frame
 print("CONTROLLER_BINDING=" + JSON.stringify(cases))
 quit()
`);
const env=await createGodotProbeEnvironment(out),report={out,passed:false,runs:env.runs,engineVersion:env.actualVersion};
try{
 await env.run('import',['--path',project,'--editor','--import']);let stdout;
 try{stdout=await env.run('run',['--path',project,'--script','res://fixture.gd'],{timeout:30000});}
 catch(error){
  assert.equal(error.message,'run: Godot reported an error');
  stdout=fs.readFileSync(path.join(out,'run.log'),'utf8');
  const actual=stdout.split(/\r?\n/).filter(line=>/^(SCRIPT ERROR|ERROR:|Parse Error)/.test(line));
  assert.deepEqual(actual,["ERROR: Resumed function 'walk()' after await, but class instance is gone. At script: res://scripts/reused/player_controller.gd:108"]);
  report.expectedEngineErrors=actual;report.expectedErrorScope='Injected script replacement cancels the old coroutine; never a clean gameplay pass';
 }
 report.cases=JSON.parse(stdout.split(/\r?\n/).find(x=>x.startsWith('CONTROLLER_BINDING=')).slice('CONTROLLER_BINDING='.length));assert.equal(report.cases[0].evidence.status,'supported',JSON.stringify(report.cases));assert.ok(report.cases[1].result.result?.controllerWalk);
 for(const entry of report.cases.slice(2)){if(entry.name.startsWith('during-walk'))assert.equal(entry.result.error,'CONTROLLER_BINDING_CHANGED_DURING_WALK',JSON.stringify(entry));else assert.equal(entry.evidence.status,'unsupported',JSON.stringify(entry));}
 assert.equal(report.cases.length,13);report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,cases:report.cases?.map(c=>({name:c.name,status:c.evidence?.status,error:c.result?.error}))}));}
