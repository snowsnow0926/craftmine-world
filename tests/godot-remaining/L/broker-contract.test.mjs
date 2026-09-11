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
  'godot-observe.cjs','godot-capability.cjs','godot-history.cjs','godot-jobs.cjs','godot-library.cjs','tool-services.cjs'];
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
function fixture({discussionOnly=false,sampler,historyMethods,settingsFlag=false,noWorld=false,registered=false,store=STORE}={}){
  const calls=[];
  const core={start:async()=>({...HANDSHAKE,...(registered?{contentHistory:true,assetCatalog:true,creationPackages:true}:{})}),call:async(method,params)=>{
    calls.push({method,params});
    if(registered){
      if(method==='task.context')return {world:{id:'alpha'}};
      if(method==='content.status')return {registered:true,repoId:'world-alpha'};
      if(['content.history','content.changes','content.operation.read','asset.search','asset.read','asset.versions',
        'package.check','package.read','package.list'].includes(method))return {items:[],method};
    }
    if(method==='workspace.open')return {worldId:'alpha',task:{binding:{taskId:'task-1',baseBuild:'gbd-0',
      repoId:'world-alpha',branchId:'plan-1'},revision:3,draftHash:'h'.repeat(64),draft:{scene:{objects:[],systems:[],behaviors:[]}}}};
    if(method==='godotProject.index'){
      const files=[...store.keys()].map(file=>({path:file,sha256:'a'.repeat(64),bytes:store.get(file).length}));
      const offset=params.offset||0,limit=params.limit||32;
      const page=files.slice(offset,offset+limit);
      return {format:'craftmine.godot-project/1',worldId:'alpha',revision:3,manifestHash:'b'.repeat(64),
        baseId:'first-person',baseBuild:'gbd-0',engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web',
        files:page,totalFiles:files.length,nextOffset:offset+page.length<files.length?offset+page.length:null,
        status:'source-only',verified:false,applied:false,executionAvailable:false,binaryAssetsAvailable:false};
    }
    if(method==='godotProject.read'){
      const text=store.get(params.path);
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
    if(method==='godotExecutor.status')return {format:'craftmine.godot-execution-status/1',engineVersion:'4.7.2-stable',
      build:true,check:true,buildBlockedReason:null,checkBlockedReason:null,executors:[{executorId:'exec-1'}]};
    if(method==='godotJob.usage')return {items:[{jobId:'job-1',kind:'build',outcome:'passed',wallClockMillis:1200,
      sourceBytes:10,assetBytes:0,hostBytes:0,artifactBytes:100,artifactCount:2}],
      totals:{executions:1,wallClockMillis:1200,sourceBytes:10,assetBytes:0,hostBytes:0,artifactBytes:100,artifactCount:2}};
    if(method==='godotJob.continue')return {jobId:'job-2',status:'queued'};
    if(method==='task.recoverable')return {items:[{taskId:'task-9',binding:{sessionId:'session',projectId:'project'},
      generation:2,worldId:'alpha',draftRevision:4,draftHash:'f'.repeat(64),status:'interrupted'}],modelReplay:false};
    if(method==='task.resume')return {workspace:{worldId:'alpha'},generation:3,budget:{},modelReplay:false};
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
  }};
  const invocation={projectId:'project',sessionId:'session',turnId:'turn',executionId:'execution'};
  const tools=createWorldTools(core,async()=>({activeWorldId:noWorld?undefined:'alpha',...(settingsFlag?{discussionOnly:true}:{})}),()=>false,undefined,undefined,
    {isDiscussionOnly:()=>discussionOnly,sampleLiveState:sampler,
      budget:()=>({tokens:{limit:1000,used:1000},requests:{used:2},context:{limit:80000,used:900}}),historyMethods});
  const call=(name,args={},extra={})=>tools.find(tool=>tool.name===name).execute(args,
    {...invocation,toolCallId:'call-'+(++sequence),...extra});
  return {call,calls};
}

test('the advertised Godot surface is 20 tools and leaks no host identity field',async()=>{
  const manifest=JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'));
  const tools=manifest.contributes.agentTools.filter(tool=>tool.name.startsWith('godot_'));
  assert.equal(tools.length,20);
  for(const name of ['godot_docs','godot_guidance','godot_project_query','godot_runtime_state','godot_project_facts',
    'godot_capability_report','godot_history','godot_jobs','godot_draft_recovery'])assert.ok(tools.some(tool=>tool.name===name),`missing ${name}`);
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
  assert.equal(report.tools.length,36,'all advertised world tools except runtime_info');
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

test('query continuation fields traverse the real broker schema and immutable source reads',async()=>{
  const f=fixture({store:new Map([...STORE,['last.gd','extends Node\nfunc last_symbol():\n pass\n']])});
  const first=await f.call('godot_project_query',{mode:'scripts',limit:1});
  assert.equal(first.nextOffset,1);
  const callStart=f.calls.length;
  const pin={revision:first.identity.revision,manifestHash:first.identity.manifestHash};
  const last=await f.call('godot_project_query',{mode:'scripts',offset:first.nextOffset,limit:1,...pin});
  assert.equal(last.scripts[0].path,'last.gd');assert.equal(last.nextOffset,null);
  const reads=f.calls.slice(callStart).filter(entry=>/^godotProject\.(index|read)$/.test(entry.method));
  assert.ok(reads.length>=2);
  for(const read of reads){assert.equal(read.params.revision,pin.revision);assert.equal(read.params.manifestHash,pin.manifestHash);}
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
  const wired=fixture({sampler:async()=>({sampledAt:new Date().toISOString(),worldId:'alpha',buildId:'gbd-1',instanceId:'inst-1',
    base:'first-person',equipment:{active:'rifle'},display:{cameraGlobal:[1,2,3]},targets:[],interactables:[]})});
  const live=await wired.call('godot_runtime_state',{scope:'live'});
  assert.equal(live.live.available,true);
  assert.equal(live.live.instanceId,'inst-1');
  assert.equal(live.live.equipment.active,'rifle');
  assert.equal(live.live.stale,false);
  // A replaced game process is reported, then becomes the new baseline.
  let instance='inst-1';
  const replaced=fixture({sampler:async()=>({sampledAt:new Date().toISOString(),worldId:'alpha',buildId:'gbd-1',
    instanceId:instance,base:'first-person',equipment:{active:'sword'},display:{cameraGlobal:[0,0,0]},
    targets:[],interactables:[]})});
  await replaced.call('godot_runtime_state',{scope:'live'});
  instance='inst-2';
  const swapped=await replaced.call('godot_runtime_state',{scope:'live'});
  assert.equal(swapped.live.instanceChanged,true);
  assert.equal(swapped.live.stale,false);
  const settled=await replaced.call('godot_runtime_state',{scope:'live'});
  assert.equal(settled.live.instanceChanged,false,'the new instance is now the baseline');
  assert.equal(settled.live.stale,false);
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
  assert.equal(history.requiredHostMethod,'content.history');
  assert.equal(history.owner,'M');
  const proposal=await f.call('godot_history',{mode:'checkpoint',
    contentRef:{repoId:'world-alpha',commitOid:'abc1234',assetLockHash:'a'.repeat(64)}});
  assert.equal(proposal.applies,false);
  assert.equal(proposal.requiresPlayerAction,true);
  assert.ok(!f.calls.some(entry=>/^(git|shell|exec)/.test(entry.method)));
});

test('the executor gate answers without a bound world',async()=>{
  const f=fixture({noWorld:true});
  const status=await f.call('godot_jobs',{mode:'status'});
  assert.equal(status.scope,'executor');
  assert.equal(status.status.build,true);
  assert.ok(!f.calls.some(entry=>entry.method==='workspace.open'),'a global gate must not need a world binding');
});

test('godot_jobs exposes the real executor gate, durable usage and resume',async()=>{
  const f=fixture();
  const status=await f.call('godot_jobs',{mode:'status'});
  assert.equal(status.scope,'executor');
  assert.equal(status.status.build,true);
  assert.equal(status.status.executors.length,1);
  assert.ok(status.tokenGatedMethods.includes('godotJob.claim'));
  assert.ok(!status.tokenGatedMethods.includes('godotExecutor.status'));
  const usage=await f.call('godot_jobs',{mode:'usage'});
  assert.equal(usage.scope,'usage');
  assert.equal(usage.totals.wallClockMillis,1200);
  assert.equal(usage.totals.artifactCount,2);
  assert.match(usage.note,/never merged/);
  const resumed=await f.call('godot_jobs',{mode:'resume',originJobId:'job-1'});
  assert.equal(resumed.scope,'resume');
  assert.equal(resumed.result.status,'queued');
  await assert.rejects(f.call('godot_jobs',{mode:'resume'}),/ORIGIN_JOB_ID_REQUIRED/);
  await assert.rejects(f.call('godot_jobs',{mode:'nope'}),/INVALID_JOBS_MODE/);
});

test('godot_draft_recovery lists and resumes only a listed draft',async()=>{
  const f=fixture();
  const listed=await f.call('godot_draft_recovery',{mode:'list'});
  assert.equal(listed.items.length,1);
  assert.equal(listed.items[0].resumable,true);
  assert.equal(listed.items[0].draftRevision,4);
  const resumed=await f.call('godot_draft_recovery',{mode:'resume',taskId:'task-9',generation:2});
  assert.equal(resumed.resumed,true);
  assert.equal(resumed.generationAfter,3);
  const stale=await f.call('godot_draft_recovery',{mode:'resume',taskId:'task-9',generation:99});
  assert.equal(stale.resumed,false);
  assert.equal(stale.reason.kind,'conflict');
  assert.equal(stale.reason.code,'STALE_RECOVERY_SELECTION');
  await assert.rejects(f.call('godot_draft_recovery',{mode:'resume',taskId:'task-9'}),/GENERATION_REQUIRED/);
});

test('discussion-only turns cannot resume a draft',async()=>{
  const f=fixture({discussionOnly:true});
  await f.call('godot_draft_recovery',{mode:'list'});
  await assert.rejects(f.call('godot_draft_recovery',{mode:'resume',taskId:'task-9',generation:2}),
    /DISCUSSION_MODE_READ_ONLY/);
  assert.ok(!f.calls.some(entry=>entry.method==='task.resume'));
});

test('asset and package tools bind the delivered method names and degrade honestly',async()=>{
  const f=fixture();
  const search=await f.call('asset_library',{mode:'search',scope:'current-world',query:'door'});
  assert.equal(search.available,false);
  assert.equal(search.requiredHostMethod,'asset.search');
  assert.equal(search.owner,'R6');
  assert.equal(f.calls.find(entry=>entry.method==='asset.search').params.worldId,'alpha');
  const read=await f.call('asset_library',{mode:'read',assetId:'door-kit',version:2});
  assert.equal(read.requiredHostMethod,'asset.read');
  const check=await f.call('package_library',{mode:'check',ref:{assetId:'door-kit',version:2,contentHash:'a'.repeat(64)},
    target:{base:'top-down',engine:'4.7.2-stable'}});
  assert.equal(check.available,false);
  assert.equal(check.requiredHostMethod,'package.check');
  assert.equal(check.owner,'R4');
  const list=await f.call('package_library',{mode:'list'});
  assert.equal(list.requiredHostMethod,'package.list');
});

test('package proposals cover the five intents and never apply',async()=>{
  const f=fixture();
  const ref={assetId:'door-kit',version:2,contentHash:'a'.repeat(64)};
  const install=await f.call('package_library',{mode:'propose',intent:'instance-only',ref});
  assert.equal(install.proposal,'install');
  assert.equal(install.method,'package.install');
  assert.equal(install.applies,false);
  assert.equal(install.params.worldId,'alpha','the bound world is the only install target');
  const variant=await f.call('package_library',{mode:'propose',intent:'variant',ref,target:{name:'door-hard'}});
  assert.equal(variant.method,'package.register');
  assert.equal(variant.change.createsVariant,true);
  const upgrade=await f.call('package_library',{mode:'propose',intent:'upgrade-selected',ref,
    selection:['ins-1','ins-2']});
  assert.equal(upgrade.method,'package.upgrade');
  assert.equal(upgrade.params.targets.length,2);
  const content=await f.call('package_library',{mode:'propose',intent:'restore-content',selection:['ins-1']});
  assert.equal(content.method,'package.restore');
  const save=await f.call('package_library',{mode:'propose',intent:'restore-save',
    progressRef:{revision:7,contentHash:'b'.repeat(64)}});
  assert.equal(save.method,'backup.restore');
  assert.equal(save.owner,'R5');
  await assert.rejects(f.call('package_library',{mode:'propose',intent:'upgrade-selected',ref,selection:[]}),
    /UPGRADE_SELECTED_REQUIRES_SELECTION/);
  await assert.rejects(f.call('package_library',{mode:'propose',intent:'instance-only',
    ref:{assetId:'latest',version:1,contentHash:'a'.repeat(64)}}),/ASSET_REF_MUST_NOT_BE_LATEST/);
  assert.ok(!f.calls.some(entry=>/^(package\.install|package\.upgrade|package\.restore|backup\.restore)$/.test(entry.method)),
    'a proposal must not reach the host');
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


test('current registered adapters agree with the mode report and proposals never write',async()=>{
  const f=fixture({registered:true,discussionOnly:true});
  const report=await f.call('godot_capability_report',{});
  assert.deepEqual(f.calls.map(call=>call.method),['godotExecutor.status','task.context','content.status']);
  const ref={repoId:'world-alpha',commitOid:'a'.repeat(40),assetLockHash:'b'.repeat(64)};
  const asset={assetId:'pet-model',version:1,contentHash:'c'.repeat(64)};
  const requests={godot_history:{history:{},version:{contentRef:ref},diff:{from:ref,to:ref},operation:{operationId:'op-1'}},
    asset_library:{search:{scope:'current-world'},read:{assetId:'pet-model'},versions:{assetId:'pet-model'}},
    package_library:{check:{ref:asset,target:{base:'creation-sandbox',engine:'godot'}},read:{instanceId:'pet-1'},list:{}}};
  for(const [name,modes] of Object.entries(requests))for(const [mode,args] of Object.entries(modes)){
    const advertised=report.tools.find(tool=>tool.name===name).modes.find(entry=>entry.mode===mode);
    assert.equal(advertised.reachable,true,name+':'+mode);
    const result=await f.call(name,{mode,...args});
    assert.equal(result.available,true);assert.equal(result.method,advertised.hostMethod);
  }
  const before=f.calls.length;
  const proposal=await f.call('godot_history',{mode:'checkpoint',contentRef:ref});
  assert.equal(proposal.applies,false);assert.equal(proposal.requiresPlayerAction,true);
  assert.ok(f.calls.slice(before).every(call=>call.method==='workspace.open'));
  assert.ok(!f.calls.some(call=>['content.checkpoint.set','content.branch.merge','package.install'].includes(call.method)));
});
