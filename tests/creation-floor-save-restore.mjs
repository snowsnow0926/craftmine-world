// Real pinned engine contacts and save/restore; no mouse, keyboard or player profile writes.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'..');
const out=fs.mkdtempSync(path.join(root,'test-results/creation-floor-save-restore-')),project=path.join(out,'project');
materializeBase({baseId:'creation-sandbox',worldId:'floor-save-fixture',out:project});
const config=path.join(project,'project.godot');fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('CraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"',''));
fs.writeFileSync(path.join(project,'fixture.gd'),`extends SceneTree
var world: Node3D
var adapter: RefCounted
var results: Array = []
func _initialize() -> void: run.call_deferred()
func settle() -> void:
 for i in 3: await physics_frame
 await process_frame
func contacts() -> Dictionary:
 var player: CharacterBody3D = world.player
 var q := PhysicsShapeQueryParameters3D.new()
 q.shape = player.get_node("CollisionShape3D").shape
 q.transform = player.global_transform
 q.collision_mask = player.collision_mask
 q.exclude = [player.get_rid()]
 q.margin = 0.0
 var pairs: Array = []
 var space := world.get_world_3d().direct_space_state
 var points := space.collide_shape(q, 64)
 for i in range(0, points.size(), 2):
  var delta: Vector3 = points[i + 1] - points[i]
  pairs.append({"depth":delta.length(),"a":[points[i].x,points[i].y,points[i].z],"b":[points[i+1].x,points[i+1].y,points[i+1].z],"normal":[delta.normalized().x,delta.normalized().y,delta.normalized().z]})
 var hits: Array = []
 for hit in space.intersect_shape(q,64): hits.append(str(world.get_path_to(hit.collider)))
 return {"pairs":pairs,"hits":hits,"safeMargin":player.safe_margin,"floorMaxAngle":player.floor_max_angle}
func record(label: String, snapshot: Dictionary) -> void:
 var initial: Dictionary = world.capture()
 var error: String = await adapter.restore(snapshot)
 var guard: Dictionary = adapter.observe().progressCollisionGuard
 var pose: Array = snapshot.player.position
 var before_position: Vector3 = world.player.position
 # A rejected saved pose is never retained. Inspect its real shape separately
 # only in this trusted fixture, and put the original pose back afterwards.
 world.player.position = Vector3(pose[0],pose[1],pose[2])
 await settle()
 var queried := contacts()
 world.player.position = before_position
 await settle()
 results.append({"case":label,"error":error,"guard":guard,"contacts":queried,"requested":snapshot.player,"after":world.capture().player,"rollbackEqual":JSON.stringify(initial)==JSON.stringify(world.capture())})
func run() -> void:
 world = load("res://scenes/creation.tscn").instantiate()
 root.add_child(world)
 current_scene = world
 world.player.capture_mouse_on_click = false
 world.player.input_enabled = false
 adapter = load("res://craftmine_shared/base_adapter.gd").new()
 await settle()
 paused = true
 await record("initial-floor",world.capture())
 paused = false
 await world.player.walk(Vector2(0,-1),90)
 for i in 60: await physics_frame
 paused = true
 var natural: Dictionary = world.capture()
 await record("natural-walk-save",natural)
 var measured: Dictionary = natural.duplicate(true)
 measured.player.position = [0,0.898971319198608,-0.684998571872711]
 measured.player.onFloor = true
 await record("packaged-saved-pose",measured)
 var floor_deep: Dictionary = measured.duplicate(true)
 floor_deep.player.position[1] = 0.898
 await record("two-mm-floor",floor_deep)
 floor_deep.player.position[1] = 0.89889
 await record("floor-above-numeric-limit",floor_deep)
 var collision := CollisionShape3D.new()
 var box := BoxShape3D.new()
 box.size = Vector3(2,3,2)
 collision.shape = box
 var wall := StaticBody3D.new()
 wall.collision_layer = 2
 world.add_child(wall)
 wall.add_child(collision)
 var position: Array = measured.player.position
 for depth in [0.00105,0.002,0.15]:
  wall.global_position = Vector3(position[0]+1.3-depth,position[1],position[2])
  await settle()
  await record("wall-"+str(depth),measured)
 wall.global_position = Vector3(position[0],position[1]+2.4-0.00105,position[2])
 await settle()
 await record("ceiling-0.00105",measured)
 box.size = Vector3(4,1,4)
 wall.rotation.z = PI / 6.0
 var normal: Vector3 = wall.global_transform.basis.y
 wall.global_position = Vector3(position[0],position[1],position[2]) - Vector3(0,0.6,0) - normal * (0.8 - 0.00105)
 await settle()
 await record("slope-0.00105",measured)
 print("FLOOR_SAVE_AUDIT="+JSON.stringify(results))
 quit()
`);
const env=await createGodotProbeEnvironment(out),report={out,engine:env.actualVersion,runs:env.runs};
try{
 await env.run('import',['--path',project,'--editor','--import']);
 const stdout=await env.run('run',['--path',project,'--script','res://fixture.gd']);
 report.cases=JSON.parse(stdout.split(/\r?\n/).find(line=>line.startsWith('FLOOR_SAVE_AUDIT=')).slice(17));
 if(!process.argv.includes('--diagnose')){
  assert.equal(report.cases.length,10);
  for(const row of report.cases){
   const passes=['initial-floor','natural-walk-save','packaged-saved-pose'].includes(row.case);
   assert.equal(row.error==='',passes,JSON.stringify(row));
   if(passes)assert.deepEqual(row.after,row.requested);else {assert.match(row.error,/CREATION_COLLISION_GUARD_FAILED:PLAYER_PENETRATION/);assert.equal(row.rollbackEqual,true);}
  }
  report.passed=true;
 }
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error,cases:report.cases}));}
