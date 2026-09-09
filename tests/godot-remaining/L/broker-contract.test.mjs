// Broker routing and guard tests.
//
// The broker is loaded from a private copy with a stub domain layer, so this
// test proves routing, identity checks, the discussion-only guard and the new
// Godot tools without depending on the generated domain bundle or the Rust
// binary. The real Rust store is exercised in broker-real-core.test.mjs.
// No engine, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const source=path.join(root,'plugins/craftmine-world');
const staging=await mkdtemp(path.join(process.env.PI_SCRATCH_DIR||tmpdir(),'godot-remaining-L-broker-'));
const FILES=['manifest.json','world-tools.cjs','godot-routing.cjs','godot-docs.cjs','godot-query.cjs',
  'godot-observe.cjs','godot-capability.cjs','godot-history.cjs'];
for(const file of FILES)await copyFile(path.join(source,file),path.join(staging,file));

// Minimal stand-in for the generated domain bundle. Only the names the broker
// destructures, with the same field-allowlist semantics it relies on.
await writeFile(path.join(staging,'domain.cjs'),`
function fields(args,required,optional){
  const allowed=new Set([...(required||[]),...(optional||[])]);
  for(const key of Object.keys(args))if(!allowed.has(key))throw Object.assign(Error('UNKNOWN_FIELD: '+key),{errorCode:'UNKNOWN_FIELD'});
  for(const key of required||[])if(!Object.hasOwn(args,key))throw Object.assign(Error('MISSING_FIELD: '+key),{errorCode:'MISSING_FIELD'});
}
module.exports={
  fields,
  inspectDraft:()=>({stub:true}),
  readDraftResource:()=>({stub:true}),
  patchDraft:()=>({stub:true,changed:[],draft:{}}),
  readCapabilities:()=>({stub:true}),
  readVerification:(job)=>({stub:true,job}),
  draftPackages:()=>({extensions:[]}),
  createLibraryService:()=>({search:async()=>({stub:true}),read:async()=>({stub:true}),install:async()=>({stub:true})}),
  createMemoryService:()=>({search:async()=>({stub:true}),propose:async()=>({stub:true})}),
};
`,'utf8');

const {createWorldTools}=require(path.join(staging,'world-tools.cjs'));

const PROJECT_GODOT='config_version=5\n[application]\nconfig/name="Probe"\nrun/main_scene="res://world.tscn"\n';
const WORLD_GD='class_name Probe\n@export var damage: float = 4.0\nfunc ping() -> void:\n\tpass\n';
const STORE=new Map([['project.godot',PROJECT_GODOT],['world.gd',WORLD_GD]]);
const HANDSHAKE={format:'craftmine.core/1',godotProjects:true,godotExecution:false,godotBuildJobs:true,
  godotExecutorGate:true,verificationJobs:true,playerApplications:true,advisoryReviews:true,sessionDrafts:true,
  publishesWorlds:true,agentPublishesWorlds:false};

