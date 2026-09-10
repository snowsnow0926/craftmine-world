// End-to-end wiring of the model tools to the real services (task S6).
//
// The broker is loaded from a private copy with a stub domain layer, so this
// test proves that a wired provider changes what the model sees: live sampling,
// the durable seven-kind ledger and the live managed executor. No engine, no
// Rust binary, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const source=path.join(root,'plugins/craftmine-world');
const staging=await mkdtemp(path.join(process.env.PI_SCRATCH_DIR||tmpdir(),'godot-round3-S6-wiring-'));
const FILES=['manifest.json','world-tools.cjs','godot-routing.cjs','godot-docs.cjs','godot-query.cjs',
  'godot-observe.cjs','godot-capability.cjs','godot-history.cjs','godot-jobs.cjs','godot-library.cjs','tool-services.cjs'];
for(const file of FILES)await copyFile(path.join(source,file),path.join(staging,file));
await writeFile(path.join(staging,'domain.cjs'),`
function fields(args,required,optional){
  const allowed=new Set([...(required||[]),...(optional||[])]);
  for(const key of Object.keys(args))if(!allowed.has(key))throw Object.assign(Error('UNKNOWN_FIELD: '+key),{errorCode:'UNKNOWN_FIELD'});
  for(const key of required||[])if(!Object.hasOwn(args,key))throw Object.assign(Error('MISSING_FIELD: '+key),{errorCode:'MISSING_FIELD'});
}
module.exports={
  fields,
  inspectDraft:()=>({stub:true}),
  readDraftResource:()=>({stub:true,workspaceRevision:3,hash:'a'.repeat(64)}),
  patchDraft:()=>({stub:true,changed:[],draft:{}}),
  readCapabilities:()=>({stub:true}),
  readVerification:(job)=>({stub:true,job}),
  draftPackages:()=>({extensions:[]}),
  createLibraryService:()=>({search:async()=>({stub:true}),read:async()=>({stub:true}),install:async()=>({stub:true})}),
  createMemoryService:()=>({search:async()=>({stub:true}),propose:async()=>({stub:true})}),
};
`,'utf8');
const {createWorldTools}=require(path.join(staging,'world-tools.cjs'));

const HANDSHAKE={format:'craftmine.core/1',godotProjects:true,godotExecution:false,godotBuildJobs:true,
  godotExecutorGate:true,verificationJobs:true,playerApplications:true,advisoryReviews:true,sessionDrafts:true,
  publishesWorlds:true,agentPublishesWorlds:false};
const BINDING={projectId:'project',sessionId:'session',turnId:'turn',taskId:'task-1',baseBuild:'gbd-0'};

function liveSample(patch={}){
  return {worldId:'alpha',buildId:'gbd-7',instanceId:'inst-1',base:'first-person',baseVersion:'craftmine.base/3',
    sampledAt:new Date().toISOString(),provenance:'host-observe-envelope',
    display:{cameraGlobal:{x:4,y:6,z:-2},attachedToCamera:true,alignedWithCamera:true,forwardDot:1},
    equipment:{active:'pistol',displayName:'Pistol',damage:12},player:{yaw:0.5,pitch:-0.1},
    targets:[{id:'dummy-1',distance:6}],interactables:[{id:'door-1'}],quests:[{id:'q-1',state:'open'}],
    inventory:[{id:'ammo',count:12}],hud:{health:100},crosshair:{visible:true},aim:{blocked:false},
    viewportSize:{width:800,height:600},inputCaptured:true,hasSave:true,...patch};
}

