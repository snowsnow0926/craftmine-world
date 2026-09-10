import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createTargetFeedbackService} from '../../plugins/craftmine-world/target-feedback-service.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'target-feedback-service-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const base=path.resolve(import.meta.dirname,'../../desktop/godot/bases/first-person');
 const files=new Map();for(const name of ['scripts/core/target_dummy.gd','scenes/actors/target_dummy.tscn','scenes/training_range.tscn','scripts/core/base_world.gd','scripts/core/balance_profile.gd','data/balance/training_range.tres','scenes/actors/player.tscn','scripts/core/player_controller.gd'])files.set(name,await fs.readFile(path.join(base,name)));
 files.set('project.godot',Buffer.from('[application]\nrun/main_scene="res://scenes/training_range.tscn"\n'));
 const original=new Map(files),calls=[],receipts=new Map();let revision=5,head='formal-oid',selectedWorld='alpha',lostApply=false,lostBuild=false,failBuild=false,beginCount=0;
 let job={jobId:'job-one',status:'queued',buildId:'new-build',worldId:'alpha'},liveContext=null;
 const inventory=map=>[...map].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}));
 const formalInventory=inventory(original);
 const call=async(method,args)=>{
  calls.push({method,args:clone(args)});
  if(method==='world.read')return {id:'alpha',runtimeKind:'godot',revision:12,world:{build:{id:'formal-build'},snapshot:{doNotTouch:true}}};
  if(method==='content.status')return {backend:'git',repoId:'repo',headOid:head,appliedOid:'formal-oid'};
  if(method==='godotRuntime.exportSource')return {worldId:'alpha',baseId:'first-person',baseVersion:'0.1.0',buildId:'formal-build',repoId:'repo',contentOid:'formal-oid',files:formalInventory};
  if(method==='godotProject.sourceContext')return {context:{projectId:'reader',sessionId:'reader',turnId:'reader'}};
  if(method==='godotProject.index')return {worldId:'alpha',branchId:'main',revision,manifestHash:hash('manifest-'+revision),files:inventory(files),nextOffset:null};
  if(method==='godotProject.read'){const bytes=files.get(args.path);return {sha256:hash(bytes),text:bytes.toString(),nextOffset:null};}
  if(method==='godotProject.applyFiles'){
   assert.equal(args.context,liveContext);assert.equal(args.revision,revision);assert.equal(args.operation.expectedHeadOid,head);assert.equal(args.operation.expectedAppliedOid,'formal-oid');assert.equal(args.operation.expectedProgressRevision,12);
   assert.equal(args.files.length,1);const file=args.files[0];assert.equal(file.expectedHash,hash(files.get(file.path)));files.set(file.path,Buffer.from(file.bytesBase64,'base64'));revision++;head='draft-oid';
   const result={revision,manifestHash:hash('manifest-'+revision)};receipts.set(method,result);if(lostApply)throw Error('lost source receipt');return result;
  }
  if(method==='godotBuild.start'){assert.equal(args.mode,'check');assert.equal(args.revision,revision);if(failBuild)throw Error('check refused');receipts.set(method,clone(job));if(lostBuild)throw Error('lost job receipt');return clone(job);}
  if(['godotProject.receipt','godotBuild.receipt'].includes(method))return clone(receipts.get(args.method)??null);
  throw Error('Unexpected core call '+method);
 };
 const turns={async finish(context,status){calls.push({method:'finish',status});},watch(){calls.push({method:'watch'});},async readJob(){calls.push({method:'read-finalized-job'});return clone(job);}};
 const options={call,selected:async()=>selectedWorld,begin:async args=>{beginCount++;liveContext=args.context;return {binding:{...args.context,taskId:'task',baseBuild:'formal-build'}};},enqueue:async()=>calls.push({method:'enqueue'}),turns,stagingRoot:root};
 const service=createTargetFeedbackService(options);
 return {service,calls,files,original,options,get beginCount(){return beginCount;},setHead:value=>head=value,setSelected:value=>selectedWorld=value,setLost:()=>{lostApply=true;lostBuild=true;},failBuild:()=>failBuild=true,setJob:value=>job={...job,...value}};
}
async function request(f){const described=await f.service.describe({worldId:'alpha'});return {worldId:'alpha',operationId:'edit-one',targetId:'target_a',binding:described.targets.find(item=>item.targetId==='target_a').binding,values:{hitFlashMilliseconds:800}};}
test('read exposes bounded contract values but no path/source/context; submit writes one scene and checks once',async t=>{
 const f=await fixture(t),args=await request(f);assert.equal(f.beginCount,0);
 assert.ok(!JSON.stringify(args.binding).includes('path'));assert.ok(!JSON.stringify(args.binding).includes('scripts/'));
 const result=await f.service.submit(args);assert.equal(result.applied,false);assert.equal(result.status,'check-queued');assert.equal(result.draftRetained,true);
 assert.equal(f.calls.filter(x=>x.method==='godotProject.applyFiles').length,1);assert.equal(f.calls.filter(x=>x.method==='godotBuild.start').length,1);
 assert.equal(f.calls.filter(x=>/Application|saveProgress/.test(x.method)).length,0);
 for(const [name,bytes]of f.original)if(name!=='scenes/training_range.tscn')assert.deepEqual(f.files.get(name),bytes);
 assert.ok(f.files.get('scenes/training_range.tscn').toString().includes('hit_flash_seconds = 0.8'));
 assert.ok(!JSON.stringify(result).includes('context'));assert.ok(!JSON.stringify(result).includes('bytesBase64'));
});
test('unapplied source and stale target bindings fail before starting a turn',async t=>{
 const f=await fixture(t),args=await request(f);f.setHead('other-draft');await assert.rejects(f.service.submit(args),/UNAPPLIED_DRAFT/);assert.equal(f.beginCount,0);
 f.setHead('formal-oid');args.binding.targetHash='0'.repeat(64);await assert.rejects(f.service.submit(args),/STALE_BINDING/);assert.equal(f.beginCount,0);
});
test('lost core replies use durable receipts; replay after restart and main advancing never writes twice',async t=>{
 const f=await fixture(t),args=await request(f);f.setLost();await f.service.submit(args);
 f.setJob({status:'passed',candidateId:'candidate-one'});const restarted=createTargetFeedbackService(f.options);
 const result=await restarted.submit(args);assert.equal(result.status,'passed');assert.equal(result.job.candidateId,'candidate-one');
 assert.equal(f.calls.filter(x=>x.method==='godotProject.applyFiles').length,1);assert.equal(f.calls.filter(x=>x.method==='godotBuild.start').length,1);assert.equal(f.beginCount,1);
 await assert.rejects(restarted.submit({...args,values:{hitFlashMilliseconds:100}}),/REPLAY_MISMATCH/);
});
test('no-op creates no turn, no draft and no check; wrong world/unknown properties refused',async t=>{
 const f=await fixture(t),args=await request(f);args.values.hitFlashMilliseconds=120;
 assert.equal((await f.service.submit(args)).status,'unchanged');assert.equal(f.beginCount,0);
 assert.equal((await f.service.status({worldId:'alpha',operationId:args.operationId})).draftRetained,false);
 await assert.rejects(f.service.submit({...args,values:{hitFlashMilliseconds:700}}),/REPLAY_MISMATCH/);
 f.setSelected('other');await assert.rejects(f.service.submit(args),/WORLD_CHANGED/);f.setSelected('alpha');
 await assert.rejects(f.service.submit({...args,source:'forged'}),/INVALID_ARGUMENT/);
});
test('source-only failure retains the exact draft and never revives a closed lease or starts a second check',async t=>{
 const f=await fixture(t),args=await request(f);f.failBuild();
 await assert.rejects(f.service.submit(args),/check refused/);
 assert.equal(f.calls.filter(x=>x.method==='finish').length,1);
 const restarted=createTargetFeedbackService(f.options);
 const status=await restarted.status({worldId:'alpha',operationId:args.operationId});
 assert.equal(status.status,'interrupted');assert.equal(status.draftRetained,true);assert.equal(status.retrySameOperation,false);
 const replay=await restarted.submit(args);assert.equal(replay.reason,'TARGET_FEEDBACK_CHECK_REQUIRES_DRAFT_RECOVERY');
 assert.equal(f.beginCount,1);assert.equal(f.calls.filter(x=>x.method==='godotBuild.start').length,1);
 assert.equal(f.calls.filter(x=>x.method==='godotProject.applyFiles').length,1);
 await assert.rejects(restarted.submit({...args,operationId:'another'}),/UNAPPLIED_DRAFT/);
});
test('status goes through finalizing job lifecycle and never reports candidate applied',async t=>{
 const f=await fixture(t),args=await request(f);await f.service.submit(args);f.setJob({status:'failed'});
 const status=await f.service.status({worldId:'alpha',operationId:'edit-one'});assert.equal(status.status,'failed');assert.equal(status.applied,false);assert.equal(status.draftRetained,true);
 assert.equal(f.calls.at(-1).method,'read-finalized-job');
});
test('private ledger refuses hard links, oversized bodies and malformed operation schemas',async t=>{
 const f=await fixture(t),args=await request(f);await f.service.submit(args);
 const files=await fs.readdir(f.options.stagingRoot);assert.equal(files.length,1);assert.ok(files[0].endsWith('.json'));
 const file=path.join(f.options.stagingRoot,files[0]),original=await fs.readFile(file),link=path.join(f.options.stagingRoot,'hard-link');
 await fs.link(file,link);
 await assert.rejects(f.service.status({worldId:'alpha',operationId:args.operationId}),/INTENT_FILE_REFUSED/);
 await fs.unlink(link);await fs.writeFile(file,Buffer.alloc(8*1024*1024+1));
 await assert.rejects(f.service.status({worldId:'alpha',operationId:args.operationId}),/INTENT_FILE_REFUSED/);
 await fs.writeFile(file,JSON.stringify({...JSON.parse(original),format:'wrong'}));
 await assert.rejects(f.service.status({worldId:'alpha',operationId:args.operationId}),/INTENT_INVALID/);
 assert.equal(f.calls.filter(x=>x.method==='godotProject.applyFiles').length,1);
});
