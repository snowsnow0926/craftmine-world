// Service-wiring contract for the Craftmine model tools (task S6).
//
// The audited defect was not a missing schema: the production constructor never
// passed the live-sampling, budget or executor providers, so the tools could
// only report "not wired". These tests pin the contract, the host-provider
// adapter and the durable seven-kind ledger mapping. No engine, no Rust binary,
// no browser, no input simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {SERVICE_KEYS,SERVICE_PROVIDERS,validateToolServices,describeToolServices,createHostProviders,
  budgetKindsFromLedger,createCoreBudgetProvider,flattenObservationEnvelope}=
  require(path.join(root,'plugins/craftmine-world/tool-services.cjs'));
const {LIMIT_KINDS,normalizeLimitKinds,readLimitAccounting}=
  require(path.join(root,'plugins/craftmine-world/godot-observe.cjs'));

const ENVELOPE={format:'craftmine.godot-observation/1',worldId:'alpha',buildId:'gbd-7',instanceId:'inst-1',
  baseId:'first-person',baseVersion:'craftmine.base/3',sampledAt:'2026-09-10T10:00:00Z',protocol:1,
  payload:{base:'first-person',baseVersion:'craftmine.base/3',levelTitle:'Ruins',
    display:{cameraGlobal:{x:1,y:2,z:3},attachedToCamera:true,alignedWithCamera:true,forwardDot:1},
    equipment:{active:'pistol',damage:12},player:{yaw:0,pitch:0},targets:[],interactables:[],quests:[],
    viewportSize:{width:800,height:600},inputCaptured:true,hasSave:true}};

test('every provider names its owner and the host method that would close the gap',()=>{
  for(const key of SERVICE_KEYS){
    const declared=SERVICE_PROVIDERS[key];
    assert.ok(declared.owner,key);
    assert.ok(typeof declared.provides==='string'&&declared.provides.length>10,key);
    assert.ok(Array.isArray(declared.requiredFor)&&declared.requiredFor.length>0,key);
  }
  // The audited three are present and owned by the agents that must supply them.
  assert.equal(SERVICE_PROVIDERS.sampleLiveState.owner,'R2');
  assert.equal(SERVICE_PROVIDERS.sampleLiveState.hostMethod,'godotLiveState');
  assert.equal(SERVICE_PROVIDERS.executorStatus.owner,'S2');
  assert.equal(SERVICE_PROVIDERS.budget.owner,'R2+S1');
});

test('an unwired provider is reported with its owner, never as a value',()=>{
  const description=describeToolServices({});
  assert.equal(description.complete,false);
  assert.equal(description.wired.length,0);
  const live=description.missing.find(entry=>entry.key==='sampleLiveState');
  assert.equal(live.reason,'NOT_WIRED');
  assert.equal(live.owner,'R2');
  assert.ok(live.requiredFor.includes('godot_runtime_state scope=live'));
  assert.match(live.note,/never replaced/);
  // Every declared key is accounted for exactly once.
  assert.equal(description.wired.length+description.missing.length,SERVICE_KEYS.length);
});

test('a provider of the wrong shape fails at construction instead of degrading',()=>{
  assert.throws(()=>validateToolServices({sampleLiveState:'not-a-function'}),/TOOL_SERVICE_INVALID/);
  assert.throws(()=>validateToolServices({budget:42}),/TOOL_SERVICE_INVALID/);
  assert.throws(()=>validateToolServices({historyMethods:[]}),/TOOL_SERVICE_INVALID/);
  assert.throws(()=>validateToolServices({maxSampleAgeMs:'soon'}),/TOOL_SERVICE_INVALID/);
  // Unknown keys belong to the broker and stay untouched.
  assert.doesNotThrow(()=>validateToolServices({somethingElse:123}));
});

test('the host provider adapter flattens the envelope and keeps host identity',async()=>{
  const calls=[];
  const providers=createHostProviders(async(method,params)=>{calls.push({method,params});return ENVELOPE;});
  const sample=await providers.sampleLiveState({worldId:'alpha',buildId:'gbd-7'});
  assert.deepEqual(calls,[{method:'godotLiveState',params:{worldId:'alpha',buildId:'gbd-7',instanceId:null}}]);
  assert.equal(sample.worldId,'alpha');
  assert.equal(sample.buildId,'gbd-7');
  assert.equal(sample.instanceId,'inst-1');
  assert.equal(sample.base,'first-person');
  assert.equal(sample.equipment.active,'pistol');
  // The game's own sampling instant is preserved; the host receipt time is added.
  assert.equal(sample.sampledAt,'2026-09-10T10:00:00Z');
  assert.ok(Number.isFinite(Date.parse(sample.hostSampledAt)));
  assert.equal(sample.provenance,'host-observe-envelope');
});

