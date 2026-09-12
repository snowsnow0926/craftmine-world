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
const FILES=['manifest.json','world-tools.cjs','godot-routing.cjs','godot-docs.cjs','godot-query.cjs','godot-module-parameter-query.cjs',
  'godot-observe.cjs','godot-build-read-wait.cjs','creation-application-guidance.cjs','godot-capability.cjs','godot-history.cjs','godot-jobs.cjs','godot-library.cjs','tool-services.cjs','godot-engine-api.cjs','godot-diagnostics.cjs'];
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
  // Guidance and identity-bound view capture have installed AI1/R2 owners.
  assert.equal(report.tools.find(tool=>tool.name==='godot_view_capture').owner,'R2');
  assert.ok(report.tools.every(tool=>tool.owner===null||/^(S\d|AI1|R2)$/.test(tool.owner)),'tool owners must name an installed module owner');
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

test('check requirements come exclusively from the frozen host capture',async()=>{
 const requirements={format:'craftmine.creation-requirements/1',requestHash:'a'.repeat(64),entities:[{id:'tree-a',scale:[2,2,2]}],counts:[]};
 const f=fixture({options:{creationTarget:async()=>({creationRequirements:{status:'verifiable',requirements}})}});
 const args={revision:3,manifestHash:'b'.repeat(64),mode:'check'};
 await f.call('godot_build_start',args);
 assert.deepEqual(f.calls.find(call=>call.method==='godotBuild.start').params.checkRequirements,{format:'craftmine.godot-check-requirements/1',creation:requirements});
 await assert.rejects(f.call('godot_build_start',{...args,checkRequirements:{format:'fake'}}),/UNKNOWN_FIELD/);
 const unknown=fixture({options:{creationTarget:async()=>({creationRequirements:{status:'unverified',reason:'unknown'}})}});await unknown.call('godot_build_start',args);assert.equal(unknown.calls.find(call=>call.method==='godotBuild.start').params.checkRequirements,undefined);
});

test('production-style model read waits through a running job to terminal',async()=>{
 let reads=0;const f=fixture({options:{buildReadWaitMs:1000},coreOverrides:{'godotBuild.read':params=>({...params,kind:'check',buildId:'same-build',status:++reads===1?'running':'passed'})}});
 const result=await f.call('godot_build_read',{jobId:'gjob-'+'a'.repeat(64)});
 assert.equal(result.status,'passed');assert.equal(result.waitReason,'terminal');assert.ok(result.waitedMs>=450&&result.waitedMs<1500);assert.equal(reads,2);
 assert.equal(result.diagnostics.format,'craftmine.godot-diagnostics/1');assert.equal(result.diagnostics.reportedStatus,'passed');
 assert.equal(f.calls.filter(call=>call.method==='godotBuild.start').length,0);
});

test('API metadata absent from this private plugin is unknown while legacy digest remains available',async()=>{
 const f=fixture();
 assert.equal((await f.call('godot_docs',{mode:'info'})).engineVersion,'4.7.2-stable');
 const result=await f.call('godot_docs',{mode:'api-info'});
 assert.equal(result.status,'unknown');assert.equal(result.available,false);assert.equal(result.reason,'ENGINE_API_METADATA_MISSING');
 assert.deepEqual(f.calls,[]);
});

