import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createCreationTargetService,creationTargetDisplay} from "../electron/main/creation-target-service.ts";

const session={projectId:"project-a",sessionId:"session-a"};
const context={...session,turnId:"turn-a"};
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"creation-target-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const state={now:1000,selected:"world-a",instance:{worldId:"world-a",buildId:"build-a",instanceId:"instance-a"},
    descriptor:{worldId:"world-a",buildId:"build-a",baseId:"creation-sandbox",sourceRevision:3,manifestHash:"a".repeat(64)},
    target:{entityId:"tree-a",position:[2,0,-3],normal:[0,1,0],surface:"entity",revision:2}};
  const deps={directory,now:()=>state.now,selection:async()=>state.selected,instance:()=>state.instance,
    descriptor:async()=>structuredClone(state.descriptor),sample:async()=>({...state.instance,baseId:"creation-sandbox",sampledAt:new Date(state.now).toISOString(),payload:{player:{position:[0,1,0]},creation:{target:structuredClone(state.target)}}})};
  return {state,deps,service:createCreationTargetService(deps)};
}
const ref=display=>({creationTarget:{captureId:display.captureId}});

test("host freezes sample and binds it to the exact project/session/turn",async t=>{
  const {state,service}=fixture(t),display=await service.capture(11,session);
  display.target.position[0]=99;state.target.position[0]=77;
  const frozen=await service.validate(11,ref(display),session);
  assert.equal(frozen.target.position[0],2);
  frozen.target.position[0]=88;
  await service.bind(11,frozen,context,"world-a");
  assert.equal(service.bound({turnId:"turn-a",sessionId:"session-a",projectId:"project-a"},"world-a").target.position[0],2);
  assert.equal(service.bound({...context,turnId:"turn-b"},"world-a"),null);
  assert.throws(()=>service.bound(context,"world-b"),/CREATION_CONTEXT_INVALID/);
  await assert.rejects(service.validate(11,ref(display),session),/EXPIRED/);
});

test("forged renderer snapshots, another owner, and cross-session handles are rejected",async t=>{
  const {service}=fixture(t),display=await service.capture(11,session);
  for(const input of [{creationTarget:{...display}}, {...ref(display),targetSnapshot:display}, {creationTarget:{captureId:"guessed"}}, null]){
    await assert.rejects(service.validate(11,input,session));
  }
  await assert.rejects(service.validate(12,ref(display),session),/EXPIRED/);
  await assert.rejects(service.validate(11,ref(display),{...session,sessionId:"other"}),/SESSION_CHANGED/);
  await assert.rejects(service.validate(11,ref(display),{...session,projectId:"other"}),/SESSION_CHANGED/);
  assert.equal(await service.validate(11,undefined,session),null);
});

test("a new-chat capture can be claimed once by the first session in its host project",async t=>{
  const {service}=fixture(t),display=await service.capture(11,{projectId:session.projectId,sessionId:null});
  await assert.rejects(service.validate(11,ref(display),{...session,projectId:"other"}),/SESSION_CHANGED/);
  const capture=await service.validate(11,ref(display),session);
  await assert.rejects(service.validate(11,ref(display),{...session,sessionId:"second"}),/SESSION_CHANGED/);
  await service.bind(11,capture,context,"world-a");
  assert.equal(service.bound(context,"world-a").snapshotId,display.captureId);
});

test("world, instance, build, source and expiry changes fail before binding",async t=>{
  const {state,service}=fixture(t),display=await service.capture(11,session);
  const changes=[()=>state.selected="world-b",()=>state.instance.instanceId="instance-b",()=>state.instance.buildId="build-b",()=>state.descriptor.sourceRevision++,()=>state.descriptor.manifestHash="b".repeat(64),()=>state.now+=300001];
  for(const change of changes){
    const original=structuredClone(state);change();
    await assert.rejects(service.validate(11,ref(display),session),/STALE|EXPIRED/);
    Object.assign(state,original);
  }
  const capture=await service.validate(11,ref(display),session);
  state.descriptor.sourceRevision++;
  await assert.rejects(service.bind(11,capture,context,"world-a"),/STALE/);
  assert.equal(service.bound(context,"world-a"),null);
});

test("only one concurrent turn can consume an opaque capture",async t=>{
  const {service}=fixture(t),display=await service.capture(11,session),capture=await service.validate(11,ref(display),session);
  const result=await Promise.allSettled([service.bind(11,capture,context,"world-a"),service.bind(11,capture,{...context,turnId:"other"},"world-a")]);
  assert.equal(result.filter(item=>item.status==="fulfilled").length,1);
  assert.equal(result.filter(item=>item.status==="rejected").length,1);
});

