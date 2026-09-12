// Service wiring contract for the Craftmine model tools.
//
// Owner: S6 (contract). Consumers: S2 constructs the providers in main.cjs and
// passes them as the sixth argument of createWorldTools(); R2 exposes the host
// providers through the plugin host API. S1/S3/S5 own the domain method names.
//
// The contract exists because the audited defect was not a missing schema: the
// tools accepted live-sampling, budget and executor options that the production
// constructor never passed. Every provider is therefore declared here with its
// owner and the exact host method it needs, and an unwired provider is reported
// as unknown with that owner - never substituted by a task-start snapshot, a
// zero counter or a self-made reading.
'use strict';

const SERVICE_CONTRACT_FORMAT='craftmine.tool-services/1';

// key -> how the tool layer consumes it and who must provide it. `optional`
// marks an override or tuning value that has a working default: its absence is
// not a capability gap and must not make the wiring look incomplete.
const SERVICE_PROVIDERS={
  samplePerformance:{kind:'function',owner:'GU6',hostMethod:'godotPerformance',provides:'current host-bound renderer process working set; engine frame, physics and GPU channels remain unknown',requiredFor:['godot_performance_observe']},
  sampleEnginePerformance:{kind:'function',owner:'GU6',hostMethod:'godotEnginePerformance',optional:true,provides:'opt-in source/PCK-pinned Godot Performance monitors through the versioned engine bridge',requiredFor:['godot_performance_observe engine metrics']},
  executorNativeDiagnosticEvidence:{kind:'function',owner:'GU5',hostMethod:null,provides:'private read-only projection of validated native import evidence bound to the exact core job result; missing evidence remains unknown',requiredFor:['godot_build_read native diagnostics']},
  executorCreationCompletion:{kind:'function',owner:'CN4',hostMethod:null,optional:true,provides:'same-job recorded application state; a diagnostic receipt never grants application authority',requiredFor:['godot_build_read']},
  buildReadWaitMs:{kind:"number",owner:"NB5",hostMethod:null,optional:true,provides:"bounded model job-read waiting in milliseconds; fixture default is zero",requiredFor:["godot_build_read"]},
  creationTarget:{kind:'function',owner:'R2',hostMethod:'creationTarget',provides:'the immutable host-captured target bound to this invocation turn',requiredFor:['creation_operation','godot_project_query module parameter modes']},
  sampleLiveState:{
    kind:'function',owner:'R2',hostMethod:'godotLiveState',
    provides:'a timestamped sample of the running instance: world, build, instance, camera, equipment, entities, quests',
    requiredFor:['godot_runtime_state scope=live','godot_project_facts.live','godot_project_query module parameter modes']},
  budget:{
    kind:'function',owner:'R2+S1',hostMethod:'budgetSnapshot',
    provides:'the seven limit kinds (tokens, context, requests, compactions, service, wallClock, resource) from the durable ledger',
    requiredFor:['godot_capability_report.limits','godot_project_facts.limits']},
  executorStatus:{
    kind:'function',owner:'S2',hostMethod:null,
    provides:'the live managed-executor gate and the registered executors of this process',
    requiredFor:['godot_jobs mode=status','godot_project_facts.executor']},
  executorEnqueue:{
    kind:'function',owner:'S2',hostMethod:null,
    provides:'hands a queued core build/check job to the live managed executor',
    requiredFor:['godot_build_start','godot_jobs mode=resume']},
  executorCancel:{
    kind:'function',owner:'S2',hostMethod:null,
    provides:'cancels the executor-side worker for one job id',
    requiredFor:['godot_build_cancel']},
  isDiscussionOnly:{
    kind:'function',owner:'R2',hostMethod:null,optional:true,
    provides:'whether the current turn is discussion-only, from the session the host actually owns',
    requiredFor:['discussion-mode write refusal']},
  historyMethods:{
    kind:'object',owner:'S1',hostMethod:'content.*',optional:true,
    provides:'the registered content-history method names',
    requiredFor:['godot_history']},
  libraryMethods:{
    kind:'object',owner:'S1+S3+S5',hostMethod:'asset.*/package.*',optional:true,
    provides:'the registered asset and package method names',
    requiredFor:['asset_library','package_library']},
  maxSampleAgeMs:{
    kind:'number',owner:'R2',hostMethod:null,optional:true,
    provides:'the freshness window the host accepts for a live sample',
    requiredFor:['godot_runtime_state scope=live staleness']}
};

