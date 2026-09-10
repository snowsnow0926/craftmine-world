// The production plugin entry actually wires every service (task S6).
//
// The audited defect lived exactly here: `main.cjs` constructed the world tools
// without the sixth argument, so live sampling and the budget provider were
// missing in the shipped product. This test loads the real `main.cjs` from a
// private copy (stub domain bundle and stub core client), then calls the
// registered tools and proves the providers reached them. No engine, no Rust
// binary, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const source=path.join(root,'plugins/craftmine-world');
// The real plugin modules import private shared modules through
// '../../desktop/godot/shared', so the private copy keeps that exact layout:
// staging is <scratch>/plugins/craftmine-world and the shared modules sit at
// <scratch>/desktop/godot/shared.
const scratch=await mkdtemp(path.join(process.env.PI_SCRATCH_DIR||tmpdir(),'godot-round3-S6-load-'));
const staging=path.join(scratch,'plugins','craftmine-world');
const shared=path.join(scratch,'desktop','godot','shared');
await mkdir(staging,{recursive:true});
await mkdir(shared,{recursive:true});
// Every plugin file `main.cjs` loads at startup, directly or transitively. A
// missing entry fails the whole file with MODULE_NOT_FOUND before any assertion
// runs, so this list must cover the real entry point's local require closure.
// `domain.cjs` and `core-client.cjs` are deliberately absent: the test supplies
// stubs for them below.
const FILES=['manifest.json','main.cjs','world-tools.cjs','godot-routing.cjs','godot-docs.cjs','godot-query.cjs',
  'godot-observe.cjs','godot-capability.cjs','godot-history.cjs','godot-jobs.cjs','godot-library.cjs','tool-services.cjs',
  'verification-jobs.cjs','review-jobs.cjs','applications.cjs','host-requests.cjs','context-review.cjs',
  'workbench-service.cjs','godot-executor.cjs','godot-task-bin-retirement.cjs','asset-service.mjs','reuse-service.mjs',
  'portable-restore-service.cjs','package-turn-lifecycle.cjs','target-feedback-service.mjs','godot-package-source.mjs',
  'package-format.mjs','package-zip.mjs','asset-lock.mjs'];
// Imported by the staged plugin modules through the repository-relative path.
const SHARED=['draft_install.mjs','scene_materializer.mjs','target-feedback-configuration.mjs'];
for(const file of FILES)await copyFile(path.join(source,file),path.join(staging,file));
for(const file of SHARED)await copyFile(path.join(root,'desktop/godot/shared',file),path.join(shared,file));

const HANDSHAKE={format:'craftmine.core/1',godotProjects:true,godotBuildJobs:true,godotExecutorGate:true,
  verificationJobs:true,playerApplications:true,advisoryReviews:true,sessionDrafts:true,publishesWorlds:true};
const BINDING={projectId:'project',sessionId:'session',turnId:'turn',taskId:'task-1',baseBuild:'gbd-0'};
const ENVELOPE={format:'craftmine.godot-observation/1',worldId:'alpha',buildId:'gbd-7',instanceId:'inst-1',
  baseId:'first-person',baseVersion:'craftmine.base/3',sampledAt:new Date().toISOString(),
  payload:{base:'first-person',display:{cameraGlobal:{x:1,y:2,z:3}},equipment:{active:'pistol'},
    player:{yaw:0,pitch:0},targets:[],interactables:[],quests:[],inventory:[],hud:{},crosshair:{},aim:{}}};