test("world consent defaults off, survives restart, and revocation applies to an active turn",async t=>{
  const {service,deps,state}=fixture(t);
  assert.equal((await service.policy()).autoApply,false);
  await service.policy({worldId:"world-a",autoApply:true});
  const display=await service.capture(11,session);
  await service.bind(11,await service.validate(11,ref(display),session),context,"world-a");
  const restarted=createCreationTargetService(deps);
  assert.equal(restarted.bound(context,"world-a").autoApply,true);
  await restarted.policy({worldId:"world-a",autoApply:false});
  assert.equal(restarted.bound(context,"world-a").autoApply,false);
  state.selected="world-b";
  assert.equal((await restarted.policy()).autoApply,false);
  await assert.rejects(restarted.policy({worldId:"world-a",autoApply:true}),/WORLD_CHANGED/);
});

test("invalid runtime samples and mid-sample transitions never create a handle",async t=>{
  const {state,deps,service}=fixture(t);
  for(const patch of [{entityId:null},{revision:-1},{position:[NaN,0,0]},{surface:"invented"}]){
    const original=structuredClone(state.target);Object.assign(state.target,patch);
    await assert.rejects(service.capture(11,session),/OBSERVATION_INVALID/);state.target=original;
  }
  const sample=deps.sample;
  deps.sample=async()=>{const result=await sample();state.instance={...state.instance,instanceId:"other"};return result;};
  await assert.rejects(service.capture(11,session),/TARGET_STALE/);
});

test("no hit preserves world context and owner revocation removes pending handles",async t=>{
  const {state,service}=fixture(t);
  state.target={entityId:null,position:null,normal:null,surface:"none",revision:0};
  const display=await service.capture(11,session);
  assert.equal(display.target,null);assert.ok(display.captureId);
  service.revokeOwner(11);
  await assert.rejects(service.validate(11,ref(display),session),/EXPIRED/);
});


test("editable target uses the same sampled entity values and rejects mismatched or duplicate entities",async t=>{
 const {deps,service}=fixture(t);const original=deps.sample;deps.sample=async()=>{const sample=await original();sample.payload.creation.entities=[{id:'tree-a',kind:'tree',scale:[2,3,1.5],color:'#123456',parameters:{}}];return sample;};
 const display=await service.capture(11,session);assert.equal(display.target.entityName,'树');assert.equal(display.target.entityKind,'tree');assert.deepEqual(display.target.scale,[2,3,1.5]);assert.equal(display.target.color,'#123456');
 const target={entityId:'tree-a',surface:'entity',position:[0,0,0],normal:[0,1,0],revision:1};
 const entity={id:'tree-a',kind:'tree',scale:[2,3,1.5],color:'#123456'};
 assert.deepEqual(creationTargetDisplay(target,[{...entity,id:'other'}]),target);assert.deepEqual(creationTargetDisplay(target,[entity,entity]),target);assert.deepEqual(creationTargetDisplay(target,[{...entity,scale:[NaN,1,1]}]),target);
});

test('full-auto permission binds general edits without an extra world opt-in and survives UI/turn teardown',async t=>{
 const {deps}=fixture(t);const service=createCreationTargetService({...deps,fullAuto:async()=>true});
 assert.equal((await service.policy({sessionId:session.sessionId})).fullAuto,true);
 const display=await service.capture(11,session),capture=await service.validate(11,ref(display),session);
 await service.bind(11,capture,context,'world-a','生成一个会跟着我的博美犬');
 assert.equal(service.owned(context).autoApply,true);assert.equal(service.owned(context).authorization,'full-auto');
 assert.equal(createCreationTargetService(deps).owned(context).autoApply,true);
 service.cancel(context.sessionId,context.turnId);assert.equal(service.owned(context).autoApply,false);
});
test('dialogue creation without a ray still binds exact host world and full-auto authorization',async t=>{
 const {deps}=fixture(t);const service=createCreationTargetService({...deps,fullAuto:async()=>true});
 const capture=await service.bindWorld(context,'world-a','创建一个小镇');
 assert.equal(capture.target.surface,'none');assert.equal(capture.autoApply,true);assert.equal(service.owned(context).worldId,'world-a');
});

