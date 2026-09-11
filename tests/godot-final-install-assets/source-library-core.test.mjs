// Real Rust catalog -> modern proposal -> existing source installer. No model/engine/UI.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {packStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
import {createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
const {createSourceLibraryService}=createRequire(import.meta.url)('../../plugins/craftmine-world/source-library-service.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
test('real immutable catalog registration reaches normal Godot draft installation without legacy package conversion',{skip:!process.env.CRAFTMINE_CORE_BIN},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'source-library-core-')),core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(root,'data'));
 t.after(async()=>{await core.stop();await fs.rm(root,{recursive:true,force:true});});const calls=[];
 const call=async(method,args)=>{calls.push(method);return core.call(method,args,120000);};await core.start();
 const worldId='source-world',context={projectId:'source-p',sessionId:'source-s',turnId:'source-turn'};
 await call('world.create',{id:worldId,title:'Source library fixture',world:{build:{id:'base-source',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});
 await call('godotProject.create',{context,worldId,toolCallId:'create',baseBuild:'base-source',baseId:'first-person',files:[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},{path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n'}]});
 await call('content.migrate.apply',{worldId});
 const files={'tree.gd':Buffer.from('extends Node3D\n@export var entity_id: String = ""\n'),'tree.gd.uid':Buffer.from('uid://b12345678901\n')};
 const content={assetId:'tree',version:1,kind:'object',files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],entry:{entities:['tree'],sceneInstall:{mode:'script-node',script:'tree.gd',nodeType:'Node3D',identityField:'entity_id'}},interfaces:{},compatibility:{},state:{},licenses:{}};
 const zip=packStaticPackage({root:{id:'tree',version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files}]});const file=path.join(root,'tree.zip');await fs.writeFile(file,zip);
 await call('asset.import',{operationId:'seed-source-tree',sourceRoot:root,sourcePath:file,assetId:'builtin.tree',version:1,kind:'object',mediaKind:'package',path:'tree.zip',mediaType:'application/x-godot-package',displayName:'Tree fixture',source:{origin:'fixture',author:'test',license:'CC0-1.0',licenseStatus:'verified'},tags:['builtin','prefab','nature']});
 const record=await call('asset.read',{assetId:'builtin.tree',version:1}),ref={assetId:'builtin.tree',version:1,contentHash:record.version_.contentHash};
 let enqueued=false;
 const installer=createManagedPackageInstaller({call,enqueue:async()=>{enqueued=true;},stagingRoot:path.join(root,'installs'),bind:async(worldId,operationId)=>{
   const worldRecord=await call('world.read',{id:worldId}),status=await call('content.status',{worldId}),index=await call('godotProject.index',{context,worldId,offset:0,limit:1});
   return {context,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:index.branchId,expectedHeadOid:status.branches.find(b=>b.name==='refs/heads/'+index.branchId).oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};
 }});
 const service=createSourceLibraryService({call,installSource:installer,directory:path.join(root,'proposals')});
 const found=await service.tool({mode:'search',query:'Tree'},context,worldId,'search');assert.equal(found.result.items.length,1);
 const proposed=await service.tool({mode:'propose',ref,position:{x:3,y:0,z:-4}},context,worldId,'proposal');assert.notEqual(ref.contentHash,proposed.rootRef.sha256);
 const before=await call('godotProject.index',{context,worldId,offset:0,limit:1});assert.equal(before.revision,proposed.proposal.source.revision);
 const installed=await service.installProposal({worldId,proposalId:proposed.proposal.proposalId});assert.equal(installed.applied,false);assert.ok(['check-queued','source-saved-check-blocked'].includes(installed.status));
 const after=await call('godotProject.index',{context,worldId,offset:0,limit:32});assert.ok(after.files.some(f=>f.path==='addons/tree/tree.gd'));assert.ok(after.files.some(f=>f.path==='craftmine.assets.lock.json'));assert.ok(after.revision>before.revision);
 const installedScene=await call('godotProject.read',{context,worldId,revision:after.revision,manifestHash:after.manifestHash,path:'world.tscn',offset:0,limit:16000});assert.match(installedScene.text,/position = Vector3\(3, 0, -4\)/);
 assert.equal(calls.includes('package.install'),false);assert.equal(calls.includes('package.check'),false);assert.ok(calls.includes('package.planInstall'));assert.ok(calls.includes('godotProject.applyFiles'));assert.ok(calls.includes('godotBuild.start'));
 if(installed.status==='check-queued')assert.equal(enqueued,true);
});
