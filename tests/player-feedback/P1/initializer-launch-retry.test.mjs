// Actual initializer control flow with a Core-shaped durable-status fixture.
// SQLite persistence and authority are tested separately by Rust tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createGodotWorldInitializer} from '../../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-initialization.ts';
const worldId='launch-world';
const binding={worldId,initId:'gwinit-exact',candidateId:'candidate-exact',applicationId:'app-exact'};
const status=()=>({worldId,initId:binding.initId,candidateId:binding.candidateId,status:'failed',playable:false,
 reason:'GODOT_INITIAL_LOAD_FAILED',failureStage:'confirm',launchFailure:{...binding}});
test('fresh initializers leave durable launch failure untouched and issue no task/build calls',async()=>{
 const calls=[];
 const domain=async(method,args)=>{calls.push({method,args});assert.equal(method,'godotWorld.initStatus');return status();};
 for(let restart=0;restart<2;restart++){
  const initializer=createGodotWorldInitializer({worldsRoot:'D:/not-accessed',domain,selection:async()=>worldId,firstLoad:async()=>assert.fail('must not launch')});
  await initializer.start(worldId);assert.equal(initializer.error(worldId),null);assert.equal(initializer.busy,false);
 }
 assert.equal(calls.length,2);assert.ok(calls.every(x=>x.method==='godotWorld.initStatus'));
});
test('explicit retry clears the exact failure before reopening a task and relaunching the checked candidate',async()=>{
 const root=path.resolve(import.meta.dirname,'../../../test-results');await fs.mkdir(root,{recursive:true});
 const worldsRoot=await fs.mkdtemp(path.join(root,'initializer-launch-retry-'));
 const directory=path.join(worldsRoot,worldId);await fs.mkdir(directory);
 const text='config_version=5\n',sha256=createHash('sha256').update(text).digest('hex');
 await fs.writeFile(path.join(directory,'project.godot'),text);
 await fs.writeFile(path.join(directory,'managed-base.json'),JSON.stringify({worldId,baseId:'first-person',files:[{path:'project.godot',bytes:Buffer.byteLength(text),sha256}]}));
 const calls=[];let current=status(),loads=0;
 const domain=async(method,args)=>{
  calls.push({method,args});
  if(method==='godotWorld.initStatus')return structuredClone(current);
  if(method==='godotWorld.initLaunchRetry'){assert.deepEqual(args,binding);current={...current,status:'checked',reason:null,launchFailure:null,failureStage:null};return {...args,recorded:true,replayed:false,cleared:true};}
  if(method==='task.recoverable')return {items:[]};
  if(method==='turn.begin')return {binding:{baseBuild:'base-a'}};
  if(method==='godotProject.index')return {revision:1,manifestHash:'exact-source',files:[{path:'project.godot',sha256}],nextOffset:null};
  if(method==='content.status')return {backend:'git'};
  if(method==='godotCandidate.list')return {items:[{status:'ready',manifestHash:'exact-source',candidateId:binding.candidateId}]};
  if(method==='workspace.endTurn'){assert.equal(args.status,'completed');return {};}
  assert.fail('unexpected call '+method);
 };
 const initializer=createGodotWorldInitializer({worldsRoot,domain,selection:async()=>worldId,firstLoad:async(w,c)=>{assert.equal(w,worldId);assert.equal(c,binding.candidateId);loads++;}});
 await initializer.start(worldId,{recover:true});assert.equal(initializer.error(worldId),null);assert.equal(loads,1);
 assert.ok(calls.findIndex(x=>x.method==='godotWorld.initLaunchRetry')<calls.findIndex(x=>x.method==='turn.begin'));
 assert.ok(!calls.some(x=>x.method==='godotBuild.start'||x.method==='godotProject.applyFiles'));
});
test('foreign or still-failed retry responses cannot reach task creation',async()=>{
 for(const variant of ['foreign','unconfirmed']){
  const calls=[];const domain=async(method)=>{calls.push(method);if(method==='godotWorld.initLaunchRetry')return {recorded:true};const value=status();if(variant==='foreign')value.launchFailure.worldId='other-world';return value;};
  const initializer=createGodotWorldInitializer({worldsRoot:'D:/not-accessed',domain,selection:async()=>worldId,firstLoad:async()=>assert.fail('must not launch')});
  await initializer.start(worldId,{recover:true});assert.match(initializer.error(worldId),variant==='foreign'?/IDENTITY_MISMATCH/:/RETRY_UNCONFIRMED/);
  assert.ok(!calls.includes('turn.begin'));
 }
});
