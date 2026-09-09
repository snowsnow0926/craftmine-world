// Live-observation and durable-fact contract tests.
// No engine, no Rust binary, no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {describeRuntime,normalizeLiveSample,projectFacts,renderFactsBlock,limitAccounting,LIMIT_KINDS}=
  require(path.join(root,'plugins/craftmine-world/godot-observe.cjs'));

const CONTEXT={projectId:'p',sessionId:'s',turnId:'t'};

test('describeRuntime calls the runtime RPC with worldId only',async()=>{
  const calls=[];
  const core={call:async(method,params)=>{calls.push({method,params});
    return {format:'craftmine.godot-runtime-descriptor/1',phase:'formal',worldId:'alpha',buildId:'gbd-1',
      baseId:'first-person',revision:9,contentHash:'c'.repeat(64),entry:'web/index.html',threads:true,
      artifactManifestHash:'d'.repeat(64),artifacts:[{path:'web/index.html'}],
      build:{godot:{engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web'}},
      snapshot:{savedAt:'2026-09-10T00:00:00Z',base:'first-person',equipment:{active:'rifle'}}};}};
  const descriptor=await describeRuntime(core,{worldId:'alpha'});
  assert.deepEqual(calls,[{method:'godotRuntime.describe',params:{worldId:'alpha'}}]);
  assert.equal(descriptor.available,true);
  assert.equal(descriptor.phase,'formal');
  assert.equal(descriptor.engineVersion,'4.7.2-stable');
  assert.equal(descriptor.durableProgress.equipment.active,'rifle');
});

test('describeRuntime maps real error codes to explicit gaps',async()=>{
  const cases={GODOT_PROGRESS_MIGRATION_REQUIRED:'PROGRESS_MIGRATION_REQUIRED',GODOT_BUILD_NOT_APPLIED:'NO_APPLIED_BUILD',
    UNSUPPORTED_WORLD_RUNTIME:'NOT_A_GODOT_WORLD'};
  for(const [code,reason] of Object.entries(cases)){
    const core={call:async()=>{throw Object.assign(Error(code),{errorCode:code});}};
    const result=await describeRuntime(core,{worldId:'alpha'});
    assert.equal(result.available,false);
    assert.equal(result.reason,reason);
  }
  const empty={call:async()=>null};
  assert.equal((await describeRuntime(empty,{worldId:'alpha'})).reason,'NO_FORMAL_GODOT_RUNTIME');
});

test('a live sample without a timestamp is refused',()=>{
  assert.equal(normalizeLiveSample(null).reason,'LIVE_INSTANCE_NOT_RUNNING');
  assert.equal(normalizeLiveSample({worldId:'alpha'}).reason,'LIVE_SAMPLE_WITHOUT_TIMESTAMP');
  assert.equal(normalizeLiveSample('nope').reason,'INVALID_LIVE_SAMPLE');
});

test('a live sample from another world or build is marked stale',()=>{
  const sample={sampledAt:'2026-09-10T10:00:00Z',worldId:'beta',buildId:'gbd-2',instanceId:'inst-9',base:'first-person',
    equipment:{active:'sword'},display:{cameraGlobal:[0,1,0],attachedToCamera:true,alignedWithCamera:true,forwardDot:0.999}};
  const live=normalizeLiveSample(sample,{worldId:'alpha',buildId:'gbd-1',instanceId:'inst-9'},{now:Date.parse('2026-09-10T10:00:00Z')});
  assert.equal(live.stale,true);
  assert.deepEqual(live.mismatches,['LIVE_WORLD_MISMATCH','LIVE_BUILD_MISMATCH']);
  assert.equal(live.provenance,'live-instance-sample');
  assert.equal(live.equipment.active,'sword');
});

test('a replaced instance is informational while an expired or future sample is refused',()=>{
  const sample={sampledAt:'2026-09-10T10:00:00Z',worldId:'alpha',buildId:'gbd-1',instanceId:'inst-2',
    equipment:{active:'rifle'}};
  const changed=normalizeLiveSample(sample,{worldId:'alpha',buildId:'gbd-1',instanceId:'inst-1'},{now:Date.parse('2026-09-10T10:00:00Z')});
  assert.equal(changed.instanceChanged,true);
  assert.equal(changed.stale,false,'a fresh sample from a replaced instance is still current');
  assert.deepEqual(changed.mismatches,[]);
  const expired=normalizeLiveSample(sample,{worldId:'alpha',buildId:'gbd-1',instanceId:'inst-2'},
    {now:Date.parse('2026-09-10T10:01:00Z'),maxAgeMs:30000});
  assert.deepEqual(expired.mismatches,['LIVE_SAMPLE_STALE']);
  assert.equal(expired.ageMillis,60000);
  const future=normalizeLiveSample({...sample,sampledAt:'2026-09-10T11:00:00Z'},
    {worldId:'alpha',buildId:'gbd-1',instanceId:'inst-2'},
    {now:Date.parse('2026-09-10T10:00:00Z'),maxAgeMs:30000});
  assert.deepEqual(future.mismatches,['LIVE_SAMPLE_STALE'],'a future timestamp is not trusted');
  const fresh=normalizeLiveSample(sample,{worldId:'alpha',buildId:'gbd-1',instanceId:'inst-2'},
    {now:Date.parse('2026-09-10T10:00:05Z'),maxAgeMs:30000});
  assert.equal(fresh.stale,false);
});

test('a base that does not expose camera or equipment reports them unknown',()=>{
  const live=normalizeLiveSample({sampledAt:'2026-09-10T10:00:00Z',worldId:'alpha',buildId:'gbd-1',instanceId:'inst-1',
    base:'top-down',player:{position:[1,2]},quests:{quests:[{id:'q1'}]}},{worldId:'alpha',buildId:'gbd-1'},{now:Date.parse('2026-09-10T10:00:00Z')});
  assert.equal(live.available,true);
  assert.equal(live.camera,null);
  assert.equal(live.equipment,null);
  assert.ok(live.unavailable.includes('camera'));
  assert.ok(live.unavailable.includes('equipment'));
  assert.deepEqual(live.quests,{quests:[{id:'q1'}]});
});

test('durable progress is never presented as live equipment',async()=>{
  const core={call:async(method)=>{
    if(method==='godotProject.index')return {worldId:'alpha',revision:4,manifestHash:'e'.repeat(64),baseId:'first-person',
      baseBuild:'gbd-0',engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web',totalFiles:3,
      files:[],nextOffset:null,status:'source-only',verified:false,applied:false,executionAvailable:false,binaryAssetsAvailable:false};
    if(method==='godotCandidate.list')return {items:[{id:'gcan-1',buildId:'gbd-1',baseId:'first-person',status:'ready',
      checkJobId:'job-1',checkOutputHash:'f'.repeat(64)}],nextOffset:null};
    if(method==='godotRuntime.describe')return {phase:'formal',worldId:'alpha',buildId:'gbd-1',baseId:'first-person',
      revision:4,contentHash:'c'.repeat(64),entry:'web/index.html',artifacts:[],build:{godot:{engineVersion:'4.7.2-stable'}},
      snapshot:{savedAt:'2026-09-09T00:00:00Z',base:'first-person',equipment:{active:'pistol'}}};
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
  }};
  const facts=await projectFacts({core,context:CONTEXT,worldId:'alpha'});
  assert.equal(facts.project.available,true);
  assert.equal(facts.candidates.items[0].status,'ready');
  assert.equal(facts.runtime.buildId,'gbd-1');
  assert.equal(facts.durableProgress.available,true);
  assert.equal(facts.durableProgress.source,'last-confirmed-save');
  assert.equal(facts.durableProgress.equipment.active,'pistol');
  // The live section must not borrow that equipment value.
  assert.equal(facts.live.available,false);
  assert.equal(facts.live.reason,'LIVE_OBSERVATION_NOT_WIRED');
  assert.match(facts.live.note,/not the player's current equipment/);
  assert.match(facts.block,/durableProgress: savedAt=2026-09-09T00:00:00Z equipment=pistol/);
  assert.match(facts.block,/live: unavailable\(LIVE_OBSERVATION_NOT_WIRED\)/);
});

test('a wired sampler supplies the live section and keeps the timestamp it reported',async()=>{
  const core={call:async(method)=>{
    if(method==='godotProject.index')throw Object.assign(Error('GODOT_PROJECT_NOT_FOUND'),{errorCode:'GODOT_PROJECT_NOT_FOUND'});
    if(method==='godotCandidate.list')throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
    if(method==='godotRuntime.describe')return {phase:'formal',worldId:'alpha',buildId:'gbd-1',baseId:'first-person',
      revision:4,entry:'web/index.html',artifacts:[],build:{godot:{engineVersion:'4.7.2-stable'}},snapshot:{}};
    throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});
  }};
  const sampler=async()=>({sampledAt:'2026-09-10T12:00:00Z',worldId:'alpha',buildId:'gbd-1',instanceId:'inst-1',base:'first-person',
    equipment:{active:'rifle',magazine:24},display:{cameraGlobal:[1,2,3]},quests:{quests:[]},targets:[{id:'t1'}],
    interactables:[]});
  const facts=await projectFacts({core,context:CONTEXT,worldId:'alpha',sampler});
  assert.equal(facts.live.available,true);
  assert.equal(facts.live.sampledAt,'2026-09-10T12:00:00Z');
  assert.equal(facts.live.equipment.magazine,24);
  assert.deepEqual(facts.live.entities.targets,[{id:'t1'}]);
  assert.equal(facts.project.available,false);
  assert.equal(facts.project.reason,'GODOT_PROJECT_NOT_FOUND');
  assert.match(facts.block,/live: sampledAt=2026-09-10T12:00:00Z/);
});

test('limit accounting preserves unknown counters instead of reporting zero',()=>{
  const unwired=limitAccounting(null);
  assert.equal(unwired.available,false);
  assert.deepEqual(unwired.kinds,LIMIT_KINDS);
  const partial=limitAccounting(()=>({tokens:{limit:1000,used:1000},requests:{used:3},context:{limit:80000,used:1000}}));
  assert.equal(partial.available,true);
  assert.deepEqual(partial.exhausted,['tokens']);
  assert.equal(partial.kinds.tokens.exhausted,true);
  assert.equal(partial.kinds.requests.known,true);
  assert.equal(partial.kinds.requests.limit,null);
  assert.equal(partial.kinds.compactions.known,false);
  assert.equal(partial.kinds.compactions.used,undefined);
  assert.equal(partial.kinds.wallClock.known,false);
});

test('a live sample without its own identity is not trusted as current',()=>{
  const live=normalizeLiveSample({sampledAt:'2026-09-10T10:00:00Z',equipment:{active:'sword'}},{worldId:'alpha',buildId:'gbd-1'},{now:Date.parse('2026-09-10T10:00:00Z')});
  assert.equal(live.available,true);
  assert.equal(live.stale,true);
  assert.deepEqual(live.mismatches,['LIVE_IDENTITY_UNVERIFIED']);
});

test('renderFactsBlock is stable and never expands live payloads',()=>{
  const facts={project:{available:false,reason:'GODOT_PROJECT_NOT_FOUND'},runtime:{available:false,reason:'NO_APPLIED_BUILD'},
    candidates:{available:false,reason:'CANDIDATE_READ_FAILED'},durableProgress:{available:false,reason:'NO_APPLIED_BUILD'},
    live:{available:true,sampledAt:'2026-09-10T12:00:00Z',baseId:'first-person',equipment:{active:'rifle'},camera:{global:[0,0,0]},stale:false}};
  const block=renderFactsBlock(facts);
  assert.equal(block,renderFactsBlock(facts));
  assert.match(block,/project: unavailable\(GODOT_PROJECT_NOT_FOUND\)/);
  assert.match(block,/live: sampledAt=2026-09-10T12:00:00Z base=first-person equipment=rifle camera=present stale=false/);
  assert.ok(!block.includes('[0,0,0]'));
});
