import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageInstaller} from '../plugins/craftmine-world/reuse-service.mjs';
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {buildPromoNaturePackages} from '../desktop/build-promo-nature-packages.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('promo nature packages preserve both authored model files and declare one independent root',async()=>{
  const packages=buildPromoNaturePackages();
  assert.equal(packages.length,2);
  for(const item of packages){
    const archive=unpackStaticPackage(item.bytes),resource=archive.resources[0];
    const model=resource.files.get('model.glb'),provenance=JSON.parse(resource.files.get('provenance.json'));
    const original=await fs.readFile(path.join('desktop/godot/shared/promo-templates/promo-mainline/source',provenance.model.path));
    assert.deepEqual(model,original);assert.equal(sha(model),provenance.model.sha256);
    assert.deepEqual(resource.manifest.content.entry.entities,['root']);
    assert.equal(resource.manifest.content.entry.sceneInstall.identityField,'entity_id');
    assert(resource.files.has('component.gd.uid'));
    assert.equal(resource.manifest.content.state.kind,'static-component-no-player-state');
    assert(![...resource.files.keys()].some(file=>/player_controller|creation_world|riftbeast|ak47|heavyblade|hornling/.test(file)));
  }
  assert.deepEqual(packages.map(item=>sha(item.bytes)),buildPromoNaturePackages().map(item=>sha(item.bytes)));
});

