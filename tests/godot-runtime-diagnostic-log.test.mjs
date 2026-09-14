import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createGodotCheckPhases} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-check-phases.ts';
const {diagnosticLog,MAX_BYTES}=createRequire(import.meta.url)('../plugins/craftmine-world/godot-runtime-diagnostic-log.cjs');
const claim={jobId:'job-a',worldId:'world-a',buildId:'build-a',inputHash:'a'.repeat(64)};
const evidence=()=>({...claim,format:'craftmine.godot-runtime-check/1',scope:'base-startup',error:'GODOT_CHECK_TIMEOUT',
  ready:{ok:false,instanceId:''},isolation:{offscreen:false,focusable:true,visible:true},
  errors:{runtime:[],console:[],renderer:null},diagnostics:[]});
test('stalled artifact phase differs from an actually created isolated window',()=>{
  let time=0;const log=[];const stages=createGodotCheckPhases(log,()=>time);
  stages.begin('artifact-verification');time=30000;stages.fail();
  const result=JSON.parse(diagnosticLog({...evidence(),diagnostics:log},claim));
  assert.equal(result.diagnosticOnly,true);assert.equal(result.ready.instanceId,'');
  assert.deepEqual(result.isolation,{offscreen:false,focusable:true,visible:true});
  assert.deepEqual(result.diagnostics,['[phase] artifact-verification started elapsedMs=0 stageElapsedMs=0','[phase] artifact-verification failed elapsedMs=30000 stageElapsedMs=30000']);
  const created=JSON.parse(diagnosticLog({...evidence(),ready:{ok:false,instanceId:'runtime-a'},isolation:{offscreen:true,focusable:false,visible:false}},claim));
  assert.equal(created.ready.instanceId,'runtime-a');assert.equal(created.isolation.offscreen,true);
});
test('phase timings distinguish load completion from ready timeout and survive a full console tail',()=>{
  let time=0;const log=[];const stages=createGodotCheckPhases(log,()=>time);
  for(const phase of ['artifact-verification','runtime-server','window','load']){stages.begin(phase);time+=100;stages.complete();}
  stages.begin('ready');while(log.length<64)log.push('noise');time=30000;stages.fail();
  assert.equal(log.length,64);assert.match(log.at(-1),/ready failed elapsedMs=30000 stageElapsedMs=29600/);
  assert.match(log[7],/load completed/);assert(!log.some(line=>line.includes('ready completed')));
});
test('foreign evidence and scope cannot be persisted as this job diagnostics',()=>{
  for(const key of ['jobId','worldId','buildId','inputHash','scope','format'])assert.equal(diagnosticLog({...evidence(),[key]:'foreign'},claim),undefined);
});
test('first runtime/console/renderer cause survives bounds and credentials/private paths are removed',()=>{
  const log=diagnosticLog({...evidence(),errors:{runtime:['first runtime','res://pet.gd:42'],console:['Bearer private-value api_key=private-key sk-private-token'],renderer:'preload-error: D:/Secret User/build/godot-check.cjs: Cannot find module'},diagnostics:Array.from({length:100},()=> '🐶'.repeat(1200))},claim);
  assert(Buffer.byteLength(log)<=MAX_BYTES);const result=JSON.parse(log);
  assert.equal(result.truncated,true);assert.equal(result.errors.runtime[0],'first runtime');assert.equal(result.errors.runtime[1],'res://pet.gd:42');
  assert.match(result.errors.renderer,/Cannot find module/);
  for(const secret of ['private-value','private-key','sk-private-token','Secret User'])assert(!log.includes(secret));
});