for(const waitMs of [0,1000])test(`diagnostics wraps ${waitMs?'wait':'direct'} reads without changing original output, hashes or candidate`,async()=>{
 const jobId='gjob-'+'a'.repeat(64),output={format:'craftmine.godot-job-result/1',inputHash:'c'.repeat(64),passed:false,
   import:{passed:false,log:'SCRIPT ERROR: Parse Error: Expected parameter name.\n   at: GDScript::reload (res://actor.gd:2)'},
   compile:{passed:false,errors:['SCRIPT ERROR: Parse Error: Expected parameter name.'],warnings:[]},check:{passed:false,assertions:[{id:'runtime.not-run',passed:false,detail:'GODOT_COMPILE_FAILED'}]}};
 const record={jobId,worldId:'alpha',buildId:'gbd-test',sourceRevision:3,manifestHash:'b'.repeat(64),outputHash:'d'.repeat(64),kind:'check',status:'failed',sourceStale:false,candidateId:null,output};
 const before=JSON.stringify(record),f=fixture({options:{buildReadWaitMs:waitMs},coreOverrides:{'godotBuild.read':()=>record}});
 const result=await f.call('godot_build_read',{jobId});
 for(const key of Object.keys(record))assert.deepEqual(result[key],record[key],key);
 assert.equal(JSON.stringify(record),before);assert.equal(Object.hasOwn(record,'diagnostics'),false);
 assert.equal(result.diagnostics.source.jobId,jobId);assert.equal(result.diagnostics.source.outputHash,record.outputHash);
 assert.equal(result.diagnostics.diagnostics[0].file,'res://actor.gd');assert.equal(result.diagnostics.diagnostics[0].line,2);
 assert.equal(result.diagnostics.acceptance,'not-assessed');
 assert.deepEqual(f.calls.map(call=>call.method),['workspace.open','godotBuild.read']);
});

for(const waitMs of [0,1000])test(`identity and world changes reject ${waitMs?'wait':'direct'} results before decoration`,async()=>{
 const jobId='gjob-'+'a'.repeat(64);
 const wrong=fixture({options:{buildReadWaitMs:waitMs},coreOverrides:{'godotBuild.read':()=>({jobId,worldId:'foreign',status:'failed'})}});
 await assert.rejects(wrong.call('godot_build_read',{jobId}),/GODOT_BUILD_READ_IDENTITY_CHANGED/);
 const settings={activeWorldId:'alpha'};
 const switched=fixture({settings,options:{buildReadWaitMs:waitMs},coreOverrides:{'godotBuild.read':()=>{settings.activeWorldId='other';return {jobId,worldId:'alpha',status:'failed'};}}});
 await assert.rejects(switched.call('godot_build_read',{jobId}),/GODOT_BUILD_READ_WORLD_CHANGED/);
});

test('diagnostics preserves a completed creation check and its separate application receipt',async()=>{
 const jobId='gjob-'+'a'.repeat(64),candidateId='gcan-test',buildId='gbd-test';
 const application={jobId,worldId:'alpha',buildId,candidateId,status:'applied',reason:null};
 const f=fixture({options:{buildReadWaitMs:1000,executorCreationCompletion:()=>application},
   coreOverrides:{'godotBuild.read':()=>({jobId,worldId:'alpha',buildId,candidateId,kind:'check',baseId:'creation-sandbox',status:'passed',output:{format:'craftmine.godot-job-result/1',passed:true,check:{passed:true,assertions:[]}}})}});
 const result=await f.call('godot_build_read',{jobId});
 assert.deepEqual(result.creationApplication,application);assert.equal(result.status,'passed');assert.equal(result.diagnostics.acceptance,'not-assessed');
});

const modeOf=(report,name,mode)=>report.tools.find(tool=>tool.name===name).modes.find(entry=>entry.mode===mode);