const SERVICE_KEYS=Object.keys(SERVICE_PROVIDERS);

function fail(code,detail){ throw Object.assign(Error(detail?`${code}: ${detail}`:code),{errorCode:code,...(detail?{detail}:{})}); }

// A provided provider must have the declared shape. A wrong type is a
// construction bug, not an "unknown" value: it fails loudly at load time.
function validateToolServices(options){
  if(options===undefined||options===null)options={};
  if(typeof options!=='object'||Array.isArray(options))fail('TOOL_SERVICES_INVALID','options must be an object');
  for(const key of Object.keys(options)){
    const declared=SERVICE_PROVIDERS[key];
    if(!declared)continue; // Unknown keys stay untouched: the broker owns its own options.
    const value=options[key];
    if(value===undefined||value===null)continue;
    if(declared.kind==='function'&&typeof value!=='function')fail('TOOL_SERVICE_INVALID',`${key} must be a function`);
    if(declared.kind==='object'&&(typeof value!=='object'||Array.isArray(value)))fail('TOOL_SERVICE_INVALID',`${key} must be an object`);
    if(key==='buildReadWaitMs'&&(!Number.isInteger(value)||value<0||value>30000))fail('TOOL_SERVICE_INVALID','buildReadWaitMs must be an integer 0..30000');
    if(declared.kind==='number'&&!Number.isFinite(value))fail('TOOL_SERVICE_INVALID',`${key} must be a finite number`);
  }
  return options;
}

// Real wiring state for the model and for acceptance. `missing` is the audited
// gap list; each entry names the owner and the host method that would close it.
// Optional overrides are listed separately so a working default is never
// reported as a missing capability.
function describeToolServices(options){
  const provided=options&&typeof options==='object'?options:{};
  const wired=[],missing=[],optionalMissing=[];
  for(const key of SERVICE_KEYS){
    const declared=SERVICE_PROVIDERS[key];
    const value=provided[key];
    const present=value!==undefined&&value!==null;
    const entry={key,owner:declared.owner,hostMethod:declared.hostMethod,requiredFor:declared.requiredFor.slice(),provides:declared.provides};
    if(present){wired.push({...entry,kind:declared.kind});continue;}
    const gap={...entry,kind:declared.kind,reason:'NOT_WIRED',
      note:'The tool reports this value as unknown. It is never replaced by a task-start snapshot, a saved value or zero.'};
    if(declared.optional)optionalMissing.push({...gap,optional:true,
      note:'Optional override or tuning value; the tool uses its documented default.'});
    else missing.push(gap);
  }
  return {format:SERVICE_CONTRACT_FORMAT,wired,missing,optionalMissing,
    complete:missing.length===0,
    note:'wired lists the providers this process actually received; missing names the exact owner and host method for a required one; optionalMissing has a working default.'};
}

// Providers derived from the plugin host API. `callHost(method, params)` must
// reach the trusted main process; it is the only place the live sample is read,
// so the plugin never invents a reading. The host returns a validated
// observation envelope; the identity check and the flattening stay here.
function createHostProviders(callHost){
  if(typeof callHost!=='function')fail('HOST_CALL_REQUIRED');
  return {
    async creationTarget(context){return callHost('creationTarget',context);},
    async sampleLiveState({worldId,buildId,instanceId}={}){
      const envelope=await callHost('godotLiveState',{worldId:worldId??null,buildId:buildId??null,instanceId:instanceId??null});
      if(envelope===null||envelope===undefined)return null;
      if(worldId&&envelope.worldId!==worldId)fail('LIVE_WORLD_MISMATCH',String(envelope.worldId??'missing'));
      if(buildId&&envelope.buildId!==buildId)fail('LIVE_BUILD_MISMATCH',String(envelope.buildId??'missing'));
      if(instanceId&&envelope.instanceId!==instanceId)fail('LIVE_INSTANCE_MISMATCH',String(envelope.instanceId??'missing'));
      return flattenObservationEnvelope(envelope);
    },
    async budget(){ return callHost('budgetSnapshot',{}); }
  };
}

// ---------------------------------------------------------------------------
// Durable budget ledger (owner of the ledger: S1). The plugin already holds the
// core client, so the seven limit kinds do not need a second host channel: the
// provider reads the same per-task ledger the request hook reserves against.
// ---------------------------------------------------------------------------

function intOrNull(value){ return Number.isSafeInteger(value)?value:null; }