// A stub core client so the real main.cjs can construct and the tools can run.
await writeFile(path.join(staging,'core-client.cjs'),`
const HANDSHAKE=${JSON.stringify(HANDSHAKE)};
const BINDING=${JSON.stringify(BINDING)};
const calls=[];
class CoreClient {
  constructor(binary,directory){this.binary=binary;this.directory=directory;}
  async start(){return HANDSHAKE;}
  async stop(){}
  async exclusive(run){await this.start();return run((method,params={})=>this.call(method,params));}
  async call(method,params={}){
    calls.push({method,params});
    if(method==='workspace.open')return {worldId:'alpha',revision:3,repoId:'repo-alpha',branchId:'main',
      expectedHeadOid:'a'.repeat(40),expectedAppliedOid:null,expectedProgressRevision:null,
      task:{binding:BINDING,draft:{revision:3,hash:'d'.repeat(64)},draftHash:'d'.repeat(64),revision:3}};
    if(method==='godotRuntime.describe')return {phase:'formal',worldId:'alpha',buildId:'gbd-7',baseId:'first-person',
      revision:3,contentHash:'d'.repeat(64),entry:'web/index.html',artifacts:[{path:'web/index.html'}],
      build:{godot:{engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web'}},snapshot:{savedAt:'2026-09-09T00:00:00Z'}};
    if(method==='godotProject.index')return {worldId:'alpha',revision:3,manifestHash:'b'.repeat(64),baseId:'first-person',
      baseBuild:'gbd-0',engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web',files:[],totalFiles:0,
      nextOffset:null,status:'source-only',verified:false,applied:false,executionAvailable:false,binaryAssetsAvailable:false};
    if(method==='godotCandidate.list')return {items:[],nextOffset:null};
    if(method==='task.context')return {binding:BINDING,generation:5};
    if(method==='budget.inspect')return {ownerTaskId:'task-1',requestCount:4,compactionCount:2,actualTokens:1200,
      reservedTokens:300,unknownRequestCount:1,chargedTokens:1500,remainingTokens:8500,
      limits:{maxRequests:50,maxTokens:10000,maxCompactions:6,deadlineAt:null}};
    if(method==='godotExecutor.status')return {format:'craftmine.godot-execution-status/1',build:false,check:false,
      buildBlockedReason:'GODOT_EXECUTOR_UNAVAILABLE',checkBlockedReason:'GODOT_EXECUTOR_UNAVAILABLE',executors:[]};
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
  }
}
module.exports={CoreClient,__calls:calls};
`,'utf8');
// The generated domain bundle is not built in this environment.
await writeFile(path.join(staging,'domain.cjs'),`
function fields(args,required,optional){
  const allowed=new Set([...(required||[]),...(optional||[])]);
  for(const key of Object.keys(args))if(!allowed.has(key))throw Object.assign(Error('UNKNOWN_FIELD: '+key),{errorCode:'UNKNOWN_FIELD'});
  for(const key of required||[])if(!Object.hasOwn(args,key))throw Object.assign(Error('MISSING_FIELD: '+key),{errorCode:'MISSING_FIELD'});
}
module.exports={fields,
  emptyWorld:title=>({build:{scene:{title}},snapshot:{}}),
  validateSnapshot:value=>value,
  prepareLegacyWorld:async()=>({}),
  readVerification:(job)=>({stub:true,job}),
  verificationSummary:()=>({stub:true}),
  createLibraryService:()=>({search:async()=>({}),read:async()=>({}),install:async()=>({receipt:{revision:1}})}),
  createMemoryService:()=>({search:async()=>({}),propose:async()=>({})})};
`,'utf8');

// The plugin host API surface `main.cjs` uses.
const liveRequests=[];
const registered=new Map();
globalThis.pi={
  plugin:{getDataPath:async()=>staging,getSettings:async()=>({activeWorldId:'alpha'}),setSettings:async()=>{}},
  craftmine:{
    godotLiveState:async input=>{liveRequests.push(input);return ENVELOPE;},
    verify:async()=>({}),cancelVerification:async()=>{},complete:async()=>({}),cancelComplete:async()=>{},
    godotCheck:async()=>({}),cancelGodotCheck:async()=>{},
  },
  services:{register:()=>{}},
  agent:{registerTool:async tool=>{registered.set(tool.name,tool);},unregisterTool:async name=>{registered.delete(name);}},
};
const plugin=createRequire(import.meta.url)(path.join(staging,'main.cjs'));
await plugin.onLoad();

const call=(name,args)=>registered.get(name).execute(args,
  {projectId:'project',sessionId:'session',turnId:'turn',executionId:'execution',toolCallId:'call-'+name});

test('the production entry registers the full advertised tool surface',()=>{
  assert.equal(registered.size,36);
  for(const name of ['godot_guidance','godot_capability_report','godot_runtime_state','godot_jobs','godot_draft_recovery','godot_history',
    'asset_library','package_library'])assert.ok(registered.has(name),name);
});

test('the capability report shows the providers the production entry actually passed',async()=>{
  const report=await call('godot_capability_report',{});
  const wired=report.services.wired.map(entry=>entry.key);
  for(const key of ['sampleLiveState','budget','executorStatus','executorEnqueue','executorCancel'])assert.ok(wired.includes(key),key);
  assert.equal(report.services.complete,true);
  assert.deepEqual(report.services.missing,[]);
  // Optional overrides with working defaults are not reported as gaps.
  assert.deepEqual(report.services.optionalMissing.map(entry=>entry.key).sort(),
    ['historyMethods','isDiscussionOnly','libraryMethods','maxSampleAgeMs']);
  assert.equal(report.limits.kinds.tokens.used,1500);
  assert.equal(report.limits.kinds.context.known,false);
});

test('live observation from the real entry reaches the host sampler',async()=>{
  const state=await call('godot_runtime_state',{scope:'live'});
  assert.equal(liveRequests.length,1);
  assert.equal(liveRequests[0].worldId,'alpha');
  assert.equal(state.live.available,true);
  assert.equal(state.live.equipment.active,'pistol');
  assert.equal(state.live.instanceId,'inst-1');
  assert.equal(state.live.provenance,'live-instance-sample');
  assert.equal(state.durableProgress.source,'last-confirmed-save');
});