test('capability report refreshes live build/check/resume readiness through the real broker',async()=>{
 let sample={format:'craftmine.godot-executor-status/1',state:'registered',available:true,
   buildAvailable:true,checkAvailable:true,reason:null};
 let reads=0;
 const f=fixture({options:{executorStatus:async()=>{reads+=1;return sample;},executorEnqueue:async()=>({enqueued:true})}});
 const available=await f.call('godot_capability_report');
 for(const [tool,mode] of [['godot_build_start','build'],['godot_build_start','check'],['godot_jobs','resume']]){
  const entry=modeOf(available,tool,mode);assert.equal(entry.reachable,true);assert.equal(entry.execution.state,'available');
 }
 sample={...sample,checkAvailable:false};
 const buildOnly=await f.call('godot_capability_report');
 assert.equal(modeOf(buildOnly,'godot_build_start','build').execution.available,true);
 assert.equal(modeOf(buildOnly,'godot_build_start','check').execution.state,'blocked');
 const resume=modeOf(buildOnly,'godot_jobs','resume').execution;
 assert.equal(resume.available,null);assert.equal(resume.reason,'ORIGIN_JOB_KIND_REQUIRED');
 assert.equal(resume.byJobKind.build.available,true);assert.equal(resume.byJobKind.check.available,false);
 sample={...sample,state:'stopped',available:false,buildAvailable:false,reason:'GODOT_EXECUTOR_STOPPED'};
 const offline=await f.call('godot_capability_report');
 assert.equal(modeOf(offline,'godot_build_start','build').execution.state,'blocked');
 assert.equal(modeOf(offline,'godot_jobs','resume').execution.state,'blocked');
 assert.equal(offline.tools.find(tool=>tool.name==='godot_build_start').reachable,true,'registration is not execution');
 assert.equal(modeOf(offline,'godot_jobs','usage').reachable,true);
 assert.equal(modeOf(offline,'godot_jobs','status').reachable,true);
 for(const name of ['godot_build_read','godot_build_cancel'])assert.equal(offline.tools.find(tool=>tool.name===name).reachable,true);
 sample={...sample,state:'registered',available:true,buildAvailable:true,checkAvailable:true,reason:null};
 const recovered=await f.call('godot_capability_report');
 assert.equal(modeOf(recovered,'godot_jobs','resume').execution.available,true);
 assert.equal(reads,4,'no cached live gate survives another report');
 assert.equal(available.contract.digest,recovered.contract.digest);
 assert.equal(offline.contract.digest,recovered.contract.digest,'dynamic status is outside contract identity');
 assert.ok(!f.calls.some(call=>call.method==='workspace.open'||call.method==='godotExecutor.status'));
});

test('missing, failed, malformed and registration-only executor evidence stays unknown',async()=>{
 const scenarios=[
  {options:{},reason:'LIVE_EXECUTOR_STATUS_UNAVAILABLE'},
  {options:{executorStatus:async()=>{throw Error('offline transport');}},reason:'EXECUTOR_STATUS_FAILED'},
  {options:{executorStatus:async()=>{throw Object.assign(Error('unavailable'),{errorCode:'GODOT_EXECUTOR_UNAVAILABLE'});}},reason:'GODOT_EXECUTOR_UNAVAILABLE'},
  {options:{executorStatus:async()=>null},reason:'EXECUTOR_STATUS_INVALID'},
  {options:{executorStatus:async()=>({available:true})},reason:'EXECUTOR_STATUS_INVALID'},
  {options:{executorStatus:async()=>({available:true,buildAvailable:true,checkAvailable:true})},reason:'EXECUTOR_PROVIDER_NOT_WIRED'},
  {options:{},coreOverrides:{'godotExecutor.status':()=>{throw Error('registration failure');}},reason:'LIVE_EXECUTOR_STATUS_UNAVAILABLE'},
  {options:{},coreOverrides:{'godotExecutor.status':()=>({build:true,check:true,executors:[{executorId:'stale'}]})},reason:'LIVE_EXECUTOR_STATUS_UNAVAILABLE'}
 ];
 for(const scenario of scenarios){
  const f=fixture(scenario);const report=await f.call('godot_capability_report');
  for(const [tool,mode] of [['godot_build_start','build'],['godot_build_start','check'],['godot_jobs','resume']]){
   const execution=modeOf(report,tool,mode).execution;
   assert.equal(execution.state,'unknown',scenario.reason);assert.equal(execution.available,null);
   assert.equal(execution.reason,scenario.reason);
  }
 }
});

test('an offline executor does not intercept reads or cancellation',async()=>{
 let statusReads=0;let cancellations=0;
 const f=fixture({options:{executorStatus:async()=>{statusReads+=1;return {available:false,reason:'STOPPED'};},
  executorCancel:async()=>{cancellations+=1;return {cancelled:true};}},
  coreOverrides:{'godotBuild.read':params=>({jobId:params.jobId,worldId:params.worldId,status:'cancelled',kind:'build'})}});
 await f.call('godot_capability_report');
 assert.equal((await f.call('godot_jobs',{mode:'usage'})).scope,'usage');
 assert.equal((await f.call('godot_build_read',{jobId:'gjob-1'})).status,'cancelled');
 assert.equal((await f.call('godot_build_cancel',{jobId:'gjob-1'})).cancelled,true);
 assert.equal(statusReads,1);assert.equal(cancellations,1);
});

