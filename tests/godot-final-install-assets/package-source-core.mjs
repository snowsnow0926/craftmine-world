// Author-controlled door fixture. Real source/ZIP/Rust and optional pinned headless engine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageSourceService,createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'package-source-')),core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(root,'data'));
const call=async(m,p)=>{const result=await core.call(m,p,120000);if(m==='package.planInstall'&&!result.ok)console.log('PLAN_REJECTION '+JSON.stringify(result));return result;},contexts=Object.fromEntries(['a','b','c'].map(id=>[id,{projectId:'p-'+id,sessionId:'s-'+id,turnId:'one'}]));
const project='config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n';
const base='class_name Interactable\nextends StaticBody3D\n@export var entity_id: String = ""\n';
const door='class_name PackageDoor\nextends Interactable\nvar opened := false\nfunc _ready() -> void:\n\tadd_to_group("fixture_doors")\nfunc interact() -> Dictionary:\n\topened = not opened\n\treturn {"opened": opened, "entity_id": entity_id}\n';
const scene='[gd_scene load_steps=4 format=3]\n\n[ext_resource type="Script" path="res://door.gd" id="1"]\n[sub_resource type="BoxShape3D" id="Shape"]\nsize = Vector3(1, 2, 0.2)\n[sub_resource type="BoxMesh" id="Mesh"]\nsize = Vector3(1, 2, 0.2)\n[node name="World" type="Node3D"]\n[node name="Door" type="StaticBody3D" parent="."]\nscript = ExtResource("1")\nentity_id = "source-door"\n[node name="Collision" type="CollisionShape3D" parent="Door"]\nshape = SubResource("Shape")\n[node name="Mesh" type="MeshInstance3D" parent="Door"]\nmesh = SubResource("Mesh")\n';
const checks=[];
try {
 await core.start();
 for(const worldId of ['a','b','c']) {
  await call('world.create',{id:worldId,title:worldId,world:{build:{id:'base-'+worldId,scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
  await call('workspace.open',{context:contexts[worldId],selectedWorld:worldId});
  const files=[{path:'project.godot',text:project},{path:'world.tscn',text:worldId==='a'?scene.replace(/\n/g,'\r\n'):'[gd_scene format=3]\n[node name="World" type="Node3D"]\n'},{path:'scripts/core/interactable.gd',text:base+(worldId==='c'?'# incompatible local override\n':'')}];if(worldId==='a')files.push({path:'door.gd',text:door});
  await call('godotProject.create',{context:contexts[worldId],worldId,toolCallId:'create',baseBuild:'base-'+worldId,baseId:'first-person',files});await call('content.migrate.apply',{worldId});
 }
 const source=createManagedPackageSourceService({call,bind:async worldId=>({context:contexts[worldId],worldRecord:await call('world.read',{id:worldId})})});
 const listed=await source.listSource({worldId:'a'});assert.equal(listed.mainScene,'world.tscn');assert.equal(listed.items.length,1);assert.equal(listed.items[0].nodePath,'Door');checks.push('actual entry scene lists one independent door');
 const exported=await source.exportSource({worldId:'a',revision:listed.revision,manifestHash:listed.manifestHash,nodePath:'Door',assetId:'reusable-door',version:1});
 const archive=unpackStaticPackage(Buffer.from(exported.archiveBase64,'base64')),resource=archive.resources[0];
 assert.equal(resource.files.has('project.godot'),false);assert.equal(resource.files.has('world.tscn'),false);
 const extracted=resource.files.get('_craftmine_component.tscn').toString('utf8');assert.match(extracted,/parent="\."/);assert.match(extracted,/CollisionShape3D/);assert.match(extracted,/MeshInstance3D/);assert.match(extracted,/res:\/\/addons\/reusable-door\/door.gd/);assert.equal(resource.manifest.content.entry.sourceRequirements[0].path,'scripts/core/interactable.gd');checks.push('ZIP contains subtree, collision, mesh and exact base class requirement');
 await assert.rejects(source.exportSource({worldId:'a',revision:listed.revision,manifestHash:listed.manifestHash,nodePath:'.',assetId:'whole-world',version:1}),/COMPONENT_IDENTITY|SELECT_COMPONENT/);checks.push('whole world cannot masquerade as component');
 const installer=createManagedPackageInstaller({call,stagingRoot:path.join(root,'staging'),bind:async(worldId,operationId)=>{const status=await call('content.status',{worldId}),worldRecord=await call('world.read',{id:worldId});return {context:contexts[worldId],worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:'main',expectedHeadOid:status.headOid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};},enqueue:async()=>{throw Error('No test executor registered');}});
 await assert.rejects(installer({worldId:'c',operationId:'reject-wrong-base',archiveBase64:exported.archiveBase64}),/PACKAGE_BASE_SOURCE_MISMATCH/);assert.equal((await call('godotProject.index',{context:contexts.c,worldId:'c',offset:0,limit:32})).revision,0);checks.push('mismatched base script rejected without changing source');
 const first=await installer({worldId:'b',operationId:'import-door-first',archiveBase64:exported.archiveBase64}),second=await installer({worldId:'b',operationId:'import-door-second',archiveBase64:exported.archiveBase64});assert.notDeepEqual(first.instanceIds,second.instanceIds);assert.equal(second.status,'source-saved-check-blocked');assert.equal((await call('world.read',{id:'b'})).world.build.id,'base-b');checks.push('two cross-world installs create independent identities and real blocked checks');
 const target=path.join(root,'authored-imported-project');await fs.mkdir(target);let offset=0;
 do {const index=await call('godotProject.index',{context:contexts.b,worldId:'b',revision:second.source.revision,manifestHash:second.source.manifestHash,offset,limit:32});for(const file of index.files){let next=0;const parts=[];do{const part=await call('godotProject.read',{context:contexts.b,worldId:'b',revision:index.revision,manifestHash:index.manifestHash,path:file.path,offset:next,limit:16000});parts.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text));next=part.nextOffset;}while(next!==null&&next!==undefined);await fs.mkdir(path.dirname(path.join(target,file.path)),{recursive:true});await fs.writeFile(path.join(target,file.path),Buffer.concat(parts));}offset=index.nextOffset;}while(offset!==null&&offset!==undefined);
 const map=JSON.parse(await fs.readFile(path.join(target,'craftmine.instances.json'),'utf8'));assert.equal(map.instances.length,2);
 if(process.env.CRAFTMINE_GODOT_CACHE_DIR) {
  const probe=await createGodotProbeEnvironment(root);
  await probe.run('import-authored-door',['--path',target,'--editor','--import','--quit']);
  await fs.writeFile(path.join(target,'acceptance.gd'),'extends SceneTree\nfunc _initialize():\n\tcall_deferred("check_door")\nfunc check_door():\n\tvar world = load("res://world.tscn").instantiate()\n\troot.add_child(world)\n\tvar doors = get_nodes_in_group("fixture_doors")\n\tassert(doors.size() == 2)\n\tassert(doors[0].entity_id != doors[1].entity_id)\n\tassert(doors[0].get_node("Collision") is CollisionShape3D)\n\tassert(doors[0].interact().opened == true)\n\tassert(doors[1].opened == false)\n\tassert(doors[1].interact().opened == true)\n\tprint("INDEPENDENT_DOORS_CONFIRMED")\n\tworld.queue_free()\n\tquit(0)\n');
  const output=await probe.run('interact-authored-doors',['--path',target,'--script','res://acceptance.gd']);assert.match(output,/INDEPENDENT_DOORS_CONFIRMED/);checks.push('pinned real Godot imports scene and independently interacts with two doors');
 }
 console.log(JSON.stringify({passed:true,root,checks,coreSha256:createHash('sha256').update(await fs.readFile(process.env.CRAFTMINE_CORE_BIN)).digest('hex'),archiveSha256:exported.archiveSha256,source:second.source}));
}finally{await core.stop();}