test('real source installer materializes independent trees and meadow; pinned headless Godot verifies geometry and collision',
  {skip:!process.env.CRAFTMINE_CORE_BIN||!process.env.CRAFTMINE_TEST_GODOT},async t=>{
  await fs.mkdir('test-results',{recursive:true});const out=await fs.mkdtemp(path.resolve('test-results/promo-nature-'));
  const core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(out,'core')),context={projectId:'nature-project',sessionId:'nature-session',turnId:'nature-turn'},worldId='nature-world';
  const call=(method,args)=>core.call(method,args,120000),report={out,worldId,modelCalls:0,scope:'Real source CAS and CPU Godot components; no native player UI claim'};
  t.after(async()=>{await core.stop();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));});await core.start();
  const world={build:{id:'nature-base',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]};
  await call('world.create',{id:worldId,title:'Nature source fixture',world});await call('workspace.open',{context,selectedWorld:worldId});
  await call('godotProject.create',{context,worldId,toolCallId:'nature-source',baseBuild:'nature-base',baseId:'creation-sandbox',files:[
    {path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://scenes/creation.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n'},
    {path:'scenes/creation.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n'},
  ]});await call('content.migrate.apply',{worldId});
  const installer=createManagedPackageInstaller({call,enqueue:async()=>{},stagingRoot:path.join(out,'installs'),bind:async(worldId,operationId)=>{
    const worldRecord=await call('world.read',{id:worldId}),status=await call('content.status',{worldId}),index=await call('godotProject.index',{context,worldId,offset:0,limit:1});
    return {context,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:index.branchId,
      expectedHeadOid:status.branches.find(branch=>branch.name==='refs/heads/'+index.branchId).oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};
  }});
  const [tree,meadow]=buildPromoNaturePackages();
  const beforeSource=await call('godotProject.index',{context,worldId,offset:0,limit:1});
  report.installation=await installer.group({worldId,operationId:'install-nature',expectedSource:{revision:beforeSource.revision,manifestHash:beforeSource.manifestHash},items:[
    {archiveBase64:tree.bytes.toString('base64'),position:{x:0,y:0,z:0}},
    {archiveBase64:tree.bytes.toString('base64'),position:{x:12,y:0,z:0}},
    {archiveBase64:meadow.bytes.toString('base64'),position:{x:0,y:0,z:0}},
  ]});
  assert.equal(report.installation.applied,false);assert.equal(new Set(report.installation.instanceIds).size,3);
  const after=await call('world.read',{id:worldId});assert.deepEqual(after.world.snapshot,world.snapshot);
  const project=path.join(out,'project');await fs.mkdir(project);let offset=0,pins;
  do{
    const page=await call('godotProject.index',{context,worldId,offset,limit:32,...(pins??{})});pins??={revision:page.revision,manifestHash:page.manifestHash};
    for(const file of page.files){
      const target=path.resolve(project,file.path);assert(target.startsWith(project+path.sep));let next=0;const chunks=[];
      do{const part=await call('godotProject.read',{context,worldId,...pins,path:file.path,offset:next,limit:16000});assert.equal(part.sha256,file.sha256);
        chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text));next=part.nextOffset;
      }while(next!==null&&next!==undefined);
      const bytes=Buffer.concat(chunks);assert.equal(sha(bytes),file.sha256);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
    }
    offset=page.nextOffset;
  }while(offset!==null&&offset!==undefined);
  const probe=`extends SceneTree
var checks: Array[String] = []
func verify(ok: bool, label: String) -> void:
 if not ok:
  push_error(label)
  quit(1)
  return
 checks.append(label)
func bounds(node: Node3D) -> AABB:
 var result := AABB()
 var first := true
 for candidate in node.find_children("*", "MeshInstance3D", true, false):
  var box: AABB = candidate.global_transform * candidate.get_aabb()
  result = box if first else result.merge(box)
  first = false
 return result
func _initialize() -> void:
 call_deferred("run")
func run() -> void:
 var world := load("res://scenes/creation.tscn").instantiate() as Node3D
 root.add_child(world)
 await process_frame
 await physics_frame
 await physics_frame
 var trees: Array[Node3D] = []
 var meadow: Node3D
 var ids: Dictionary = {}
 for child in world.get_children():
  if child.get_node_or_null("TrunkCollision") != null: trees.append(child)
  if child.has_meta("decoration_only"): meadow = child
  var id := String(child.get("entity_id"))
  verify(not id.is_empty() and not ids.has(id), "unique static instance " + id)
  ids[id] = true
 verify(trees.size() == 2 and meadow != null, "two trees and original meadow instantiated")
 verify(world.find_children("*", "CharacterBody3D", true, false).is_empty(), "no player or enemy was introduced")
 verify(meadow.find_children("*", "CollisionShape3D", true, false).is_empty(), "meadow remains decoration only")
 verify(world.find_children("*", "StaticBody3D", true, false).size() == 2, "only two tree collision bodies")
 for tree in trees:
  verify(tree.get_node("AuthoredBroadleaf").scale.is_equal_approx(Vector3(2.2, 1.05, 2.2)), "source tree scale retained")
  verify(tree.get_node("TrunkCollision").get_child(0).shape.size.is_equal_approx(Vector3(2.64, 4.2, 2.64)), "source tree collision dimensions retained")
 var hit := world.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(0, 2, 6), Vector3(0, 2, -6), 1))
 verify(not hit.is_empty() and absf(hit.position.z - 1.32) < 0.01, "actual physics ray hits the tree front")
 var tree_box := bounds(trees[0])
 var meadow_box := bounds(meadow)
 verify(tree_box.size.y > 3.0 and meadow_box.size.x > 20.0 and meadow_box.size.z > 20.0, "authored geometry has its expected scale")
 var output := {"checks": checks, "treeBounds": {"position": [tree_box.position.x, tree_box.position.y, tree_box.position.z], "size": [tree_box.size.x, tree_box.size.y, tree_box.size.z]}, "meadowBounds": {"position": [meadow_box.position.x, meadow_box.position.y, meadow_box.position.z], "size": [meadow_box.size.x, meadow_box.size.y, meadow_box.size.z]}}
 var file := FileAccess.open("res://observed.json", FileAccess.WRITE)
 file.store_string(JSON.stringify(output))
 file.close()
 world.queue_free()
 await process_frame
 quit(0)
`;
  await fs.writeFile(path.join(project,'probe.gd'),probe);
  for(const [label,args] of [['import',['--headless','--editor','--path',project,'--import']],['probe',['--headless','--path',project,'--script','res://probe.gd']]]){
    const result=spawnSync(process.env.CRAFTMINE_TEST_GODOT,args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
    await fs.writeFile(path.join(out,label+'.log'),String(result.stdout??'')+String(result.stderr??''));
    assert.equal(result.status,0,`${label}: ${result.error??result.stderr}`);assert(!/SCRIPT ERROR|ERROR:/.test(result.stdout+result.stderr),`${label} reported an engine error`);
  }
  report.engine=JSON.parse(await fs.readFile(path.join(project,'observed.json'),'utf8'));assert(report.engine.checks.length>=10);report.passed=true;
});
