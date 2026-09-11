import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../../plugins/craftmine-world/package-format.mjs';
import {createManagedPackageInstaller} from '../../plugins/craftmine-world/reuse-service.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files={'door.gd':Buffer.from('extends Node2D\n@export var entity_id: String = \"\"\n'),'door.gd.uid':Buffer.from('uid://btestdoor\n')};
const content={assetId:'door',version:1,kind:'object',files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],entry:{entities:['door'],sceneInstall:{mode:'script-node',script:'door.gd',nodeType:'Node2D',identityField:'entity_id'}},interfaces:{},compatibility:{},state:{},licenses:{}};
const resource={manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files};
const archiveBase64=packStaticPackage({root:{id:'door',version:1},resources:[resource]}).toString('base64');
function fixture(root){
 const calls=[];let applied;
 const sources={'project.godot':'[application]\nrun/main_scene="res://world.tscn"\n','world.tscn':'[gd_scene format=3]\n[node name="World" type="Node2D"]\n'};
 const context={projectId:'p',sessionId:'s',turnId:'t'};
 const call=async(method,args)=>{
  calls.push(method);
  if(method==='godotProject.index')return {worldId:'world',revision:1,manifestHash:'a'.repeat(64),baseId:'top-down',engineVersion:'4.7.2-stable',files:Object.entries(sources).map(([path,text])=>({path,sha256:sha(text),bytes:Buffer.byteLength(text)})),nextOffset:null};
  if(method==='godotProject.read')return {sha256:sha(sources[args.path]),text:sources[args.path],nextOffset:null};
  if(method==='package.planInstall')return {ok:true,applied:false,operationId:args.operationId,worldId:'world',instances:[{instanceId:'ins-door',assetId:'door',version:1,contentHash:resource.manifest.contentHash,installPath:'addons/door',entityMap:{door:'ins-door-e0'},localOverrides:[]}],lock:{format:'craftmine.assets-lock/1',assets:[{asset:{assetId:'door',version:'1',contentHash:resource.manifest.contentHash},installPath:'addons/door',files:content.files.map(f=>({...f,mediaType:'text/plain'})),dependencies:[],overrides:[]}]}};
  if(method==='godotProject.applyFiles'){applied=args;return {revision:2,manifestHash:'b'.repeat(64)};}
  if(method==='godotBuild.start'){assert.equal(args.revision,2);return {jobId:'job-door'};}
  throw Error(method);
 };
 const create=()=>createManagedPackageInstaller({call,bind:async(worldId,operationId)=>({context,operation:{worldId,operationId},worldRecord:{id:worldId,world:{snapshot:{baseVersion:'1.0.0',format:'craftmine.godot-progress/1'}}}}),enqueue:async()=>calls.push('enqueue'),stagingRoot:root});
 return {calls,create,get applied(){return applied;}};
}
test('a real ZIP produces one source transaction before check and can resume after service restart',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'package-caller-')),f=fixture(root),args={worldId:'world',operationId:'install-door',archiveBase64};
 const result=await f.create()(args);assert.equal(result.status,'check-queued');assert.equal(result.applied,false);
 const emitted=new Map(f.applied.files.map(f=>[f.path,Buffer.from(f.bytesBase64,'base64').toString('utf8')]));
 assert.match(emitted.get('world.tscn'),/ins-door-e0/);assert.equal(emitted.get('addons/door/door.gd'),files['door.gd'].toString());assert.ok(emitted.has('craftmine.assets.lock.json'));assert.ok(emitted.has('craftmine.instances.json'));
 assert.ok(f.calls.indexOf('godotProject.applyFiles')<f.calls.indexOf('godotBuild.start'));assert.ok(!f.calls.some(m=>m==='world.update'||m==='package.install'));
 await f.create()(args);assert.equal(f.calls.filter(m=>m==='godotProject.applyFiles').length,1);assert.equal(f.calls.filter(m=>m==='godotBuild.start').length,1);
 await assert.rejects(f.create()({...args,scene:'other.tscn'}),/OPERATION_CONFLICT/);
});
test('pages cannot supply an execution context or filesystem root',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'package-caller-')),f=fixture(root);
 await assert.rejects(f.create()({worldId:'world',operationId:'x',archiveBase64,context:{}}),/UNKNOWN_FIELD/);assert.equal(f.calls.length,0);
});

test('a source proposal cannot install after the captured source changes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'package-proposal-')),f=fixture(root);
 await assert.rejects(f.create()({worldId:'world',operationId:'stale-proposal',archiveBase64,expectedSource:{revision:0,manifestHash:'a'.repeat(64)}}),/PACKAGE_PROPOSAL_SOURCE_CHANGED/);
 assert.equal(f.calls.includes('package.planInstall'),false);assert.equal(f.applied,undefined);
 const result=await f.create()({worldId:'world',operationId:'current-proposal',archiveBase64,expectedSource:{revision:1,manifestHash:'a'.repeat(64)}});
 assert.equal(result.status,'check-queued');
});