test('a failed live query can recover on the same broker instance without a stale registration fallback',async()=>{
 let fails=true;
 const f=fixture({options:{executorStatus:async()=>{if(fails)throw Error('temporary');return {available:true,buildAvailable:true,checkAvailable:true};},
  executorEnqueue:async()=>({enqueued:true})}});
 assert.equal(modeOf(await f.call('godot_capability_report'),'godot_build_start','build').execution.available,null);
 fails=false;
 assert.equal(modeOf(await f.call('godot_capability_report'),'godot_build_start','build').execution.available,true);
 assert.ok(!f.calls.some(call=>call.method==='godotExecutor.status'));
});

test('production project_facts reconstructs durable failure identity without a remembered job ID',async()=>{
 const jobId='gjob-'+'f'.repeat(64),budget={ownerTaskId:'original-owner',requestCount:3,unknownRequestCount:1,chargedTokens:50,limits:{maxTokens:null,maxRequests:80,maxCompactions:8,deadlineAt:null}};
 const f=fixture({coreOverrides:{
  'task.context':()=>({binding:BINDING,world:{id:'alpha'},generation:2,status:'active',draft:{revision:9,hash:'d'.repeat(64)},budget}),
  'godotBuild.latest':params=>{assert.deepEqual(params,{worldId:'alpha',sessionId:'session'});return {worldId:'alpha',jobId,taskId:'task-1',buildId:'failed-build',kind:'check',status:'failed',sourceRevision:2,manifestHash:'a'.repeat(64),sourceStale:true,candidateId:null,
   output:{format:'craftmine.godot-job-result/1',passed:false,compile:{errors:['SCRIPT ERROR: Parse Error: Expected parameter name.']},check:{passed:false,assertions:[]}}};}
 }});
 const facts=await f.call('godot_project_facts');
 assert.equal(facts.recovery.latestJob.jobId,jobId);assert.equal(facts.recovery.latestJob.scope,'current-task');
 assert.equal(facts.recovery.latestJob.sourceComparison.relation,'different-source');
 assert.equal(facts.recovery.latestJob.diagnostics.diagnostics[0].errorCode,'GODOT_SCRIPT_PARSE_ERROR');
 assert.deepEqual(facts.recovery.budget.value,budget);assert.equal(facts.recovery.application.available,false);
 assert.ok(!f.calls.some(call=>/\.start$|\.continue$|\.reserve$|\.configure$|\.finish$/.test(call.method)));
});

test('ordinary registered build-read returns passed/deferred immediately while the author turn remains active',async()=>{
 const jobId='gjob-'+'a'.repeat(64),candidateId='candidate-final',buildId='build-final';
 const application={jobId,worldId:'alpha',buildId,candidateId,status:'deferred',reason:'CREATION_AWAITING_TURN_FINISH'};
 const f=fixture({options:{buildReadWaitMs:1000,executorCreationCompletion:()=>application},coreOverrides:{'godotBuild.read':()=>({jobId,worldId:'alpha',buildId,candidateId,kind:'check',baseId:'creation-sandbox',status:'passed',output:{passed:true,check:{passed:true,assertions:[]}}})}});
 const result=await f.call('godot_build_read',{jobId});assert.equal(result.status,'passed');assert.equal(result.creationApplication.status,'deferred');assert.equal(result.waitReason,'terminal');
 assert.equal(f.calls.filter(call=>call.method==='godotBuild.read').length,1,'Does not wait for its own turn-end event and deadlock the model');
});

