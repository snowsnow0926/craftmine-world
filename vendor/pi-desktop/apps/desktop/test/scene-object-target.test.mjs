import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCreationTargetService} from '../electron/main/creation-target-service.ts';
import {readSceneObjectTarget} from '../electron/main/scene-object-target.ts';
import {parseCreationTarget} from '../src/lib/creation-target.ts';
const session={projectId:'p',sessionId:'s'},context={...session,turnId:'t'};
const actor={objectId:'9007199254740993',nodePath:'Actor/Body',nodeClass:'StaticBody3D',scriptPath:'res://scripts/actor.gd',scenePath:'',position:[0,1,-2],normal:[0,0,1],ancestors:[]};
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'scene-target-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const state={now:100000,instance:{worldId:'w',buildId:'b',instanceId:'i'},revision:3,manifestHash:'a'.repeat(64),hit:structuredClone(actor),refs:[structuredClone(actor)],stamp:null,sourcePath:'scripts/actor.gd'};
 const deps={directory,now:()=>state.now,selection:async()=>state.instance.worldId,instance:()=>({...state.instance}),
 descriptor:async()=>({...state.instance,baseId:'creation-sandbox',sourceRevision:state.revision,manifestHash:state.manifestHash}),
 source:async()=>({...state.instance,baseId:'creation-sandbox',sourceRevision:state.revision,files:[{path:state.sourcePath,bytes:10,sha256:'f'.repeat(64)}]}),
 sample:async()=>({...state.instance,baseId:'creation-sandbox',sampledAt:state.stamp??new Date(state.now).toISOString(),payload:{player:{position:[0,1,0]},creation:{entities:[],target:{entityId:null,position:[0,0,-6],normal:[0,1,0],surface:'ground',revision:1},sceneObjectTarget:state.hit,sceneObjectRefs:state.refs}}})};
 return {state,service:createCreationTargetService(deps)};
}
const ref=capture=>({creationTarget:{captureId:capture.captureId}});
test('ordinary hit freezes opaque context and suppresses the ground behind it',async t=>{
 const {state,service}=fixture(t),display=await service.capture(1,session);
 assert.equal(display.target,null);assert.equal(display.sceneObjectTarget.scriptPath,'res://scripts/actor.gd');
 const parsed=parseCreationTarget(display);assert.equal(parsed.sceneObjectTarget.nodePath,'Actor/Body');assert.equal(parsed.target,null);
 state.hit=null;state.refs[0].nodePath='Renamed/Body';state.now+=1000;
 const capture=await service.validate(1,ref(display),session);
 await service.policy({worldId:'w',autoApply:true});
 await service.bind(1,capture,context,'w','把这个对象变大');
 const bound=service.bound(context,'w');
 assert.equal(bound.sceneObjectTarget.nodePath,'Actor/Body');
 assert.equal(bound.sceneObjectLive.currentNodePath,'Renamed/Body');
 assert.equal(bound.sceneObjectLive.sampledAt,new Date(state.now).toISOString());
 assert.notEqual(bound.sampledAt,bound.sceneObjectLive.sampledAt);
 assert.equal(bound.creationRequirements.status,'unverified');assert.equal(bound.autoApply,false);
});
test('deletion, same-path replacement and eviction cannot reuse a frozen node',async t=>{
 for(const refs of [[],[{...actor,objectId:'42'}]]){
  const {state,service}=fixture(t),display=await service.capture(1,session);state.refs=refs;
  await assert.rejects(service.validate(1,ref(display),session),/RECAPTURE/);
 }
});
test('a target deleted between validation and binding cannot enter the turn',async t=>{
 const {state,service}=fixture(t),display=await service.capture(1,session),capture=await service.validate(1,ref(display),session);
 state.refs=[];await assert.rejects(service.bind(1,capture,context,'w'),/RECAPTURE/);
 assert.equal(service.bound(context,'w'),null);
});

test('a changed script or ancestor requires recapture while same-parent renames remain usable',async t=>{
 for(const mutate of [s=>s.refs[0].scriptPath='res://scripts/another.gd',s=>s.refs[0].ancestors[0].objectId='51',s=>s.refs[0].ancestors[0].scriptPath='']){
  const {state,service}=fixture(t),parent={objectId:'50',nodePath:'Actor',nodeClass:'Node3D',scriptPath:'res://scripts/actor.gd',scenePath:''};
  state.hit.ancestors=[parent];state.refs[0].ancestors=[structuredClone(parent)];
  const display=await service.capture(1,session);mutate(state);
  await assert.rejects(service.validate(1,ref(display),session),/RECAPTURE/);
 }
 const {state,service}=fixture(t),parent={objectId:'50',nodePath:'Actor',nodeClass:'Node3D',scriptPath:'',scenePath:''};
 state.hit.ancestors=[parent];state.refs[0].ancestors=[structuredClone(parent)];
 const display=await service.capture(1,session);state.refs[0].ancestors[0].nodePath='Renamed';state.refs[0].nodePath='Renamed/Body';
 assert.equal((await service.validate(1,ref(display),session)).sceneObjectLive.currentNodePath,'Renamed/Body');
});
test('build, instance, world, source and stale refresh changes invalidate capture',async t=>{
 for(const mutate of [s=>s.instance.buildId='b2',s=>s.instance.instanceId='i2',s=>s.instance.worldId='w2',s=>s.revision++,s=>s.manifestHash='b'.repeat(64),s=>s.stamp=new Date(s.now-31000).toISOString()]){
  const {state,service}=fixture(t),display=await service.capture(1,session);mutate(state);
  await assert.rejects(service.validate(1,ref(display),session),/STALE|RECAPTURE/);
 }
});
test('shared scripts do not merge instance identities or admit metadata as identity',async t=>{
 const {state,service}=fixture(t);state.hit.metadata={entity_id:'tree-a',authorized:true};state.refs.push({...actor,objectId:'42',nodePath:'Actor2/Body'});
 const display=await service.capture(1,session);assert.equal(display.sceneObjectTarget.objectId,actor.objectId);
 assert.equal(Object.hasOwn(display.sceneObjectTarget,'metadata'),false);
 state.refs=state.refs.slice(1);await assert.rejects(service.validate(1,ref(display),session),/RECAPTURE/);
});
test('source paths must exist in formal source and malformed bounded references fail',async t=>{
 const {state,service}=fixture(t);state.sourcePath='scripts/another.gd';
 assert.equal((await service.capture(1,session)).sceneObjectTarget.scriptPath,null);
 for(const patch of [{objectId:123},{objectId:'0'},{nodePath:'../escape'},{nodePath:'x'.repeat(513)},{ancestors:Array(5).fill(actor)},{position:[Infinity,0,0]}])assert.throws(()=>readSceneObjectTarget({...actor,...patch},new Set()),/INVALID/);
});
test('no ordinary hit preserves structured ground and does not invent scene identity',async t=>{
 const {state,service}=fixture(t);state.hit=null;
 const display=await service.capture(1,session);assert.equal(display.target.surface,'ground');assert.equal(display.sceneObjectTarget,undefined);
});
