import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createCreationTargetService} from "../electron/main/creation-target-service.ts";

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
