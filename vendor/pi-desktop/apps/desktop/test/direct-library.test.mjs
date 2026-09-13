import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {createDirectLibraryService}=await import('../electron/main/direct-library.ts');
const {validateDirectLibraryRequest}=await import('../src/components/craftmine/assets/direct-library-contract.ts');
const ref={assetId:'selected.pet',version:3,contentHash:'a'.repeat(64)};
const start={action:'start',worldId:'world-test',operationId:'direct-test-0001',ref,position:{x:2,y:0,z:3}};
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cm-direct-library-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const state={status:'unknown',draftRetained:false,instanceIds:[],selected:'world-test',installs:0,applies:0,cancelled:0,eligible:true};
  const calls=[];let release;
  const deps={directory,prepare:async()=>{await state.prepare?.();},captureTarget:async()=>({buildId:'formal-build',instanceId:'instance-original'}),assertTarget:async(world)=>{if(world!==state.selected)throw Error('GODOT_WORLD_CHANGED');},
    domain:async(method,args)=>{calls.push({method,args});
      if(method==='godotBuild.cancel'){state.cancelled++;state.status='cancelled';return {};}
      if(method==='package.sourceJob'){await state.finalizeWait?.();return {status:'passed'};}
      assert.equal(method,'package.request');
      if(args.method==='directInspect'){await state.inspectWait?.();if(state.inspectError)throw state.inspectError;return {eligible:state.eligible,reason:state.eligible?undefined:'DIRECT_LIBRARY_SINGLE_SCENE_REQUIRED',positionSupported:true,compatibility:'unchecked',displayName:'Pet',source:{revision:1,manifestHash:'b'.repeat(64)}};}
      if(args.method==='directInstall'){
        state.installs++;assert.deepEqual(args.args.ref,ref);assert.deepEqual(args.args.position,start.position);assert.deepEqual(args.args.expectedSource,{revision:1,manifestHash:'b'.repeat(64)});
        if(state.delay)await new Promise(resolve=>{release=resolve;});
        Object.assign(state,{status:'checking',draftRetained:true,instanceIds:['instance-new'],jobId:'job-test',candidateId:'candidate-test'});
        if(state.lostReply)throw Error('IPC_LOST_REPLY');
        return {worldId:start.worldId,applied:false,instanceIds:state.instanceIds,job:{id:state.jobId}};
      }
      if(args.method==='directStatus'){await state.statusWait?.();if(state.sourceChanged)throw Error('DIRECT_LIBRARY_SOURCE_CHANGED');return {...state};}
      throw Error(args.method);
    },
    applyVerified:async(worldId,candidateId,target,authorize)=>{state.applies++;await authorize();if(state.duringApply)await state.duringApply();await authorize();state.status='applied';if(state.lostApply)throw Error('IPC_LOST_REPLY');return {status:'applied',worldId,candidateId};},
  };
  const create=()=>createDirectLibraryService(deps);const service=create();
  const settle=async()=>{while(service.isBusy())await new Promise(resolve=>setTimeout(resolve,2));};
  t.after(()=>service.stop());return {service,create,state,calls,settle,directory,release:()=>release?.()};
}
const action=(action)=>({action,worldId:start.worldId,operationId:start.operationId});

test('inspection is read-only; exact explicit start checks once then requires apply with zero model calls',async t=>{
  const f=await fixture(t),s=f.service;
  const info=await s.handle({action:'inspect',worldId:start.worldId,ref});assert.equal(info.compatibility,'unchecked');assert.equal(info.source,undefined);assert.equal(f.state.installs,0);
  await s.handle(start);await f.settle();assert.equal((await s.handle(action('status'))).status,'checking');assert.equal(f.state.applies,0);
  f.state.status='ready';const ready=await s.handle(action('status'));assert.equal(ready.status,'ready');assert.equal(ready.modelCalls,0);assert.deepEqual(ready.ref,ref);
  const applied=await s.handle(action('apply'));assert.equal(applied.status,'applied');assert.equal(f.state.applies,1);
  assert.equal((await s.handle(start)).status,'applied');assert.equal((await s.handle(action('apply'))).status,'applied');assert.equal(f.state.installs,1);assert.equal(f.state.applies,1);
  assert(!JSON.stringify(applied).includes('context'));assert(!f.calls.some(c=>/agent|turn.begin|composer/.test(c.method)));
});

test('lost install acknowledgement reconciles one stable intent; restart never installs again',async t=>{
  const f=await fixture(t);f.state.lostReply=true;await f.service.handle(start);await f.settle();assert.equal((await f.service.handle(action('status'))).status,'checking');
  f.state.status='ready';const restored=f.create();assert.equal((await restored.handle(start)).status,'ready');assert.equal(f.state.installs,1);
  f.state.lostApply=true;assert.equal((await restored.handle(action('apply'))).status,'applied');assert.equal(f.state.applies,1);await restored.stop();
});