for(const reason of ['CREATION_TURN_BUSY','CREATION_AWAITING_TURN_FINISH'])test('registered full-auto read explains its actual after-turn handoff: '+reason,async()=>{
 const jobId='gjob-'+'a'.repeat(64),candidateId='candidate-final',buildId='build-final';
 const application={jobId,worldId:'alpha',buildId,candidateId,status:'deferred',reason};
 const capture={format:'craftmine.creation-target/1',worldId:'alpha',snapshotId:'snapshot-owned',authorization:'full-auto',autoApply:true};
 const f=fixture({options:{buildReadWaitMs:1000,creationTarget:async context=>{assert.deepEqual(context,{projectId:'project',sessionId:'session',turnId:'turn'});return capture;},executorCreationCompletion:()=>application},coreOverrides:{'godotBuild.read':()=>({jobId,worldId:'alpha',buildId,candidateId,kind:'check',baseId:'creation-sandbox',status:'passed'})}});
 const result=await f.call('godot_build_read',{jobId});assert.deepEqual(result.creationApplication,application);
 assert.equal(result.applicationGuidance.adoptionConfirmed,false);assert.equal(result.applicationGuidance.playerActionRequired,false);
 assert.equal(result.applicationGuidance.nextAction,'finish-current-turn-if-work-complete');assert.equal(result.applicationGuidance.timing,'after-current-turn-settles');
 assert.equal(result.applicationGuidance.owner.sessionId,'session');assert.equal(result.applicationGuidance.jobId,jobId);
 assert.match(result.applicationGuidance.playerMessage,/本轮创作结束后自动放入世界/);assert.equal(f.calls.filter(c=>c.method==='godotBuild.read').length,1);
});

for(const capture of [null,{worldId:'foreign',authorization:'full-auto',autoApply:true},{worldId:'alpha',authorization:'full-auto',autoApply:false},{worldId:'alpha',authorization:'world-policy',autoApply:true},{worldId:'alpha',authorization:'full-auto',autoApply:true,supersededBy:{turnId:'new'}}])test('registered read does not promise automatic handoff from missing, foreign or revoked capture: '+JSON.stringify(capture),async()=>{
 const jobId='gjob-'+'a'.repeat(64),candidateId='candidate-final',buildId='build-final',application={jobId,worldId:'alpha',buildId,candidateId,status:'deferred',reason:'CREATION_TURN_BUSY'};
 const f=fixture({options:{creationTarget:async()=>capture&&{format:'craftmine.creation-target/1',snapshotId:'snapshot-owned',...capture},executorCreationCompletion:()=>application},coreOverrides:{'godotBuild.read':()=>({jobId,worldId:'alpha',buildId,candidateId,kind:'check',baseId:'creation-sandbox',status:'passed'})}});
 const result=await f.call('godot_build_read',{jobId});assert.deepEqual(result.creationApplication,application);assert.equal(result.applicationGuidance.mode,'manual-or-unavailable');assert.equal(result.applicationGuidance.playerActionRequired,null);assert.notEqual(result.applicationGuidance.nextAction,'finish-current-turn-if-work-complete');
});

test('registered Ask/manual check still requests ordinary result confirmation without changing its receipt',async()=>{
 const jobId='gjob-'+'a'.repeat(64),candidateId='candidate-final',buildId='build-final',application={jobId,worldId:'alpha',buildId,candidateId,status:'manual',reason:'CREATION_AUTO_APPLY_NOT_AUTHORIZED'};
 const f=fixture({options:{creationTarget:async()=>({format:'craftmine.creation-target/1',worldId:'alpha',snapshotId:'snapshot-owned',authorization:'world-policy',autoApply:false}),executorCreationCompletion:()=>application},coreOverrides:{'godotBuild.read':()=>({jobId,worldId:'alpha',buildId,candidateId,kind:'check',baseId:'creation-sandbox',status:'passed'})}});
 const result=await f.call('godot_build_read',{jobId});assert.deepEqual(result.creationApplication,application);
 assert.equal(result.applicationGuidance.playerActionRequired,true);assert.equal(result.applicationGuidance.adoptionConfirmed,false);assert.match(result.applicationGuidance.playerMessage,/确认采用/);
});
