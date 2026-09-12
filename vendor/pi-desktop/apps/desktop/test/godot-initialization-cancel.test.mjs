import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {createGodotWorldInitializer}=await import('../electron/main/godot-world-initialization.ts');
const {createGodotWorldFactory,initStatusToCreation}=await import('../electron/main/godot-world-creation.ts');
const {createGodotPanelCoordinator}=await import('../electron/main/godot-panel-coordinator.ts');
const {invokeCraftmineNavigation}=await import('../electron/main/craftmine-navigation-host.ts');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(phase='gate') {
 const worldId='world-cancel',root=path.resolve(import.meta.dirname,'../../../../../test-results');fs.mkdirSync(root,{recursive:true});
 const worldsRoot=fs.mkdtempSync(path.join(root,'init-cancel-')),directory=path.join(worldsRoot,worldId);fs.mkdirSync(directory);
 const text='config_version=5\n',sha256=createHash('sha256').update(text).digest('hex');fs.writeFileSync(path.join(directory,'project.godot'),text);fs.writeFileSync(path.join(directory,'managed-base.json'),JSON.stringify({worldId,baseId:'first-person',files:[{path:'project.godot',bytes:Buffer.byteLength(text),sha256}]}));
 const entered=deferred(),release=deferred(),calls=[];let held=false,cancelled=false,ready=false,job=null,opened=false,ended=false,persistFails=false;
 const hold=async name=>{if(phase===name&&!held){held=true;entered.resolve();await release.promise;}};
 const domain=async(method,args)=>{calls.push(method);
  if(method==='godotWorld.initStatus'){await hold('status');return {worldId,initId:'init-one',status:ready?'confirmed':cancelled?'cancelled':'pending',playable:ready,cancelled,reason:cancelled?'GODOT_INITIALIZATION_CANCELLED':null};}
  if(method==='godotWorld.initCancelClear'){cancelled=false;return {worldId,cleared:true};}
  if(method==='godotWorld.initCancel'){assert.ok(!opened||ended);assert.ok(!job||['passed','cancelled'].includes(job.status));if(persistFails)throw Error('CANCEL_STORAGE_FAILED');if(!ready)cancelled=true;return {worldId,status:ready?'ready':'cancelled'};}
  if(method==='task.recoverable')return {items:[]};if(method==='turn.begin'){opened=true;ended=false;return {binding:{baseBuild:'base-a',taskId:'owned-task'}};}
  if(method==='godotProject.index')return {revision:1,manifestHash:'source',files:[{path:'project.godot',sha256}],nextOffset:null};
  if(method==='content.status')return {backend:'git'};if(method==='godotCandidate.list')return {items:[]};
  if(method==='godotExecutor.status'){await hold('gate');return {buildAvailable:true,checkAvailable:true};}
  if(method==='godotBuild.start'){job={jobId:'owned-job',taskId:'owned-task',status:'queued'};await hold('submit');return {...job};}
  if(method==='godotBuild.latest')return job?{...job}:null;
  if(method==='godotBuild.read'){await hold('build');if(job.status!=='cancelled'&&phase!=='submit')job.status='passed';return {...job,candidateId:'candidate-one'};}
  if(method==='godotBuild.cancel'){assert.equal(args.jobId,'owned-job');job.status='cancelled';return {...job};}
  if(method==='workspace.endTurn'){if(calls.includes('cancelFirstLoad')&&!ready)assert.equal(args.status,'aborted');ended=true;return {};}
  throw Error('UNEXPECTED:'+method);
 };
 const service=createGodotWorldInitializer({worldsRoot,domain,selection:async()=>worldId,
  firstLoad:async()=>{calls.push('firstLoad');await hold('firstLoad');await hold('lateCommit');ready=true;},
  cancelFirstLoad:async id=>{assert.equal(id,worldId);calls.push('cancelFirstLoad');if(phase==='firstLoad')release.reject(Error('GODOT_INITIALIZATION_CANCELLED'));return {};}});
 return {service,domain,worldsRoot,worldId,entered,release,calls,source:()=>fs.readFileSync(path.join(directory,'project.godot'),'utf8'),setPersistFails:value=>persistFails=value,get cancelled(){return cancelled;},get ready(){return ready;}};
}
for(const phase of ['status','gate','submit','build','firstLoad'])test('cancel '+phase+' waits for only owned work, preserves source and latches until explicit retry',async()=>{
 const f=fixture(phase),work=f.service.start(f.worldId);await f.entered.promise;let settled=false;
 const cancel=f.service.cancel(f.worldId).then(result=>{settled=true;return result;});await Promise.resolve();assert.equal(settled,false);
 if(phase!=='firstLoad')f.release.resolve();await cancel;await work;
 assert.equal(f.cancelled,true);assert.equal(f.service.running(f.worldId),false);assert.equal(f.service.error(f.worldId),null);assert.equal(f.source(),'config_version=5\n');
 const calls=f.calls.length;await f.service.start(f.worldId);assert.equal(f.calls.length,calls,'automatic start is suppressed');
 assert.ok(f.calls.indexOf('godotWorld.initCancel')>f.calls.lastIndexOf('workspace.endTurn'));
});
test('failed cancellation persistence rejects completion and a later cancel safely retries it',async()=>{
 const f=fixture('gate'),work=f.service.start(f.worldId);await f.entered.promise;f.setPersistFails(true);const cancel=f.service.cancel(f.worldId);f.release.resolve();await assert.rejects(cancel,/CANCEL_STORAGE_FAILED/);await work;assert.equal(f.cancelled,false);f.setPersistFails(false);await f.service.cancel(f.worldId);assert.equal(f.cancelled,true);
});
test('a fresh initializer respects durable cancellation, and explicit retry clears it before starting a new attempt',async()=>{
 const f=fixture('gate');f.service.start(f.worldId);await f.entered.promise;const cancelled=f.service.cancel(f.worldId);f.release.resolve();await cancelled;
 const restarted=createGodotWorldInitializer({worldsRoot:f.worldsRoot,domain:f.domain,selection:async()=>f.worldId,firstLoad:async()=>{}});
 const turns=f.calls.filter(method=>method==='turn.begin').length;await restarted.start(f.worldId);assert.equal(f.calls.filter(method=>method==='turn.begin').length,turns);
 await f.service.start(f.worldId,{recover:true});assert.equal(f.cancelled,false);assert.equal(f.ready,true);assert.ok(f.calls.lastIndexOf('godotWorld.initCancelClear')<f.calls.lastIndexOf('turn.begin'));assert.equal(f.source(),'config_version=5\n');
});
test('shutdown cancellation settles the owned initializer before releasing its lifecycle',async()=>{
 const f=fixture('gate');f.service.start(f.worldId);await f.entered.promise;const stopped=f.service.stopAll();f.release.resolve();await stopped;assert.equal(f.service.busy,false);assert.equal(f.cancelled,true);
});
test('a late cancel that loses to formal adoption leaves the ready world running and writes no cancellation marker',async()=>{
 const f=fixture('lateCommit');f.service.start(f.worldId);await f.entered.promise;const cancelled=f.service.cancel(f.worldId);f.release.resolve();const result=await cancelled;assert.equal(result.alreadyReady,true);assert.equal(f.ready,true);assert.equal(f.cancelled,false);assert.equal(f.service.error(f.worldId),null);
});
test('cancelled presentation is recoverable and never claims source corruption',()=>{
 const value=initStatusToCreation({status:'cancelled',playable:false,reason:'GODOT_INITIALIZATION_CANCELLED'});assert.equal(value.state,'failed');assert.equal(value.creation.error.code,'GODOT_INITIALIZATION_CANCELLED');assert.match(value.creation.error.message,/已取消/);assert.ok(value.creation.actions.includes('retry'));
});
test('cancel invalidates a retry waiting for a previous attempt and main route reaches it despite an unrelated candidate',async()=>{
 const gate=deferred(),calls=[];
 const factory=createGodotWorldFactory({worldsRoot:'D:/not-accessed',catalogFile:'D:/not-accessed',basesRoot:'D:/not-accessed',materialize:()=>{},domain:async()=>({status:'failed',playable:false}),initialization:{running:()=>true,error:()=>null,start:async(id,settings)=>{calls.push(settings?.recover?'recover':'existing');await gate.promise;},cancel:async()=>{gate.resolve();}}});
 const retry=factory.retry('world-one');await Promise.resolve();
 const panel=createGodotPanelCoordinator({host:{instance:{worldId:'other-world'}},adapter:{},selection:async()=> 'other-world',invoke:async()=>{throw Error('UNEXPECTED_NORMAL_INVOKE');},creation:()=>factory});
 const request=payload=>invokeCraftmineNavigation({pluginId:'craftmine.world',channel:'world.creationCancel',payload},{invoke:(channel,args)=>panel.invoke(channel,args)});
 assert.equal((await request({worldId:'world-one'})).status,'cancelled');await retry;assert.deepEqual(calls,['existing']);
 await assert.rejects(request({worldId:'world-one',candidateId:'foreign'}));
});