// Map the core `budget.inspect` ledger onto the seven kinds. A counter the
// ledger does not hold stays `{}` -> known:false. It is never reported as zero,
// and the token figure stays `charged = actual + reserved` so a task resumed
// from an interrupted turn keeps its accumulated cost.
function budgetKindsFromLedger(ledger,now=Date.now()){
  if(ledger===null||typeof ledger!=='object'||Array.isArray(ledger))return null;
  const limits=ledger.limits&&typeof ledger.limits==='object'?ledger.limits:{};
  const deadlineAt=intOrNull(limits.deadlineAt);
  const kind=(entry)=>({...entry,source:'durable-ledger'});
  return {
    tokens:kind({limit:intOrNull(limits.maxTokens),used:intOrNull(ledger.chargedTokens),
      remaining:intOrNull(ledger.remainingTokens)}),
    // The context window is a per-request property of the model, not a durable
    // counter, so the ledger cannot answer it: stay unknown.
    context:{},
    requests:kind({limit:intOrNull(limits.maxRequests),used:intOrNull(ledger.requestCount)}),
    compactions:kind({limit:intOrNull(limits.maxCompactions),used:intOrNull(ledger.compactionCount)}),
    // Service failures and resource usage have no durable counter yet.
    service:{},
    wallClock:kind({limit:deadlineAt,used:null,
      remaining:deadlineAt===null?null:Math.max(0,deadlineAt-now)}),
    resource:{}
  };
}

// Read-only provider for main.cjs. `context` is the invocation context of the
// tool call, so the ledger is always the current task's own row.
function createCoreBudgetProvider(core){
  if(!core||typeof core.call!=='function')fail('CORE_REQUIRED');
  return async function budget(context){
    const snapshot=await core.call('task.context',{context});
    const ledger=await core.call('budget.inspect',{binding:snapshot.binding,generation:snapshot.generation});
    const kinds=budgetKindsFromLedger(ledger);
    if(!kinds)fail('BUDGET_LEDGER_INVALID','budget.inspect returned a non-object');
    return {kinds,ledger:{ownerTaskId:ledger.ownerTaskId??null,requestCount:ledger.requestCount??null,
      toolCallCount:ledger.toolCallCount??null,compactionCount:ledger.compactionCount??null,
      actualTokens:ledger.actualTokens??null,reservedTokens:ledger.reservedTokens??null,
      unknownRequestCount:ledger.unknownRequestCount??null,chargedTokens:ledger.chargedTokens??null}};
  };
}

// ---------------------------------------------------------------------------
// Host observation envelope -> the flat sample godot-observe.cjs normalizes.
// The host owns identity; the game payload supplies the observed fields and the
// sampling instant, and the host receipt time is kept beside it so a cached or
// delayed envelope can be told apart from a fresh one.
// ---------------------------------------------------------------------------
function flattenObservationEnvelope(envelope,{hostSampledAt=new Date().toISOString()}={}){
  if(envelope===null||typeof envelope!=='object'||Array.isArray(envelope))fail('LIVE_SAMPLE_INVALID','observation envelope must be an object');
  if(envelope.format!=='craftmine.godot-observation/1')fail('LIVE_SAMPLE_FORMAT',String(envelope.format??'missing'));
  for(const field of ['worldId','buildId','instanceId','baseId','baseVersion','sampledAt']){
    if(typeof envelope[field]!=='string'||!envelope[field])fail('LIVE_SAMPLE_IDENTITY_INCOMPLETE',field);
  }
  if(envelope.payload===null||typeof envelope.payload!=='object'||Array.isArray(envelope.payload))fail('LIVE_SAMPLE_PAYLOAD_INVALID','payload must be an object');
  const payload=envelope.payload;
  // A progress body is not a live reading; refuse to present one as live state.
  if(payload.state!==undefined&&payload.state!==null)fail('LIVE_SAMPLE_CARRIES_PROGRESS_BODY','payload.state');
  return {...payload,
    worldId:envelope.worldId,buildId:envelope.buildId,instanceId:envelope.instanceId,
    base:payload.base??envelope.baseId,baseVersion:payload.baseVersion??envelope.baseVersion,
    sampledAt:envelope.sampledAt,hostSampledAt,protocol:envelope.protocol??null,
    provenance:'host-observe-envelope'};
}

module.exports={SERVICE_CONTRACT_FORMAT,SERVICE_PROVIDERS,SERVICE_KEYS,
  validateToolServices,describeToolServices,createHostProviders,
  budgetKindsFromLedger,createCoreBudgetProvider,flattenObservationEnvelope};
