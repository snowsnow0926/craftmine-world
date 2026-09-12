// Production plugin build and broker, with controlled host/Core responses.
// Exercises packaging and lifecycle invariants; not player/engine performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-performance-broker-'));
execFileSync(process.execPath,[path.join(root,'desktop/build-world-plugin.mjs'),'--output',output],{cwd:root,windowsHide:true,stdio:'pipe'});
const require=createRequire(import.meta.url);
const {createWorldTools}=require(path.join(output,'world-tools.cjs'));
const {buildInventory}=require(path.join(output,'godot-capability.cjs'));
const {describeToolServices}=require(path.join(output,'tool-services.cjs'));
const {LOCAL_TOOLS,GODOT_METHODS}=require(path.join(output,'godot-routing.cjs'));
const manifest=require(path.join(output,'manifest.json'));
const context={projectId:'project',sessionId:'session',turnId:'turn',executionId:'execution',toolCallId:'call'};
test.after(()=>fs.rmSync(output,{recursive:true,force:true}));

function fixture(change={}){
  const calls=[];let ended=false,world='bound-world',build='build-a',instance='instance-a',onDescribe=()=>{};
  const identity=()=>({worldId:world,buildId:build,instanceId:instance,sampledAt:new Date().toISOString()});
  const state={end:()=>{ended=true;},world:value=>{world=value;},build:value=>{build=value;},instance:value=>{instance=value;},onDescribe:fn=>{onDescribe=fn;}};
  const core={start:async()=>({godotProjects:true,sessionDrafts:true}),call:async(method,args)=>{
    calls.push(method);
    if(method==='task.context')return {world:{id:world}};
    if(method==='godotRuntime.describe'){onDescribe();return {worldId:args.worldId,buildId:build,snapshot:{secret:'SAVE_BODY_DO_NOT_FORWARD'}};}
    throw Error('Unexpected side effect '+method);
  }};
  const options={samplePerformance:async()=>({...identity(),memoryWorkingSetMb:256.25,rendererProcessId:42,provenance:'electron-app-metrics',measurementScope:'renderer-process'}),sampleLiveState:async()=>identity(),...change};
  const tool=createWorldTools(core,async()=>{throw Error('READ_SETTINGS_FORBIDDEN');},()=>ended,
    {cancelOtherTurns:()=>{throw Error('CANCEL_FORBIDDEN');}},undefined,options).find(item=>item.name==='godot_performance_observe');
  return {calls,state,options,run:(args={})=>tool.execute(args,context)};
}

test('packaged broker uses read-only task binding and projects the independently identified process',async()=>{
  const f=fixture();
  const result=await f.run();
  assert.equal(result.available,true);assert.equal(result.scope.worldId,'bound-world');
  assert.equal(result.measured.memoryWorkingSetMb.value,256.25);
  assert.equal(result.measured.frameTimeMs.status,'unknown');
  assert.equal(JSON.stringify(result).includes('SAVE_BODY'),false);
  assert.deepEqual(f.calls,['task.context','godotRuntime.describe','task.context','godotRuntime.describe']);
  await assert.rejects(f.run({worldId:'foreign'}));
});

test('missing services and absent instances are unavailable, never zero measurements',async()=>{
  for(const change of [{samplePerformance:undefined},{sampleLiveState:undefined},{samplePerformance:async()=>null},{samplePerformance:async()=>({available:false})}]){
    const result=await fixture(change).run();assert.equal(result.available,false);
    assert.ok(Object.values(result.measured).every(field=>field.status==='unknown'&&!Object.hasOwn(field,'value')));
  }
  assert.throws(()=>fixture({samplePerformance:42}),/TOOL_SERVICE_INVALID/);
});

test('restarted instance, stale or forged samples cannot become measured results',async()=>{
  for(const mutation of [{instanceId:'old-instance'},{worldId:'foreign'},{buildId:'old-build'},
    {sampledAt:'2001-01-01T00:00:00Z'},{sampledAt:'2999-01-01T00:00:00Z'},{provenance:'game-payload'}]){
    const f=fixture(),original=f.options.samplePerformance;
    f.options.samplePerformance=async()=>({...await original(),...mutation});
    const result=await f.run();assert.equal(result.available,false,JSON.stringify(mutation));
    assert.equal(result.reason,'PERFORMANCE_SAMPLE_INVALID');
  }
});

test('task/build transitions and cancellation discard pending readings',async()=>{
  for(const change of ['world','build','end']){
    const f=fixture(),original=f.options.sampleLiveState;
    f.options.sampleLiveState=async()=>{const live=await original();f.state[change]('replacement');return live;};
    if(change==='end')await assert.rejects(f.run(),/TURN_ENDED/);
    else assert.equal((await f.run()).reason,change==='world'?'PERFORMANCE_WORLD_CHANGED':'PERFORMANCE_BUILD_CHANGED');
  }
  const f=fixture({samplePerformance:async()=>{throw Error('PRIVATE_HOST_PATH');}});
  const result=await f.run();assert.equal(result.reason,'PERFORMANCE_SAMPLE_FAILED');
  assert.equal(JSON.stringify(result).includes('PRIVATE_HOST_PATH'),false);
});

test('capability inventory reflects actual provider wiring',()=>{
  const read=services=>buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake:{godotProjects:true,sessionDrafts:true},services}).tools.find(tool=>tool.name==='godot_performance_observe');
  assert.equal(read(null).reachable,null);
  assert.equal(read(describeToolServices({})).reachable,false);
  assert.equal(read(describeToolServices({samplePerformance:()=>{},sampleLiveState:()=>{}})).reachable,true);
});

test('same-build restart during final Core read rejects the old process; final host query narrows instance',async()=>{
  const f=fixture(),queries=[],original=f.options.samplePerformance;let describes=0;
  f.state.onDescribe(()=>{if(++describes===2)f.state.instance('restarted-instance');});
  f.options.samplePerformance=async expected=>{
    queries.push(expected);
    const sample=await original();
    if(expected.instanceId&&expected.instanceId!==sample.instanceId)throw Error('PERFORMANCE_INSTANCEID_MISMATCH');
    return sample;
  };
  assert.equal((await f.run()).reason,'PERFORMANCE_INSTANCE_RECHECK_FAILED');
  assert.equal(queries.length,2);assert.equal(queries[1].instanceId,'instance-a');
});