test('automatic repair preserves the original request and cancelling a repair revokes its ancestry',async t=>{
 const {deps}=fixture(t);const service=createCreationTargetService({...deps,fullAuto:async()=>true});
 const original=await service.bindWorld(context,'world-a','保留存档并做一条会追人的龙');const next={...context,turnId:'repair'};
 const repair=await service.bindContinuation(next,context,'world-a');assert.equal(repair.requestHash,original.requestHash);assert.equal(repair.snapshotId,original.snapshotId);
 service.cancel(next.sessionId,next.turnId);assert.equal(service.owned(context).autoApply,false);assert.equal(service.owned(next).autoApply,false);
 await assert.rejects(service.bindContinuation({...next,turnId:'another'},context,'world-a'),/NOT_AUTHORIZED/);
});
test('repair cannot silently rebase onto a different formal build',async t=>{
 const {deps,state}=fixture(t);const service=createCreationTargetService({...deps,fullAuto:async()=>true});await service.bindWorld(context,'world-a','建一个城镇');
 state.descriptor.buildId='changed';await assert.rejects(service.bindContinuation({...context,turnId:'repair'},context,'world-a'),/STALE/);
});

test('a new ordinary user turn supersedes prior auto intent even without a new check, while repair continuations retain their root',async t=>{
 const {deps}=fixture(t);const service=createCreationTargetService({...deps,fullAuto:async()=>true});
 await service.bindWorld(context,'world-a','第一项意图');const repair={...context,turnId:'repair'};await service.bindContinuation(repair,context,'world-a');
 assert.equal(service.owned(context).autoApply,true);assert.equal(service.owned(repair).autoApply,true);
 const next={...context,turnId:'new-player-request'};await service.bindWorld(next,'world-a','更改目标的新意图');
 assert.equal(service.owned(context).autoApply,false);assert.deepEqual(service.owned(context).supersededBy,next);assert.equal(service.owned(repair).autoApply,false);assert.equal(service.owned(next).autoApply,true);
 const restarted=createCreationTargetService(deps);assert.equal(restarted.owned(context).autoApply,false);assert.deepEqual(restarted.authorizedTurns().map(x=>x.context.turnId),[next.turnId]);
 await assert.rejects(service.bindContinuation({...context,turnId:'late-repair'},context,'world-a'),/NOT_AUTHORIZED/);
});

for(const cancelRepair of [false,true])test('cancellation during continuation permission read cannot resurrect its original capture or repair ('+cancelRepair+')',async t=>{
 const {deps}=fixture(t);let release,entered;let block=false;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const service=createCreationTargetService({...deps,fullAuto:async()=>{if(block){entered();await gate;}return true;}});
 await service.bindWorld(context,'world-a','原完整目标');block=true;const next={...context,turnId:'repair-race'};
 const pending=service.bindContinuation(next,context,'world-a');await waiting;service.cancel(context.sessionId,cancelRepair?next.turnId:context.turnId);release();
 await assert.rejects(pending,/NOT_AUTHORIZED/);assert.equal(service.owned(context).autoApply,false);assert.equal(service.owned(next),null);
});
for(const mode of ['world','capture'])test('cancellation during initial '+mode+' binding is durable before a turn record exists',async t=>{
 const {deps}=fixture(t);let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const service=createCreationTargetService({...deps,fullAuto:async()=>{entered();await gate;return true;}});
 let pending;if(mode==='world')pending=service.bindWorld(context,'world-a','目标');else{const display=await service.capture(11,session),capture=await service.validate(11,ref(display),session);pending=service.bind(11,capture,context,'world-a','目标');}
 await waiting;service.cancel(context.sessionId,context.turnId);release();await assert.rejects(pending,/CANCELLED/);assert.equal(service.owned(context),null);
});

test('world-only dialogue capture uses the real player position and still has no invented ray target',async t=>{
 const {deps}=fixture(t),sample=await deps.sample();sample.payload.player.position=[0,.9,6];const service=createCreationTargetService({...deps,fullAuto:async()=>true,sample:async()=>structuredClone(sample)});
 const capture=await service.bindWorld(context,'world-a','造一扇红门');assert.deepEqual(capture.playerPosition,[0,.9,6]);assert.equal(capture.sampledAt,sample.sampledAt);assert.equal(capture.target.position,null);assert.equal(capture.target.surface,'none');
});
for(const corrupt of [sample=>sample.worldId='other',sample=>sample.buildId='other',sample=>sample.instanceId='other',sample=>sample.payload.player.position=[NaN,0,0],sample=>delete sample.payload.player.position,sample=>sample.sampledAt='invalid'])test('world-only binding refuses invalid or foreign live player evidence '+corrupt.toString(),async t=>{
 const {deps}=fixture(t),sample=await deps.sample();corrupt(sample);const service=createCreationTargetService({...deps,fullAuto:async()=>true,sample:async()=>sample});
 await assert.rejects(service.bindWorld(context,'world-a','造一扇红门'),/OBSERVATION_INVALID/);assert.equal(service.owned(context),null);
});
