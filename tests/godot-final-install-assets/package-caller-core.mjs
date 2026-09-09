// Real Rust + real package bytes. No executor registration, engine launch, or model.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
import {packStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const binary=process.env.CRAFTMINE_CORE_BIN;if(!binary)throw Error('CRAFTMINE_CORE_BIN required');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'real-package-core-'));
const core=new CoreClient(binary,path.join(root,'data')),context={projectId:'project-a',sessionId:'session-a',turnId:'one'};
let result;
try {
 await core.start();const call=(m,a)=>core.call(m,a,60000);
 await call('world.create',{id:'a',title:'A',world:{build:{id:'base-a',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
 await call('workspace.open',{context,selectedWorld:'a'});
 await call('godotProject.create',{context,worldId:'a',toolCallId:'create',baseBuild:'base-a',baseId:'first-person',files:[{path:'project.godot',text:'config_version=5\n[application]\nrun/main_scene="res://world.tscn"\n'},{path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n'}]});
 await call('content.migrate.apply',{worldId:'a'});
 const files={'door.gd':Buffer.from('extends Node3D\n@export var entity_id: String = ""\n'),'door.gd.uid':Buffer.from('uid://btestdoor\n')};
 const content={assetId:'door',version:1,kind:'object',files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],entry:{entities:['door'],sceneInstall:{mode:'script-node',script:'door.gd',nodeType:'Node3D',identityField:'entity_id'}},interfaces:{},compatibility:{},state:{},licenses:{}};
 const archiveBase64=packStaticPackage({root:{id:'door',version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files}]}).toString('base64');
 const installer=createManagedPackageInstaller({call,stagingRoot:path.join(root,'staging'),bind:async(worldId,operationId)=>{const status=await call('content.status',{worldId});const worldRecord=await call('world.read',{id:worldId});return {context,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:'main',expectedHeadOid:status.headOid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};},enqueue:async()=>{throw Error('unexpected executor enqueue');}});
 result=await installer({operationId:'install-real-door',worldId:'a',archiveBase64});
 assert.equal(result.status,'source-saved-check-blocked');assert.equal(result.applied,false);
 const index=await call('godotProject.index',{context,worldId:'a',offset:0,limit:32});
 assert.equal(index.revision,result.source.revision);const paths=index.files.map(f=>f.path);
 for(const name of ['addons/door/door.gd','addons/door/door.gd.uid','craftmine.instances.json','craftmine.assets.lock.json'])assert.ok(paths.includes(name),name);
 const scene=await call('godotProject.read',{context,worldId:'a',revision:index.revision,manifestHash:index.manifestHash,path:'world.tscn',offset:0,limit:16000});assert.match(scene.text,/ins-[a-f0-9]+-e0/);
 const second=await installer({operationId:'install-second-door',worldId:'a',archiveBase64});
 const map=await call('godotProject.read',{context,worldId:'a',revision:second.source.revision,manifestHash:second.source.manifestHash,path:'craftmine.instances.json',offset:0,limit:16000});assert.equal(JSON.parse(map.text).instances.length,2);
 const both=await call('godotProject.read',{context,worldId:'a',revision:second.source.revision,manifestHash:second.source.manifestHash,path:'world.tscn',offset:0,limit:16000});assert.equal((both.text.match(/entity_id = /g)||[]).length,2);
 const formal=await call('world.read',{id:'a'});assert.equal(formal.world.build.id,'base-a');
 console.log(JSON.stringify({passed:true,root,coreSha256:sha(await fs.readFile(binary)),source:result.source,jobStatus:result.job.status,formalBuildUnchanged:true,twoIndependentInstances:true}));
}finally{await core.stop();}