test('cancel during install persists before late reply and never applies; retained draft is honest',async t=>{
  const f=await fixture(t);f.state.delay=true;await f.service.handle(start);
  while(!f.state.installs)await new Promise(resolve=>setTimeout(resolve,1));
  const cancelled=await f.service.handle(action('cancel'));assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.draftRetained,false);
  f.release();await f.settle();const late=await f.service.handle(action('status'));assert.equal(late.status,'cancelled');assert.equal(late.draftRetained,true);assert(f.state.cancelled>=1);
  assert.equal((await f.service.handle(action('apply'))).status,'cancelled');assert.equal(f.state.applies,0);
});

test('source changes and selection changes cannot adopt checked content',async t=>{
  const f=await fixture(t);await f.service.handle(start);await f.settle();f.state.status='ready';f.state.sourceChanged=true;
  assert.equal((await f.service.handle(action('apply'))).status,'failed');assert.equal(f.state.applies,0);
  f.state.sourceChanged=false;const other={...start,operationId:'direct-test-0002'};await f.service.handle(other);await f.settle();f.state.status='ready';f.state.selected='another-world';
  const result=await f.service.handle({...action('apply'),operationId:other.operationId});assert.equal(result.status,'failed');assert.equal(result.error.code,'GODOT_WORLD_CHANGED');assert.equal(f.state.applies,0);
});

test('cancellation during candidate launch is rechecked by existing coordinator before commit',async t=>{
  const f=await fixture(t);await f.service.handle(start);await f.settle();f.state.status='ready';
  f.state.duringApply=()=>f.service.handle(action('cancel'));
  const result=await f.service.handle(action('apply'));assert.equal(result.status,'cancelled');assert.notEqual(f.state.status,'applied');
});

test('same operation with changed version or position is refused and raw packages cannot start',async t=>{
  const f=await fixture(t);await f.service.handle(start);await f.settle();
  for(const changed of [{...start,ref:{...ref,version:4}},{...start,position:{x:4,y:0,z:0}}])await assert.rejects(f.service.handle(changed),/OPERATION_CONFLICT/);
  f.state.eligible=false;await assert.rejects(f.service.handle({...start,operationId:'direct-test-unsupported'}),/SINGLE_SCENE_REQUIRED/);assert.equal(f.state.installs,1);
});

test('strict renderer protocol rejects paths, forged source authority, nonfixed refs and unbounded coordinates',()=>{
  for(const bad of [{...start,path:'D:/secret'},{...start,expectedSource:{}},{...start,ref:{...ref,displayName:'extra'}},{...start,ref:{...ref,version:'latest'}},{...start,position:{x:81,y:0,z:0}},{...start,position:{x:NaN,y:0,z:0}},{...start,operationId:'../outside'},{...action('apply'),ref}])assert.throws(()=>validateDirectLibraryRequest(bad));
});

test('orderly shutdown preserves a checked ready operation for explicit same-build restart adoption',async t=>{
  const f=await fixture(t);await f.service.handle(start);await f.settle();f.state.status='ready';
  assert.equal((await f.service.handle(action('status'))).status,'ready');
  await f.service.stop();assert.equal(f.state.cancelled,0);
  const restarted=f.create();assert.equal((await restarted.handle(action('status'))).status,'ready');
  assert.equal(f.state.applies,0);assert.equal((await restarted.handle(action('apply'))).status,'applied');
  assert.equal(f.state.installs,1);await restarted.stop();
});

test('status and identical start retries join the reservation before native preflight or file persistence',async t=>{
  const f=await fixture(t);let release;const gate=new Promise(resolve=>{release=resolve;});let entered;const prepared=new Promise(resolve=>{entered=resolve;});
  f.state.prepare=async()=>{entered();await gate;};
  const initial=f.service.handle(start),early=f.service.handle(action('status')),retry=f.service.handle(start);
  await prepared;assert.equal(f.service.isBusy(),true);assert.equal((await fs.readdir(f.directory)).length,0);
  await assert.rejects(f.service.handle({...start,position:{x:3,y:0,z:3}}),/OPERATION_CONFLICT/);
  release();const results=await Promise.all([initial,early,retry]);await f.settle();
  assert(results.every(r=>r.operationId===start.operationId));assert.equal(f.state.installs,1);
});

test('cancel before start persistence fences installation and survives an identical initialization retry',async t=>{
  const f=await fixture(t);let release;const gate=new Promise(resolve=>{release=resolve;});let entered;const prepared=new Promise(resolve=>{entered=resolve;});
  f.state.prepare=async()=>{entered();await gate;};
  const initial=f.service.handle(start),early=f.service.handle(action('status'));
  await prepared;const cancellation=f.service.handle(action('cancel')),retry=f.service.handle(start);
  assert.equal((await fs.readdir(f.directory)).length,0);release();
  const results=await Promise.all([initial,early,cancellation,retry]);assert(results.every(r=>r.status==='cancelled'));assert.equal(f.state.installs,0);
  assert.equal((await f.create().handle(action('status'))).status,'cancelled');
});

