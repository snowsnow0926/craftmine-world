import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createCreationSourceService}=require('../plugins/craftmine-world/creation-source-service.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const context={projectId:'p',sessionId:'s',turnId:'t'},workspace={worldId:'alpha',task:{binding:{...context,taskId:'task',baseBuild:'formal-build'}}};
 const start={};for(let i=0;i<40;i++)start[`a-${i}.gd`]='extends Node\n';
 start['world/creation.json']=JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities:[]})+' '.repeat(40000);
 const formalFiles=structuredClone(start),versions=new Map([[1,start]]),receipts=new Map(),calls=[];let current=1,failReply=false;
 const manifest=n=>hash('manifest-'+n),bound={format:'craftmine.creation-target/1',worldId:'alpha',buildId:'formal-build',instanceId:'instance',sourceRevision:1,manifestHash:manifest(1),snapshotId:'host-capture',sampledAt:new Date().toISOString(),playerPosition:[0,.9,0],target:{surface:'ground',entityId:null,position:[4,0,4],normal:[0,1,0],revision:1}};
 const live={worldId:'alpha',buildId:'formal-build',instanceId:'instance',sampledAt:new Date().toISOString(),player:{position:[0,.9,0]}};
 const core={call:async(method,args)=>{
  calls.push({method,args});
  if(method==='godotRuntime.exportSource')return {worldId:'alpha',buildId:bound.buildId,baseId:'creation-sandbox',sourceRevision:bound.sourceRevision,files:Object.entries(formalFiles).map(([path,text])=>({path,bytes:Buffer.byteLength(text),sha256:hash(text)}))};
  if(method==='godotProject.index'){
   const rev=args.revision??current;assert.equal(args.manifestHash??manifest(rev),manifest(rev));const source=versions.get(rev);assert.ok(source);
   const all=Object.keys(source).sort().map(path=>({path,sha256:hash(source[path]),bytes:Buffer.byteLength(source[path])}));const files=all.slice(args.offset,args.offset+args.limit);
   return {worldId:'alpha',baseId:'creation-sandbox',baseBuild:'ancestral-build',branchId:'main',revision:rev,manifestHash:manifest(rev),files,nextOffset:args.offset+files.length<all.length?args.offset+files.length:null};
  }
  if(method==='godotProject.read'){
   assert.ok(args.limit<=16000);const text=versions.get(args.revision)[args.path],chars=[...text];
   return {...args,sha256:hash(text),text:chars.slice(args.offset,args.offset+args.limit).join(''),nextOffset:args.offset+args.limit<chars.length?args.offset+args.limit:null};
  }
  if(method==='godotProject.receipt'){const found=receipts.get(args.toolCallId);if(!found)return null;assert.deepEqual(args.request,found.args);return found.result;}
  if(method==='godotProject.patch'){
   assert.equal(args.revision,current);const next={...versions.get(current)};for(const op of args.operations){assert.equal(op.expectedHash,next[op.path]===undefined?null:hash(next[op.path]));next[op.path]=op.text;}
   const result={revision:++current,manifestHash:manifest(current)};versions.set(current,next);receipts.set(args.toolCallId,{args:structuredClone(args),result});if(failReply){failReply=false;throw Error('Lost reply');}return result;
  }throw Error(method);
 }};
 const execute=createCreationSourceService({core,capture:async()=>structuredClone(bound),sample:async()=>structuredClone(live),assertActive:()=>{}});
 const request=(operationId='tree',revision=current,position=[4,0,4])=>({operationId,expected:{worldId:'alpha',buildId:'formal-build',instanceId:'instance',revision,manifestHash:manifest(revision),targetSnapshotId:'host-capture'},action:'place',kind:'tree',position});
 return {calls,bound,live,request,versions,run:request=>execute({context,workspace,request}),lose:()=>{failReply=true;},current:()=>current};
}
test('host-bound target uses formal build, pages real Rust limits, and advances own multi-operation source',async()=>{
 const f=fixture();const first=await f.run(f.request());assert.equal(first.source.revision,2);assert.equal(first.applied,false);
 const second=await f.run(f.request('second',2,[9,0,4]));assert.equal(second.source.revision,3);
 const scene=JSON.parse(f.versions.get(3)['world/creation.json']);assert.equal(scene.entities.length,2);
 assert.ok(f.calls.filter(c=>c.method==='godotProject.index').length>=4);assert.ok(f.calls.filter(c=>c.method==='godotProject.read').length>=4);
});
test('a committed lost reply is read exactly once and does not duplicate a placement',async()=>{
 const f=fixture(),request=f.request();f.lose();const saved=await f.run(request);assert.equal(saved.source.revision,2);
 const replay=await f.run(request);assert.equal(replay.replayed,true);assert.equal(f.current(),2);assert.equal(f.calls.filter(c=>c.method==='godotProject.patch').length,1);
});
test('forged snapshot binding, switched runtime and current player collision cannot write',async()=>{
 const f=fixture();const forged=f.request();forged.expected.targetSnapshotId='invented';await assert.rejects(f.run(forged),/TARGET_IDENTITY/);
 f.live.instanceId='replacement';await assert.rejects(f.run(f.request()),/TARGET_STALE/);f.live.instanceId='instance';
 f.live.player.position=[4,.9,4];await assert.rejects(f.run(f.request()),/PLAYER_OVERLAP/);assert.equal(f.current(),1);
});
test('a wrong operation replay payload cannot silently replace the prior receipt',async()=>{
 const f=fixture(),request=f.request();await f.run(request);await assert.rejects(f.run({...request,color:'#123456'}));assert.equal(f.current(),2);
});
test('a new task may reindex identical formal bytes but unrelated source is never rebased',async()=>{
 const f=fixture();f.bound.sourceRevision=7;f.bound.manifestHash=hash('older-task-manifest');
 const result=await f.run(f.request());assert.equal(result.source.revision,2);assert.ok(f.calls.some(c=>c.method==='godotRuntime.exportSource'));
 const bad=fixture();bad.bound.sourceRevision=7;bad.bound.manifestHash=hash('older-task-manifest');bad.versions.get(1)['a-0.gd']='extends Node\n# unrelated edit';
 await assert.rejects(bad.run(bad.request()),/SOURCE_CHANGED_RECAPTURE/);assert.equal(bad.current(),1);
});
