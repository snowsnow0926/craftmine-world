// Actual stock materializer and initializer; controlled Core/executor receipts.
// No engine, renderer, model or existing profile is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createGodotWorldInitializer}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-initialization.ts');
const {initialLoadBridgeResource,initialLoadBridgeRepair}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/godot-initial-load-repair.ts');
const repository=path.resolve(import.meta.dirname,'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bridgePath='craftmine_shared/runtime_bridge.gd',enginePin='938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08';
const basePin='58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3';
const engineBytes=fs.readFileSync(path.join(repository,'desktop/godot/shared/runtime_bridge_engine_v1.gd'));
test('current stock engine bridge selects and validates its own exact bundled resource without rewriting it',()=>{
  assert.equal(sha(engineBytes),enginePin);
  assert.equal(initialLoadBridgeResource(enginePin),'shared/runtime_bridge_engine_v1.gd');
  assert.equal(initialLoadBridgeRepair(enginePin,engineBytes,basePin),null);
  assert.throws(()=>initialLoadBridgeRepair(enginePin,Buffer.concat([engineBytes,Buffer.from('\n# changed')]),basePin),/PIN_MISMATCH/);
  assert.throws(()=>initialLoadBridgeRepair(enginePin,fs.readFileSync(path.join(repository,'desktop/godot/shared/runtime_bridge.gd')),basePin),/PIN_MISMATCH/);
  for(const base of [undefined,enginePin,sha(Buffer.from('custom base'))])assert.throws(()=>initialLoadBridgeRepair(enginePin,engineBytes,base),/CUSTOMIZED/);
  assert.throws(()=>initialLoadBridgeRepair(basePin,engineBytes),/PIN_MISMATCH/);
  assert.throws(()=>initialLoadBridgeRepair(sha(Buffer.from('authored bridge')),engineBytes),/CUSTOMIZED/);
});

async function fixture(t,{customSource=false,customBase=false,customManaged=false,badBundle=false}={}) {
  const output=path.join(repository,'test-results');fs.mkdirSync(output,{recursive:true});
  const root=fs.mkdtempSync(path.join(output,'engine-bridge-initialization-')),worldId='cancelled-stock-world',directory=path.join(root,worldId);
  materializeBase({baseId:'creation-sandbox',worldId,template:'blank',out:directory});
  const metadataBytes=fs.readFileSync(path.join(directory,'managed-base.json')),metadata=JSON.parse(metadataBytes);
  const originals=new Map(metadata.files.map(file=>[file.path,fs.readFileSync(path.join(directory,file.path))]));
  assert.equal(sha(originals.get(bridgePath)),enginePin);
  assert.equal(metadata.files.find(file=>file.path===bridgePath).sha256,enginePin);
  const source=new Map([['project.godot',originals.get('project.godot')]]),calls=[],loads=[],jobs=[];
  let revision=1,cancelled=false,taskEnded=false,readPending=true,firstReadResolve,reachedResolve;
  const firstRead=new Promise(resolve=>{firstReadResolve=resolve;}),reached=new Promise(resolve=>{reachedResolve=resolve;});
  const index=()=>({worldId,revision,manifestHash:sha(JSON.stringify([...source].map(([name,bytes])=>[name,sha(bytes)]))),files:[...source].map(([name,bytes])=>({path:name,sha256:sha(bytes)})),nextOffset:null});
  const domain=async(method,args)=>{
    calls.push({method,args:structuredClone(args)});
    switch(method){
      case 'godotWorld.initStatus':return {worldId,initId:'init',worldRevision:0,status:'drafting',cancelled,playable:false};
      case 'godotWorld.initCancel':cancelled=true;return {worldId,status:'cancelled'};
      case 'godotWorld.initCancelClear':cancelled=false;return {worldId,status:'cleared'};
      case 'task.recoverable':return {items:taskEnded?[{worldId,taskId:'task',generation:1,binding:{sessionId:'create-'+worldId}}]:[]};
      case 'task.resume':assert.equal(args.taskId,'task');assert.equal(args.generation,1);return {};
      case 'turn.begin':return {binding:{taskId:'task',baseBuild:'creation-sandbox-1.0.0'}};
      case 'godotProject.index':return index();
      case 'content.status':return {backend:'git',repoId:'repo',headOid:'head',appliedOid:null};
      case 'godotProject.applyFiles':
        assert.equal(args.revision,revision);assert.equal(args.manifestHash,index().manifestHash);
        for(const file of args.files){assert.equal(file.expectedHash,null);assert(!source.has(file.path));source.set(file.path,Buffer.from(file.bytesBase64,'base64'));}
        revision++;return index();
      case 'godotCandidate.list':return {items:[]};
      case 'godotExecutor.status':return {buildAvailable:true,checkAvailable:true};
      case 'godotBuild.start':{const job={jobId:'job-'+jobs.length,taskId:'task',status:jobs.length?'passed':'queued',candidateId:jobs.length?'fresh-candidate':null};jobs.push(job);return job;}
      case 'godotBuild.read':if(readPending&&args.jobId==='job-0'){readPending=false;reachedResolve();await firstRead;}return {...jobs.find(job=>job.jobId===args.jobId)};
      case 'godotBuild.cancel':{const job=jobs.find(job=>job.jobId===args.jobId);job.status='cancelled';return {...job};}
      case 'workspace.endTurn':taskEnded=true;return {};
      default:throw Error('Unexpected '+method);
    }
  };
  const make=()=>createGodotWorldInitializer({worldsRoot:root,domain,selection:async()=>worldId,firstLoad:async(...args)=>loads.push(args),
    initialLoadBridge:existing=>badBundle?Buffer.from('wrong bundle'):fs.readFileSync(path.join(repository,'desktop/godot',initialLoadBridgeResource(existing)))});
  const initializer=make(),work=initializer.start(worldId);await reached;
  const stop=initializer.stopAll();firstReadResolve();await stop;await work;
  assert.equal(cancelled,true);assert.equal(jobs[0].status,'cancelled');assert.equal(loads.length,0);
  assert.equal(initializer.error(worldId),null);
  if(customSource)source.set(bridgePath,Buffer.from('authored bridge; do not replace'));
  if(customBase)source.set('craftmine_shared/runtime_bridge_base.gd',Buffer.from('authored base bridge; do not replace'));
  if(customManaged){const file='craftmine_shared/runtime_bridge_base.gd',bytes=Buffer.from('changed managed source; do not replace');fs.writeFileSync(path.join(directory,file),bytes);originals.set(file,bytes);}
  const retryStart=calls.length,sourceBefore=index(),next=make();
  await next.start(worldId,{recover:true});
  const retryCalls=calls.slice(retryStart);
  for(const [name,bytes] of originals)assert.deepEqual(fs.readFileSync(path.join(directory,name)),bytes);
  assert.deepEqual(fs.readFileSync(path.join(directory,'managed-base.json')),metadataBytes);
  assert.deepEqual(index(),sourceBefore,'retry must not rewrite the complete current source');
  t.after(()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({worldId,scope:'materializer and initializer with synthetic Core/executor; no native claim',sourceBefore,sourceAfter:index(),retryMethods:retryCalls.map(call=>call.method),loads,jobs,error:next.error(worldId)},null,2)));
  return {next,worldId,retryCalls,jobs,loads};
}
test('normal shutdown cancellation and cold explicit retry of a materialized blank world reaches a fresh check and first-load without source repair',async t=>{
  const f=await fixture(t);assert.equal(f.next.error(f.worldId),null);
  assert(f.retryCalls.some(call=>call.method==='godotWorld.initCancelClear'));assert(f.retryCalls.some(call=>call.method==='task.resume'));
  assert(!f.retryCalls.some(call=>call.method==='godotProject.applyFiles'));
  assert.equal(f.jobs.length,2);assert.equal(f.jobs[0].status,'cancelled');assert.deepEqual(f.loads,[[f.worldId,'fresh-candidate']]);
});
test('customized source bridge after cancellation is retained and rejects before fresh build or load',async t=>{
  const f=await fixture(t,{customSource:true});assert.match(f.next.error(f.worldId),/CUSTOMIZED/);assert.equal(f.jobs.length,1);assert.equal(f.loads.length,0);
});
test('known stock bridge with modified replacement bundle rejects before fresh build or load',async t=>{
  const f=await fixture(t,{badBundle:true});assert.match(f.next.error(f.worldId),/PIN_MISMATCH/);assert.equal(f.jobs.length,1);assert.equal(f.loads.length,0);
});
test('stock wrapper cannot bless modified inherited Core source or modified managed source',async t=>{
  const source=await fixture(t,{customBase:true});assert.match(source.next.error(source.worldId),/CUSTOMIZED/);assert.equal(source.jobs.length,1);assert.equal(source.loads.length,0);
  const managed=await fixture(t,{customManaged:true});assert.match(managed.next.error(managed.worldId),/MANAGED_BASE_FILE_CHANGED/);assert.equal(managed.jobs.length,1);assert.equal(managed.loads.length,0);
});