function fixture({options={},settings={},coreOverrides={}}={}){
  const calls=[];
  const core={
    start:async()=>HANDSHAKE,
    stop:async()=>{},
    call:async(method,params)=>{
      calls.push({method,params});
      if(coreOverrides[method])return coreOverrides[method](params);
      if(method==='workspace.open')return {worldId:'alpha',revision:3,repoId:'repo-alpha',branchId:'main',
        expectedHeadOid:'a'.repeat(40),expectedAppliedOid:null,expectedProgressRevision:null,
        task:{binding:BINDING,draft:{revision:3,hash:'d'.repeat(64)},draftHash:'d'.repeat(64),revision:3}};
      if(method==='godotRuntime.describe')return {phase:'formal',worldId:'alpha',buildId:'gbd-7',baseId:'first-person',
        revision:3,contentHash:'d'.repeat(64),entry:'web/index.html',threads:true,artifactManifestHash:'e'.repeat(64),
        artifacts:[{path:'web/index.html'}],build:{godot:{engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web'}},
        snapshot:{savedAt:'2026-09-09T00:00:00Z',equipment:{active:'sword'}}};
      if(method==='godotProject.index')return {format:'craftmine.godot-project/1',worldId:'alpha',revision:3,
        manifestHash:'b'.repeat(64),baseId:'first-person',baseBuild:'gbd-0',engineVersion:'4.7.2-stable',
        renderer:'gl_compatibility',target:'web',files:[],totalFiles:0,nextOffset:null,status:'source-only',
        verified:false,applied:false,executionAvailable:false,binaryAssetsAvailable:false};
      if(method==='godotCandidate.list')return {items:[],nextOffset:null};
      if(method==='godotBuild.start')return {jobId:'gjob-'+'a'.repeat(64),buildId:'gbd-8',worldId:'alpha',kind:'build',
        status:'queued',executionAvailable:true,blockedReason:null};
      if(method==='godotBuild.cancel')return {cancelled:true};
      if(method==='godotJob.usage')return {items:[],totals:{executions:0}};
      if(method==='godotJob.continue')return {jobId:'gjob-'+'b'.repeat(64),kind:'build',status:'queued',worldId:'alpha'};
      if(method==='godotExecutor.status')return {format:'craftmine.godot-execution-status/1',build:false,check:false,
        buildBlockedReason:'GODOT_EXECUTOR_UNAVAILABLE',checkBlockedReason:'GODOT_EXECUTOR_UNAVAILABLE',executors:[]};
      if(method==='task.context')return {binding:BINDING,generation:5};
      if(method==='budget.inspect')return {ownerTaskId:'task-1',requestCount:4,compactionCount:2,actualTokens:1200,
        reservedTokens:300,unknownRequestCount:1,chargedTokens:1500,remainingTokens:8500,
        limits:{maxRequests:50,maxTokens:10000,maxCompactions:6,deadlineAt:null}};
      throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
    },
  };
  const invocation={projectId:'project',sessionId:'session',turnId:'turn',executionId:'execution'};
  const tools=createWorldTools(core,async()=>({activeWorldId:'alpha',...settings}),()=>false,undefined,undefined,options);
  const call=(name,args={},extra={})=>tools.find(tool=>tool.name===name).execute(args,
    {...invocation,toolCallId:'call-'+name,...extra});
  return {call,calls};
}

const ledgerBudget=async()=>({kinds:{tokens:{limit:10000,used:1500,remaining:8500,source:'durable-ledger'},
  requests:{limit:50,used:4,source:'durable-ledger'},compactions:{limit:6,used:2,source:'durable-ledger'},
  context:{},service:{},wallClock:{},resource:{}},ledger:{ownerTaskId:'task-1',chargedTokens:1500}});

test('live observation is returned from the host provider, never from saved progress',async()=>{
  const samplerCalls=[];
  const f=fixture({options:{sampleLiveState:async input=>{samplerCalls.push(input);return liveSample();}}});
  const state=await f.call('godot_runtime_state',{scope:'live'});
  assert.deepEqual(samplerCalls,[{worldId:'alpha',buildId:'gbd-7'}]);
  assert.equal(state.live.available,true);
  assert.equal(state.live.stale,false);
  assert.equal(state.live.provenance,'live-instance-sample');
  assert.deepEqual(state.live.camera.global,{x:4,y:6,z:-2});
  assert.equal(state.live.equipment.active,'pistol');
  assert.deepEqual(state.live.entities.targets,[{id:'dummy-1',distance:6}]);
  assert.deepEqual(state.live.quests,[{id:'q-1',state:'open'}]);
  assert.deepEqual(state.live.unavailable,[]);
  // Durable progress stays separate and is never presented as equipment.
  assert.equal(state.durableProgress.source,'last-confirmed-save');
  assert.ok(!JSON.stringify(state.live).includes('sword'),'saved equipment must not leak into live state');
});

test('a stale or foreign sample is reported as unknown, not silently accepted',async()=>{
  const stale=fixture({options:{sampleLiveState:async()=>liveSample({sampledAt:'2020-01-01T00:00:00Z'})}});
  const staleState=await stale.call('godot_runtime_state',{scope:'live'});
  assert.equal(staleState.live.stale,true);
  assert.ok(staleState.live.mismatches.includes('LIVE_SAMPLE_STALE'));
  const foreign=fixture({options:{sampleLiveState:async()=>{throw Object.assign(Error('LIVE_WORLD_MISMATCH'),{errorCode:'LIVE_WORLD_MISMATCH'});}}});
  const foreignState=await foreign.call('godot_runtime_state',{scope:'live'});
  assert.equal(foreignState.live.available,false);
  assert.equal(foreignState.live.reason,'LIVE_SAMPLE_FAILED');
  assert.equal(foreignState.live.errorCode,'LIVE_WORLD_MISMATCH');
  const unwired=fixture();
  const unwiredState=await unwired.call('godot_runtime_state',{scope:'live'});
  assert.equal(unwiredState.live.available,false);
  assert.equal(unwiredState.live.reason,'LIVE_OBSERVATION_NOT_WIRED');
});

test('the capability report exposes the real wiring state and the durable ledger',async()=>{
  const f=fixture({options:{sampleLiveState:async()=>liveSample(),executorStatus:()=>({available:true,buildAvailable:true}),
    executorEnqueue:async()=>({enqueued:true}),budget:ledgerBudget}});
  const report=await f.call('godot_capability_report',{});
  assert.equal(report.services.format,'craftmine.tool-services/1');
  const wired=report.services.wired.map(entry=>entry.key);
  for(const key of ['sampleLiveState','executorStatus','executorEnqueue','budget'])assert.ok(wired.includes(key),key);
  assert.equal(report.services.complete,false,'the cancel provider was not supplied');
  assert.ok(report.services.missing.some(entry=>entry.key==='executorCancel'&&entry.owner==='S2'));
  // An optional override with a working default is never reported as a gap.
  assert.ok(report.services.optionalMissing.some(entry=>entry.key==='isDiscussionOnly'&&entry.owner==='R2'));
  assert.ok(!report.services.missing.some(entry=>entry.key==='historyMethods'));
  assert.equal(report.limits.available,true);
  assert.deepEqual(report.limits.kinds.tokens,{known:true,limit:10000,used:1500,remaining:8500,exhausted:false,source:'durable-ledger'});
  assert.equal(report.limits.kinds.context.known,false);
  assert.equal(report.limits.ledger.ownerTaskId,'task-1');
  // The installed guidance catalog adds AI1 alongside the original S owners.
  assert.ok(report.tools.every(tool=>tool.owner===null||/^(S\d|AI1)$/.test(tool.owner)),'tool owners must name an installed module owner');
});

test('godot_jobs mode=status prefers the live executor over the durable registration row',async()=>{
  let liveCalls=0;
  const f=fixture({options:{executorStatus:async()=>{liveCalls+=1;return {format:'craftmine.godot-executor-status/1',
    available:true,buildAvailable:true,checkAvailable:true,state:'registered',reason:null,jobs:['gjob-1']};}}});
  const status=await f.call('godot_jobs',{mode:'status'});
  assert.equal(liveCalls,1);
  assert.equal(status.source,'live-executor');
  assert.equal(status.status.buildAvailable,true);
  assert.deepEqual(status.tokenGatedMethods.includes('godotJob.claim'),true);
  assert.ok(!f.calls.some(entry=>entry.method==='godotExecutor.status'),'the stale core row must not be used when a live provider exists');
  const without=fixture();
  const fallback=await without.call('godot_jobs',{mode:'status'});
  assert.equal(fallback.source,'core-registration');
  assert.equal(fallback.liveProviderWired,false);
});

test('a queued build job is handed to the live executor in the same turn',async()=>{
  const enqueued=[];
  const f=fixture({options:{executorEnqueue:async(job,context)=>{enqueued.push({job,context});return {enqueued:true};}}});
  const started=await f.call('godot_build_start',{revision:3,manifestHash:'b'.repeat(64),mode:'build'});
  assert.equal(started.execution.enqueued,true);
  assert.equal(enqueued.length,1);
  assert.equal(enqueued[0].job.jobId,'gjob-'+'a'.repeat(64));
  assert.equal(enqueued[0].job.worldId,'alpha');
  assert.equal(enqueued[0].job.mode,'build');
  assert.equal(enqueued[0].context.turnId,'turn');
  // A blocked job is not handed over and reports the real reason.
  const blocked=fixture({coreOverrides:{'godotBuild.start':()=>({jobId:'gjob-'+'c'.repeat(64),worldId:'alpha',kind:'build',
    status:'blocked',executionAvailable:false,blockedReason:'GODOT_EXECUTOR_UNAVAILABLE'})},
    options:{executorEnqueue:async()=>{throw Error('must not be called');}}});
  const blockedResult=await blocked.call('godot_build_start',{revision:3,manifestHash:'b'.repeat(64),mode:'build'});
  assert.deepEqual(blockedResult.execution,{enqueued:false,reason:'GODOT_EXECUTOR_UNAVAILABLE',owner:'S2',skipped:true});
  // Without the provider the job is recorded but the model is told it was not handed over.
  const unwired=fixture();
  const unwiredResult=await unwired.call('godot_build_start',{revision:3,manifestHash:'b'.repeat(64),mode:'build'});
  assert.equal(unwiredResult.execution.enqueued,false);
  assert.equal(unwiredResult.execution.reason,'EXECUTOR_PROVIDER_NOT_WIRED');
  assert.equal(unwiredResult.execution.owner,'S2');
});

test('cancel and resume reach the live executor service',async()=>{
  const cancelled=[];
  const f=fixture({options:{executorCancel:async jobId=>{cancelled.push(jobId);return {cancelled:true};},
    executorEnqueue:async()=>({enqueued:true})}});
  const cancel=await f.call('godot_build_cancel',{jobId:'gjob-'+'a'.repeat(64)});
  assert.deepEqual(cancelled,['gjob-'+'a'.repeat(64)]);
  assert.equal(cancel.execution.cancelled,true);
  const resumed=await f.call('godot_jobs',{mode:'resume',originJobId:'gjob-'+'a'.repeat(64)});
  assert.equal(resumed.execution.enqueued,true);
  assert.equal(resumed.result.jobId,'gjob-'+'b'.repeat(64));
});

test('discussion mode still refuses every write even with live providers wired',async()=>{
  let enqueued=0;
  const f=fixture({options:{sampleLiveState:async()=>liveSample(),executorEnqueue:async()=>{enqueued+=1;return {enqueued:true};}}});
  // The broker reads settings when no host predicate is supplied.
  const g=fixture({settings:{discussionOnly:true},
    options:{sampleLiveState:async()=>liveSample(),executorEnqueue:async()=>{enqueued+=1;return {enqueued:true};}}});
  await assert.rejects(g.call('godot_build_start',{revision:3,manifestHash:'b'.repeat(64),mode:'build'}),/DISCUSSION_MODE_READ_ONLY/);
  await assert.rejects(g.call('godot_draft_recovery',{mode:'resume',taskId:'task-9',generation:2}),/DISCUSSION_MODE_READ_ONLY/);
  assert.equal(enqueued,0);
  // A read is still allowed in discussion mode.
  const state=await g.call('godot_runtime_state',{scope:'live'});
  assert.equal(state.live.available,true);
  assert.ok(f);
});