test('a sample from another world, build or instance is refused, not relabelled',async()=>{
  const providers=createHostProviders(async()=>ENVELOPE);
  await assert.rejects(providers.sampleLiveState({worldId:'beta'}),/LIVE_WORLD_MISMATCH/);
  await assert.rejects(providers.sampleLiveState({buildId:'gbd-9'}),/LIVE_BUILD_MISMATCH/);
  await assert.rejects(providers.sampleLiveState({instanceId:'inst-2'}),/LIVE_INSTANCE_MISMATCH/);
  // No running instance is unknown, not an empty reading.
  assert.equal(await createHostProviders(async()=>null).sampleLiveState({worldId:'alpha'}),null);
});

test('a malformed or progress-carrying envelope never becomes live state',()=>{
  const bad=(patch)=>({...ENVELOPE,...patch});
  assert.throws(()=>flattenObservationEnvelope(bad({format:'craftmine.something-else/1'})),/LIVE_SAMPLE_FORMAT/);
  assert.throws(()=>flattenObservationEnvelope(bad({instanceId:''})),/LIVE_SAMPLE_IDENTITY_INCOMPLETE/);
  assert.throws(()=>flattenObservationEnvelope(bad({payload:null})),/LIVE_SAMPLE_PAYLOAD_INVALID/);
  assert.throws(()=>flattenObservationEnvelope(bad({payload:{...ENVELOPE.payload,state:{player:{x:1}}}})),
    /LIVE_SAMPLE_CARRIES_PROGRESS_BODY/);
});

test('the durable ledger maps onto the seven kinds and keeps unknown counters unknown',()=>{
  const now=1_700_000_000_000;
  const kinds=budgetKindsFromLedger({ownerTaskId:'task-1',requestCount:4,toolCallCount:7,compactionCount:3,
    actualTokens:1200,reservedTokens:300,unknownRequestCount:1,chargedTokens:1500,remainingTokens:8500,
    limits:{maxRequests:50,maxTokens:10000,maxCompactions:6,deadlineAt:now+60000}},now);
  assert.deepEqual(Object.keys(kinds),LIMIT_KINDS);
  assert.deepEqual(kinds.tokens,{limit:10000,used:1500,remaining:8500,source:'durable-ledger'});
  assert.deepEqual(kinds.requests,{limit:50,used:4,source:'durable-ledger'});
  assert.deepEqual(kinds.compactions,{limit:6,used:3,source:'durable-ledger'});
  assert.equal(kinds.wallClock.limit,now+60000);
  assert.equal(kinds.wallClock.remaining,60000);
  // Context window, service failures and resource usage have no durable counter.
  assert.deepEqual(kinds.context,{});
  assert.deepEqual(kinds.service,{});
  assert.deepEqual(kinds.resource,{});
  const normalized=normalizeLimitKinds(kinds);
  assert.equal(normalized.available,true);
  assert.equal(normalized.kinds.tokens.known,true);
  assert.equal(normalized.kinds.context.known,false);
  assert.equal(normalized.kinds.service.known,false);
  assert.equal(normalized.kinds.resource.known,false);
  assert.equal(budgetKindsFromLedger(null),null);
});

test('a resumed task keeps its accumulated cost because the ledger is per task',async()=>{
  const seen=[];
  const core={call:async(method,params)=>{seen.push({method,params});
    if(method==='task.context')return {binding:{projectId:'project',sessionId:'session',turnId:'turn',taskId:'task-1',baseBuild:'gbd-0'},generation:5};
    if(method==='budget.inspect')return {ownerTaskId:'task-1',requestCount:9,compactionCount:3,actualTokens:9000,
      reservedTokens:0,unknownRequestCount:2,chargedTokens:9000,remainingTokens:1000,limits:{maxTokens:10000}};
    throw Error('UNEXPECTED');}};
  const provider=createCoreBudgetProvider(core);
  const first=await provider({projectId:'project',sessionId:'session',turnId:'turn'});
  const second=await provider({projectId:'project',sessionId:'session',turnId:'turn'});
  assert.equal(seen[0].method,'task.context');
  assert.equal(seen[1].method,'budget.inspect');
  assert.deepEqual(seen[1].params.binding,{projectId:'project',sessionId:'session',turnId:'turn',taskId:'task-1',baseBuild:'gbd-0'});
  assert.equal(seen[1].params.generation,5);
  assert.equal(first.kinds.tokens.used,9000);
  assert.equal(second.kinds.tokens.used,9000,'continuation must not reset the cost');
  assert.equal(first.ledger.ownerTaskId,'task-1');
  assert.equal(first.ledger.unknownRequestCount,2);
});

test('a failing budget provider is reported with the owner and the missing method',async()=>{
  const unwired=await readLimitAccounting(undefined,{});
  assert.equal(unwired.available,false);
  assert.equal(unwired.reason,'BUDGET_PROVIDER_NOT_WIRED');
  assert.deepEqual(unwired.kinds,LIMIT_KINDS);
  const failing=await readLimitAccounting(async()=>{throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});},{});
  assert.equal(failing.available,false);
  assert.equal(failing.reason,'DEPENDENCY_NOT_WIRED');
  assert.equal(failing.owner,'S1');
  assert.equal(failing.requiredHostMethod,'budget.inspect');
});