let sequence=0;
function fixture({discussionOnly=false,sampler,historyMethods,settingsFlag=false}={}){
  const calls=[];
  const core={start:async()=>HANDSHAKE,call:async(method,params)=>{
    calls.push({method,params});
    if(method==='workspace.open')return {worldId:'alpha',task:{binding:{taskId:'task-1',baseBuild:'gbd-0',
      repoId:'world-alpha',branchId:'plan-1'},revision:3,draftHash:'h'.repeat(64),draft:{scene:{objects:[],systems:[],behaviors:[]}}}};
    if(method==='godotProject.index'){
      const files=[...STORE.keys()].map(file=>({path:file,sha256:'a'.repeat(64),bytes:STORE.get(file).length}));
      const offset=params.offset||0,limit=params.limit||32;
      const page=files.slice(offset,offset+limit);
      return {format:'craftmine.godot-project/1',worldId:'alpha',revision:3,manifestHash:'b'.repeat(64),
        baseId:'first-person',baseBuild:'gbd-0',engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web',
        files:page,totalFiles:files.length,nextOffset:offset+page.length<files.length?offset+page.length:null,
        status:'source-only',verified:false,applied:false,executionAvailable:false,binaryAssetsAvailable:false};
    }
    if(method==='godotProject.read'){
      const text=STORE.get(params.path);
      if(text===undefined)throw Object.assign(Error('PROJECT_FILE_NOT_FOUND'),{errorCode:'PROJECT_FILE_NOT_FOUND'});
      const chars=Array.from(text),offset=params.offset||0,limit=params.limit||16000;
      const slice=chars.slice(offset,offset+limit).join('');
      const next=offset+Array.from(slice).length;
      return {worldId:'alpha',revision:3,manifestHash:'b'.repeat(64),path:params.path,sha256:'a'.repeat(64),
        bytes:text.length,offset,text:slice,totalCharacters:chars.length,nextOffset:next<chars.length?next:null};
    }
    if(method==='godotCandidate.list')return {items:[{id:'gcan-1',buildId:'gbd-1',baseId:'first-person',
      status:'ready',checkJobId:'job-1',checkOutputHash:'c'.repeat(64)}],nextOffset:null};
    if(method==='godotRuntime.describe')return {phase:'formal',worldId:'alpha',buildId:'gbd-1',baseId:'first-person',
      revision:3,contentHash:'d'.repeat(64),entry:'web/index.html',threads:true,artifactManifestHash:'e'.repeat(64),
      artifacts:[{path:'web/index.html'}],build:{godot:{engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web'}},
      snapshot:{savedAt:'2026-09-09T00:00:00Z',base:'first-person',equipment:{active:'pistol'}}};
    if(method==='godotProject.create')return {worldId:'alpha',status:'source-only'};
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
  }};
  const invocation={projectId:'project',sessionId:'session',turnId:'turn',executionId:'execution'};
  const tools=createWorldTools(core,async()=>({activeWorldId:'alpha',...(settingsFlag?{discussionOnly:true}:{})}),()=>false,undefined,undefined,
    {isDiscussionOnly:()=>discussionOnly,sampleLiveState:sampler,
      budget:()=>({tokens:{limit:1000,used:1000},requests:{used:2},context:{limit:80000,used:900}}),historyMethods});
  const call=(name,args={},extra={})=>tools.find(tool=>tool.name===name).execute(args,
    {...invocation,toolCallId:'call-'+(++sequence),...extra});
  return {call,calls};
}

test('the advertised Godot surface is 17 tools and leaks no host identity field',async()=>{
  const manifest=JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'));
  const tools=manifest.contributes.agentTools.filter(tool=>tool.name.startsWith('godot_'));
  assert.equal(tools.length,17);
  for(const name of ['godot_docs','godot_project_query','godot_runtime_state','godot_project_facts',
    'godot_capability_report','godot_history'])assert.ok(tools.some(tool=>tool.name===name),`missing ${name}`);
  for(const tool of tools){
    assert.equal(tool.schema.additionalProperties,false);
    for(const key of ['worldId','context','toolCallId','baseBuild','executionId'])assert.ok(!Object.hasOwn(tool.schema.properties,key));
  }
});

test('godot_docs answers without a world binding or any host mutation',async()=>{
  const f=fixture();
  const info=await f.call('godot_docs',{mode:'info'});
  assert.equal(info.engineVersion,'4.7.2-stable');
  const search=await f.call('godot_docs',{mode:'search',query:'raycast'});
  assert.ok(search.matches.length>0);
  const read=await f.call('godot_docs',{mode:'read',id:'camera3d-and-rays',limit:200});
  assert.equal(read.untrusted.trust,'untrusted-reference-data');
  await assert.rejects(f.call('godot_docs',{mode:'nonsense'}),/INVALID_DOCS_MODE/);
  assert.deepEqual(f.calls.map(entry=>entry.method),[],'documentation must not touch the world store');
});

test('godot_capability_report advertises what is really reachable',async()=>{
  const f=fixture();
  const report=await f.call('godot_capability_report',{});
  assert.equal(report.handshake.godotBuildJobs,true);
  assert.equal(report.handshake.godotExecution,false);
  assert.equal(report.tools.length,30,'all advertised world tools except runtime_info');
  assert.equal(report.tools.filter(tool=>tool.wired===false).length,0);
  assert.equal(report.tools.find(tool=>tool.name==='workspace_patch').reachable,true);
  assert.equal(report.tools.find(tool=>tool.name==='godot_build_start').reachable,true);
  const unreachable=report.unreachableMethods.find(entry=>entry.method==='godotApplication.prepare');
  assert.equal(unreachable.reachable,false);
  assert.equal(unreachable.capabilityEnabled,true);
  assert.ok(report.unreachableMethods.some(entry=>entry.method==='godotApplication.prepare'));
  const classified=await f.call('godot_capability_report',{request:'add a minimap',
    evidence:[{kind:'ordinary-gdscript-sufficient',source:'Control + Camera2D'}]});
  assert.equal(classified.gapClassifications[0].category,'developable-with-ordinary-script');
});

test('discussion-only turns may read but never write',async()=>{
  const f=fixture({discussionOnly:true});
  await f.call('godot_docs',{mode:'info'});
  await f.call('godot_project_query',{mode:'summary'});
  await assert.rejects(f.call('godot_project_create',{baseId:'first-person',files:[{path:'project.godot',text:'x'}]}),
    /DISCUSSION_MODE_READ_ONLY/);
  await assert.rejects(f.call('godot_project_patch',{revision:1,manifestHash:'a'.repeat(64),operations:[]}),
    /DISCUSSION_MODE_READ_ONLY/);
  assert.ok(!f.calls.some(entry=>entry.method==='godotProject.create'),'no write may reach the store');
});

test('a host settings flag blocks writes even when no options predicate is passed',async()=>{
  const f=fixture({settingsFlag:true});
  for(const [name,args] of [['godot_project_patch',{revision:1,manifestHash:'a'.repeat(64),operations:[]}],
    ['godot_build_cancel',{jobId:'job-1'}],['verification_cancel',{id:'verify-1'}],
    ['workspace_patch',{workspaceRevision:1,operations:[]}]]){
    await assert.rejects(f.call(name,args),/DISCUSSION_MODE_READ_ONLY/,name);
  }
  await f.call('godot_project_query',{mode:'summary'});
  assert.ok(!f.calls.some(entry=>/^(godotProject\.patch|godotBuild\.cancel|verification\.cancel|workspace\.commit)$/.test(entry.method)));
});

test('godot_project_query reads the real project shape through the broker',async()=>{
  const f=fixture();
  const summary=await f.call('godot_project_query',{mode:'summary'});
  assert.equal(summary.identity.baseId,'first-person');
  assert.equal(summary.mainScene,'res://world.tscn');
  const scripts=await f.call('godot_project_query',{mode:'scripts'});
  assert.equal(scripts.scripts[0].className,'Probe');
  const found=await f.call('godot_project_query',{mode:'find',name:'ping'});
  assert.deepEqual(found.matches,[{path:'world.gd',kind:'func',line:3,returns:'void'}]);
  await assert.rejects(f.call('godot_project_query',{mode:'scene'}),/PATH_REQUIRED/);
  await assert.rejects(f.call('godot_project_query',{mode:'find'}),/SYMBOL_NAME_REQUIRED/);
});

test('live observation refuses to substitute saved progress for current state',async()=>{
  const unwired=fixture();
  const state=await unwired.call('godot_runtime_state',{scope:'live'});
  assert.equal(state.descriptor.available,true);
  assert.equal(state.descriptor.buildId,'gbd-1');
  assert.equal(state.live.available,false);
  assert.equal(state.live.reason,'LIVE_OBSERVATION_NOT_WIRED');
  assert.equal(state.durableProgress.source,'last-confirmed-save');
  assert.equal(state.durableProgress.savedAt,'2026-09-09T00:00:00Z');
  // The saved snapshot body must never travel inside a live response.
  assert.equal(state.descriptor.durableProgress,undefined);
  assert.deepEqual(Object.keys(state.durableProgress).sort(),['savedAt','source']);
  assert.ok(!JSON.stringify(state).includes('pistol'),'saved equipment must not appear in a live response');
  assert.equal(state.docsCompatibility.compatible,true);
  const wired=fixture({sampler:async()=>({sampledAt:'2026-09-10T12:00:00Z',worldId:'alpha',buildId:'gbd-1',
    base:'first-person',equipment:{active:'rifle'},display:{cameraGlobal:[1,2,3]},targets:[],interactables:[]})});
  const live=await wired.call('godot_runtime_state',{scope:'live'});
  assert.equal(live.live.available,true);
  assert.equal(live.live.equipment.active,'rifle');
  assert.equal(live.live.stale,false);
  const build=await wired.call('godot_runtime_state',{scope:'build'});
  assert.equal(build.phase,'formal');
  assert.ok(!('live' in build));
  assert.equal(build.durableProgress,undefined);
});

test('godot_project_facts rebuilds durable facts and preserves unknown limits',async()=>{
  const f=fixture();
  const facts=await f.call('godot_project_facts',{});
  assert.equal(facts.project.revision,3);
  assert.equal(facts.runtime.buildId,'gbd-1');
  assert.equal(facts.candidates.items[0].status,'ready');
  assert.equal(facts.live.reason,'LIVE_OBSERVATION_NOT_WIRED');
  assert.deepEqual(facts.limits.exhausted,['tokens']);
  assert.equal(facts.limits.kinds.compactions.known,false);
  assert.match(facts.block,/project: revision=3/);
});

test('godot_history reports the exact missing adapter and never calls git',async()=>{
  const f=fixture();
  const history=await f.call('godot_history',{mode:'history'});
  assert.equal(history.available,false);
  assert.equal(history.requiredHostMethod,'version.history');
  assert.equal(history.owner,'M');
  const assets=await f.call('godot_history',{mode:'asset-search',query:'shop'});
  assert.equal(assets.owner,'N');
  await assert.rejects(f.call('godot_history',{mode:'asset-read'}),/ASSET_REF_REQUIRED/);
  await assert.rejects(f.call('godot_history',{mode:'asset-read',
    ref:{assetId:'latest',version:1,contentHash:'a'.repeat(64)}}),/ASSET_REF_MUST_NOT_BE_LATEST/);
  const proposal=await f.call('godot_history',{mode:'install-proposal',
    ref:{assetId:'shop-kit',version:1,contentHash:'a'.repeat(64)},intent:'variant',target:{name:'shop-v2'}});
  assert.equal(proposal.applies,false);
  assert.equal(proposal.requiresPlayerAction,true);
  assert.ok(!f.calls.some(entry=>/^(git|shell|exec)/.test(entry.method)));
});

test('the broker still rejects forged fields and ended turns for the new tools',async()=>{
  const f=fixture();
  await assert.rejects(f.call('godot_docs',{mode:'info',worldId:'forged'}),/UNKNOWN_FIELD/);
  await assert.rejects(f.call('godot_runtime_state',{scope:'live',context:{}}),/UNKNOWN_FIELD/);
  await assert.rejects(f.call('godot_project_facts',{extra:true}),/UNKNOWN_FIELD/);
  await assert.rejects(f.call('godot_docs',{mode:'info'},{toolCallId:'@host:forged'}),/RESERVED_HOST_RECEIPT/);
  await assert.rejects(f.call('godot_docs',{mode:'info'},{executionId:''}),/HOST_IDENTITY_REQUIRED/);
});

console.log('evidence_directory='+staging);