test('unknown ids have bounded not-found errors; all public action failures exclude paths and stacks',async t=>{
  const f=await fixture(t),s=f.service;
  for(const kind of ['status','cancel','apply'])await assert.rejects(s.handle(action(kind)),error=>{
    assert.equal(error.code,'DIRECT_LIBRARY_OPERATION_NOT_FOUND');assert.equal(error.message,error.code);assert.equal(error.stack,error.code);assert(!JSON.stringify(error).includes(f.directory));return true;
  });
  f.state.inspectError=Object.assign(Error(`ENOENT: secret source at ${f.directory}/secret.bin`),{code:'ENOENT',path:f.directory});
  for(const request of [{action:'inspect',worldId:start.worldId,ref},start])await assert.rejects(s.handle(request),error=>{
    assert.equal(error.message,'ENOENT');assert.equal(error.stack,'ENOENT');assert.equal(error.path,undefined);assert(!JSON.stringify(error).includes(f.directory));return true;
  });
  // Failed initialization releases the reservation; retry creates just once.
  f.state.inspectError=null;await s.handle(start);await f.settle();assert.equal(f.state.installs,1);
  f.state.status='ready';f.state.prepare=async()=>{throw Error(`private failure ${f.directory}`);};
  const failed=await s.handle(action('apply'));assert.equal(failed.status,'failed');assert.equal(failed.error.code,'DIRECT_LIBRARY_OPERATION_FAILED');assert(!JSON.stringify(failed).includes(f.directory));
});

test('another operation cannot apply while a new start owns asynchronous preflight',async t=>{
  const f=await fixture(t);await f.service.handle(start);await f.settle();f.state.status='ready';
  assert.equal((await f.service.handle(action('status'))).status,'ready');
  let release;const gate=new Promise(resolve=>{release=resolve;});let entered;const prepared=new Promise(resolve=>{entered=resolve;});
  f.state.prepare=async()=>{entered();await gate;};
  const next={...start,operationId:'direct-test-overlap'},pending=f.service.handle(next);
  await prepared;assert.equal(f.service.isBusy(),true);
  await assert.rejects(f.service.handle(action('apply')),error=>error.code==='WORLD_BUSY');
  assert.equal(f.state.applies,0);release();await pending;await f.settle();assert.equal(f.state.installs,2);
});

test('concurrent read-only inspections share work but a later inspection verifies again',async t=>{
 const f=await fixture(t);let release;f.state.inspectWait=()=>new Promise(resolve=>{release=resolve;});
 const reads=Array.from({length:8},()=>f.service.handle({action:'inspect',worldId:start.worldId,ref}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.filter(c=>c.args.method==='directInspect').length,1);
 release();await Promise.all(reads);f.state.inspectWait=undefined;f.state.inspectError=Error('SOURCE_LIBRARY_ASSET_CHANGED');
 await assert.rejects(f.service.handle({action:'inspect',worldId:start.worldId,ref}),/SOURCE_LIBRARY_ASSET_CHANGED/);
 assert.equal(f.calls.filter(c=>c.args.method==='directInspect').length,2);
});
test('concurrent status uses one native read and timing excludes later polling delay',async t=>{
 const f=await fixture(t);await f.service.handle(start);await f.settle();const before=f.calls.filter(c=>c.args.method==='directStatus').length;
 f.state.status='ready';f.state.checkProgress={stage:'check',percent:85};f.state.checkFinishedAt=Date.now();let release;f.state.statusWait=()=>new Promise(resolve=>{release=resolve;});
 const reads=Array.from({length:6},()=>f.service.handle(action('status')));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.filter(c=>c.args.method==='directStatus').length-before,1);release();const results=await Promise.all(reads);f.state.statusWait=undefined;
 assert.deepEqual(results[0].checkProgress,{stage:'check',percent:85});assert(results[0].timings.preparationMs>=0);
 await new Promise(resolve=>setTimeout(resolve,10));const later=await f.service.handle(action('status'));assert.equal(later.timings.preparationMs,results[0].timings.preparationMs);
 const applied=await f.service.handle(action('apply'));assert(applied.timings.applyMs>=0);const restored=f.create();assert.deepEqual((await restored.handle(action('status'))).timings,applied.timings);await restored.stop();
});
test('cancellation while finalizing a shared ready read cannot reappear as ready',async t=>{
 const f=await fixture(t);await f.service.handle(start);await f.settle();f.state.status='ready';let release;f.state.finalizeWait=()=>new Promise(resolve=>{release=resolve;});
 const status=f.service.handle(action('status'));while(!release)await new Promise(resolve=>setImmediate(resolve));const cancel=f.service.handle(action('cancel'));
 await new Promise(resolve=>setTimeout(resolve,10));release();await Promise.all([status,cancel]);f.state.finalizeWait=undefined;
 assert.equal((await f.service.handle(action('status'))).status,'cancelled');assert.equal(f.state.applies,0);
});
