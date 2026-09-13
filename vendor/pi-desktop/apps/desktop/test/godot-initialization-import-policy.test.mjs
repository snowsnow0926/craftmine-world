import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
import test from 'node:test';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {createGodotWorldInitializer}=await import('../electron/main/godot-world-initialization.ts');
const sha=b=>createHash('sha256').update(b).digest('hex');

// Real initialization filtering and batching; a controlled domain fixture is
// used here. Native index/read and publication are tested separately.
async function run(t,source){
 const worldsRoot=fs.mkdtempSync(path.join(os.tmpdir(),'cm-init-policy-'));
 t.after(()=>fs.rmSync(worldsRoot,{recursive:true,force:true}));
 const worldId='world-import-policy',directory=path.join(worldsRoot,worldId);
 const files=Object.entries({'project.godot':'config_version=5\n',...source}).map(([name,value])=>{const bytes=Buffer.from(value),full=path.join(directory,name);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,bytes);return {path:name,bytes:bytes.length,sha256:sha(bytes)};});
 fs.writeFileSync(path.join(directory,'managed-base.json'),JSON.stringify({worldId,baseId:'creation-sandbox',files}));
 const received=new Map([['project.godot',Buffer.from('config_version=5\n')]]),batches=[];
 const domain=async(method,args)=>{
  if(method==='godotWorld.initStatus')return {worldId,status:'pending',playable:false};
  if(method==='turn.begin')return {binding:{taskId:'task-policy',baseBuild:'creation-sandbox-1.0.0'}};
  if(method==='godotProject.index')return {revision:1,manifestHash:'a'.repeat(64),files:[...received].map(([path,b])=>({path,sha256:sha(b)})),nextOffset:null};
  if(method==='content.status')return {backend:'git'};
  if(method==='godotProject.applyFiles'){
   batches.push(args.files);
   for(const f of args.files)if(f.path.endsWith('.glb.import'))assert(received.has(f.path.slice(0,-7))||args.files.some(model=>model.path===f.path.slice(0,-7)),'paired model must already be installed or in this batch');
   for(const f of args.files)received.set(f.path,Buffer.from(f.bytesBase64,'base64'));
   return {revision:2,manifestHash:'a'.repeat(64)};
  }
  if(method==='godotCandidate.list')return {items:[{status:'ready',manifestHash:'a'.repeat(64),candidateId:'candidate-fixture'}]};
  if(method==='workspace.endTurn')return {};
  throw Error('UNEXPECTED_DOMAIN:'+method);
 };
 const initializer=createGodotWorldInitializer({worldsRoot,domain,selection:async()=>worldId,firstLoad:async()=>{}});
 await initializer.start(worldId);return {error:initializer.error(worldId),received,batches};
}
test('template initialization preserves paired GLB policy bytes and excludes generated cache/arbitrary import files',async t=>{
 const policy='[remap]\nimporter="scene"\n[params]\nmeshes/ensure_tangents=true\n';
 const result=await run(t,{'addons/pet/model.glb.import':policy,'addons/pet/model.glb':'measured-model-fixture','addons/pet/unrelated.import':'cache','.godot/imported/stray.gd':'cache','.godot/cache.json':'{}'});
 assert.equal(result.error,null);assert.equal(result.received.get('addons/pet/model.glb.import').toString(),policy);
 assert.deepEqual([...result.received.keys()].sort(),['addons/pet/model.glb','addons/pet/model.glb.import','project.godot']);
});
test('orphan authored import policy fails explicitly rather than silently disappearing',async t=>{
 const result=await run(t,{'addons/pet/model.glb.import':'policy'});
 assert.match(result.error,/MANAGED_BASE_IMPORT_MODEL_REQUIRED/);assert.equal(result.batches.length,0);
});
test('large preceding content may split batches without sending the import policy before its GLB',async t=>{
 const result=await run(t,{'assets/a.json':'x'.repeat(4*1024*1024),'models/model.glb.import':'policy','models/model.glb':'x'.repeat(2*1024*1024)});
 assert.equal(result.error,null);assert.equal(result.batches.length,2);assert(result.received.has('models/model.glb.import'));
});
