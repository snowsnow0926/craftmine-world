// Real core planning/CAS/lock tests. No engine, model, product profile or input.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
import {packStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),binary=process.env.CRAFTMINE_CORE_BIN;
const enabled={skip:!binary};
function zip(id,{uid='uid://b'+sha(id).slice(0,11),missingUid=false,body='',compatibility={},interfaces={}}={}){
 const files={'component.gd':Buffer.from('extends Node3D\n@export var entity_id: String = ""\n'+body),'component.tscn':Buffer.from('[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://addons/'+id+'/component.gd" id="1"]\n[node name="Component" type="Node3D"]\nscript = ExtResource("1")\n')};
 if(!missingUid)files['component.gd.uid']=Buffer.from(uid+'\n');
 const content={assetId:id,version:1,kind:'object',files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],entry:{entities:['root'],sceneInstall:{mode:'instance',sceneFile:'component.tscn',identityField:'entity_id'}},interfaces,compatibility,state:{},licenses:{}};
 const bytes=packStaticPackage({root:{id,version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files}]});return {archiveBase64:bytes.toString('base64'),archiveSha256:sha(bytes)};
}
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'group-source-core-')),core=new CoreClient(binary,path.join(directory,'data'));
 t.after(async()=>{await core.stop();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'group-source-core-'));await fs.rm(directory,{recursive:true,force:true});});
 const context={projectId:'group-p',sessionId:'group-s',turnId:'group-turn'},worldId='group-world',calls=[];let intercept;
 const call=async(method,args)=>{calls.push({method,args});if(intercept)await intercept(method,args);return core.call(method,args,120000);};await core.start();
 await call('world.create',{id:worldId,title:'Group source fixture',world:{build:{id:'group-base',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});await call('godotProject.create',{context,worldId,toolCallId:'create',baseBuild:'group-base',baseId:'first-person',files:[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},{path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n'}]});await call('content.migrate.apply',{worldId});
 const index=()=>call('godotProject.index',{context,worldId,offset:0,limit:32});
 const binding=async(worldId,operationId)=>{const worldRecord=await call('world.read',{id:worldId}),status=await call('content.status',{worldId}),source=await index();return {context,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:source.branchId,expectedHeadOid:status.branches.find(b=>b.name==='refs/heads/'+source.branchId).oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};};
 const create=()=>createManagedPackageInstaller({call,bind:binding,enqueue:async()=>{},stagingRoot:path.join(directory,'installs')});
 const source=await index(),expectedSource={revision:source.revision,manifestHash:source.manifestHash};calls.length=0;
 const read=async(file)=>{const source=await index();const r=await call('godotProject.read',{context,worldId,revision:source.revision,manifestHash:source.manifestHash,path:file,offset:0,limit:16000});return r.text;};
 const request=(items,operationId='group-install')=>({worldId,operationId,expectedSource,items:items.map(i=>({archiveBase64:i.archiveBase64,...(i.position?{position:i.position}:{})}))});
 return {core,call,calls,index,source,expectedSource,read,create,request,binding,setIntercept(fn){intercept=fn;}};
}
test('same ZIP twice yields independent positioned instances, one lock/body, one source write and one check; replay survives restart',enabled,async t=>{
 const f=await fixture(t),tree=zip('tree'),request=f.request([{...tree,position:{x:-3,y:0,z:0}},{...tree,position:{x:3,y:0,z:0}}]);
 const result=await f.create().group(request);assert.equal(result.applied,false);assert.equal('archiveSha256'in result,false);assert.equal(result.archives.length,2);assert.equal(result.instanceIds.length,2);assert.notEqual(result.instanceIds[0],result.instanceIds[1]);assert.ok(result.archives.every(a=>a.archiveSha256===tree.archiveSha256));assert.deepEqual(result.archives.flatMap(a=>a.instanceIds),result.instanceIds);
 const scene=await f.read('world.tscn');assert.match(scene,/position = Vector3\(-3, 0, 0\)/);assert.match(scene,/position = Vector3\(3, 0, 0\)/);
 const lock=JSON.parse(await f.read('craftmine.assets.lock.json')),instances=JSON.parse(await f.read('craftmine.instances.json'));assert.equal(lock.assets.length,1);assert.equal(instances.instances.length,2);assert.equal(new Set(instances.instances.flatMap(i=>Object.values(i.entityMap))).size,2);
 assert.equal(f.calls.filter(c=>c.method==='godotProject.applyFiles').length,1);assert.equal(f.calls.filter(c=>c.method==='godotBuild.start').length,1);
 const replay=await f.create().group(request);assert.deepEqual(replay.instanceIds,result.instanceIds);assert.equal(f.calls.filter(c=>c.method==='godotProject.applyFiles').length,1);assert.equal(f.calls.filter(c=>c.method==='godotBuild.start').length,1);
 await assert.rejects(f.create().group({...request,items:[request.items[1],request.items[0]]}),/OPERATION_CONFLICT/);
});
test('bad second package, compatibility mismatch, version content conflict and duplicate UID leave original source untouched',enabled,async t=>{
 const f=await fixture(t);const cases=[
  [zip('good'),zip('bad',{missingUid:true})],
  [zip('good'),zip('bad',{compatibility:{base:'side-view'}})],
  [zip('same'),zip('same',{body:'# different content\n'})],
  [zip('one',{uid:'uid://bconflict'}),zip('two',{uid:'uid://bconflict'})],
  [zip('one',{interfaces:{inputActions:['custom_action']}}),zip('two',{interfaces:{inputActions:['custom_action']}})],
 ];
 for(const [i,items]of cases.entries()){
  await assert.rejects(f.create().group(f.request(items,'failed-group-'+i)),/MISSING_SCRIPT_UID|DRAFT_CONFLICT|PLAN_CONFLICT|RESOURCE_CONFLICT|UID_CONFLICT|DECLARATION_CONFLICT/);
  const after=await f.index();assert.equal(after.revision,f.source.revision);assert.equal(after.manifestHash,f.source.manifestHash);assert.deepEqual(after.files,f.source.files);
 }
 assert.equal(f.calls.some(c=>c.method==='godotProject.applyFiles'||c.method==='godotBuild.start'),false);
});

test('different archives retain ordered receipts and recover a lost atomic commit reply without duplicating instances',enabled,async t=>{
 const f=await fixture(t),tree=zip('tree'),wall=zip('wall'),request=f.request([tree,{...wall,position:{x:4,y:0,z:-2}}]);let lost=false;
 f.setIntercept(async(method,args)=>{
  if(method!=='godotProject.applyFiles'||lost)return;lost=true;
  await f.core.call(method,args,120000);throw Error('SIMULATED_REPLY_LOST');
 });
 await assert.rejects(f.create().group(request),/SIMULATED_REPLY_LOST/);
 const committed=await f.index();assert.equal(committed.revision,f.source.revision+1);assert.equal(f.calls.some(c=>c.method==='godotBuild.start'),false);
 const result=await f.create().group(request);assert.deepEqual(result.archives.map(a=>a.archiveSha256),[tree.archiveSha256,wall.archiveSha256]);assert.deepEqual(result.archives.flatMap(a=>a.instanceIds),result.instanceIds);
 assert.equal((await f.index()).revision,committed.revision);assert.equal(JSON.parse(await f.read('craftmine.assets.lock.json')).assets.length,2);assert.equal(JSON.parse(await f.read('craftmine.instances.json')).instances.length,2);assert.equal(f.calls.filter(c=>c.method==='godotBuild.start').length,1);
});
test('missing/stale expected source and invalid group size reject before any source write',enabled,async t=>{
 const f=await fixture(t),item=zip('tree'),request=f.request([item,item]);
 await assert.rejects(f.create().group({...request,expectedSource:{...f.expectedSource,revision:f.expectedSource.revision+1}}),/PROPOSAL_SOURCE_CHANGED/);
 await assert.rejects(f.create().group({...request,expectedSource:undefined}),/SOURCE_IDENTITY_REQUIRED/);
 await assert.rejects(f.create().group({...request,items:[request.items[0]]}),/GROUP_ITEM_LIMIT/);
 await assert.rejects(f.create().group({...request,items:Array(9).fill(request.items[0])}),/GROUP_ITEM_LIMIT/);
 assert.equal(f.calls.some(c=>c.method==='package.planInstall'||c.method==='godotProject.applyFiles'),false);
});
test('CAS rejects a concurrent real source edit after group preflight without writing any component',enabled,async t=>{
 const f=await fixture(t),item=zip('tree'),request=f.request([item,item]);let changed=false;
 f.setIntercept(async(method,args)=>{
  if(method!=='godotProject.applyFiles'||changed)return;changed=true;
  const sourceFile=f.source.files.find(f=>f.path==='world.tscn');
  await f.core.call('godotProject.applyFiles',{...args,toolCallId:'concurrent-edit',operation:{...args.operation,operationId:'concurrent-edit'},files:[{path:'world.tscn',expectedHash:sourceFile.sha256,bytesBase64:Buffer.from('[gd_scene format=3]\n[node name="World" type="Node3D"]\n; concurrent edit\n').toString('base64')}]},120000);
 });
 await assert.rejects(f.create().group(request),/STALE|CONFLICT/);assert.equal(changed,true);const after=await f.index();assert.equal(after.files.length,f.source.files.length);assert.equal(after.files.some(f=>f.path.startsWith('addons/')),false);assert.equal(f.calls.some(c=>c.method==='godotBuild.start'),false);
});
