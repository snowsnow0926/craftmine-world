// Capability inventory and evidence-based gap classification.
//
// The product problem this solves: the model kept answering "I have no
// capability" because nothing told it what is actually wired. This module
// derives the answer from three real sources -- the manifest tool catalogue,
// the broker routing table and the core capability handshake -- and classifies
// every gap into one of six categories with the evidence that justifies it.
//
// It never upgrades a capability by editing a constant. A tool that routes to a
// host method the core does not implement is reported as missing, not as
// available.
'use strict';

const INVENTORY_FORMAT='craftmine.godot-capability/1';

const GAP_CATEGORIES={
  'already-available-unread':{label:'Exists but was not found',action:'Read the real scene, system or tool result that already provides it.',playerEffect:'Name the feature that was found and what changed.'},
  'state-or-interface-missing':{label:'State or tool not exposed',action:'Record the exact missing interface and a minimal reproduction.',playerEffect:'Name the affected requirement instead of guessing state.'},
  'developable-with-ordinary-script':{label:'Developable as ordinary project code',action:'Write and check GDScript, scenes and UI in the task project.',playerEffect:'A playable candidate with a real check result.'},
  'needs-reusable-component':{label:'Needs a reusable component',action:'Author a compatible extension and check it independently.',playerEffect:'A new component with declared dependencies and reuse scope.'},
  'target-platform-unsupported':{label:'Target platform does not support it',action:'State the real restriction and a supported alternative.',playerEffect:'The unfinished part and the difference from the request.'},
  'needs-core-or-host-change':{label:'Needs a core or host change',action:'Open a separate development item; keep existing worlds and drafts.',playerEffect:'Existing progress is preserved and the gap is explicit.'},
  'undetermined':{label:'Not yet determined',action:'Collect the required evidence before classifying.',playerEffect:'An explicit "unknown so far", not a false capability claim.'}
};

// Owner and reachability of every host method a world tool may call. `owner` is
// the round-three agent responsible for the method's implementation or
// registration (see docs/dispatch-prompts/godot-round3-20260910/README.md §3);
// a gap report must route to that owner rather than leave the model guessing.
const HOST_METHODS={
  'godotProject.create':{owner:'S1',capability:'godotProjects',kind:'write'},
  'godotProject.index':{owner:'S1',capability:'godotProjects',kind:'read'},
  'godotProject.read':{owner:'S1',capability:'godotProjects',kind:'read'},
  'godotProject.patch':{owner:'S1',capability:'godotProjects',kind:'write'},
  'godotProject.receipt':{owner:'S1',capability:'godotProjects',kind:'receipt'},
  'godotAsset.put':{owner:'S1',capability:'godotProjects',kind:'write'},
  'godotAsset.list':{owner:'S1',capability:'godotProjects',kind:'read'},
  'godotBuild.start':{owner:'S1',capability:'godotBuildJobs',kind:'write',service:'S2'},
  'godotBuild.read':{owner:'S1',capability:'godotBuildJobs',kind:'read'},
  'godotBuild.cancel':{owner:'S1',capability:'godotBuildJobs',kind:'write',service:'S2'},
  'godotBuild.receipt':{owner:'S1',capability:'godotBuildJobs',kind:'receipt'},
  'godotCandidate.read':{owner:'S1',capability:'godotBuildJobs',kind:'read'},
  'godotCandidate.list':{owner:'S1',capability:'godotBuildJobs',kind:'read'},
  'godotApplication.prepare':{owner:'S1',capability:'playerApplications',kind:'write'},
  'godotApplication.commit':{owner:'S1',capability:'playerApplications',kind:'write'},
  'godotApplication.read':{owner:'S1',capability:'playerApplications',kind:'read'},
  'godotApplication.abort':{owner:'S1',capability:'playerApplications',kind:'write'},
  'godotRuntime.describe':{owner:'S1',capability:'godotProjects',kind:'read'},
  'godotRuntime.describeCandidate':{owner:'S1',capability:'playerApplications',kind:'read',requiresHostToken:true},
  'godotRuntime.saveProgress':{owner:'S1',capability:'godotProjects',kind:'write'},
  'godotExecutor.register':{owner:'S2',capability:'godotExecutorGate',kind:'write'},
  'godotExecutor.status':{owner:'S2',capability:'godotExecutorGate',kind:'read'},
  'godotJob.usage':{owner:'S1',capability:'godotBuildJobs',kind:'read'},
  'godotJob.continue':{owner:'S1',capability:'godotBuildJobs',kind:'write',service:'S2'},
  'godotJob.claim':{owner:'S2',capability:'godotExecutorGate',kind:'write'},
  'godotJob.progress':{owner:'S2',capability:'godotExecutorGate',kind:'write'},
  'godotJob.heartbeat':{owner:'S2',capability:'godotExecutorGate',kind:'write'},
  'godotJob.finish':{owner:'S2',capability:'godotExecutorGate',kind:'write'},
  'library.search':{owner:'S1',capability:'publishesWorlds',kind:'read'},
  'library.read':{owner:'S1',capability:'publishesWorlds',kind:'read'},
  'library.capture':{owner:'S1',capability:'publishesWorlds',kind:'write'},
  'memory.search':{owner:'S1',capability:'advisoryReviews',kind:'read'},
  'memory.propose':{owner:'S1',capability:'advisoryReviews',kind:'write'},
  'verification.submit':{owner:'S1',capability:'verificationJobs',kind:'write'},
  'verification.read':{owner:'S1',capability:'verificationJobs',kind:'read'},
  'verification.cancel':{owner:'S1',capability:'verificationJobs',kind:'write'},
  'workspace.open':{owner:'S1',capability:'sessionDrafts',kind:'read'},
  'workspace.commit':{owner:'S1',capability:'sessionDrafts',kind:'write'},
  'workspace.receipt':{owner:'S1',capability:'sessionDrafts',kind:'receipt'},
  'task.readRequirements':{owner:'S1',capability:'sessionDrafts',kind:'read'},
  'task.context':{owner:'S1',capability:'sessionDrafts',kind:'read'},
  'task.recoverable':{owner:'S1',capability:'sessionDrafts',kind:'read'},
  'task.resume':{owner:'S1',capability:'sessionDrafts',kind:'write'},
  'backup.export':{owner:'S4',capability:'publishesWorlds',kind:'write'},
  'backup.inspect':{owner:'S4',capability:'publishesWorlds',kind:'read'},
  'backup.restore':{owner:'S4',capability:'publishesWorlds',kind:'write'},
  'backup.status':{owner:'S4',capability:'publishesWorlds',kind:'read'},
  'backup.cancel':{owner:'S4',capability:'publishesWorlds',kind:'write'},
  // Round-three domain adapters the model tools are already bound to. They are
  // listed so a missing registration is reported against the exact owner.
  'asset.search':{owner:'S5',capability:'assetCatalog',kind:'read'},
  'asset.read':{owner:'S5',capability:'assetCatalog',kind:'read'},
  'asset.versions':{owner:'S5',capability:'assetCatalog',kind:'read'},
  'package.check':{owner:'S3',capability:'creationPackages',kind:'read'},
  'package.read':{owner:'S3',capability:'creationPackages',kind:'read'},
  'package.list':{owner:'S3',capability:'creationPackages',kind:'read'},
  'package.install':{owner:'S3',capability:'creationPackages',kind:'write'},
  'package.register':{owner:'S3',capability:'creationPackages',kind:'write'},
  'package.upgrade':{owner:'S3',capability:'creationPackages',kind:'write'},
  'package.restore':{owner:'S3',capability:'creationPackages',kind:'write'},
  'content.history':{owner:'S1',capability:'contentHistory',kind:'read'},
  'content.status':{owner:'S1',capability:'contentHistory',kind:'read'},
  'content.changes':{owner:'S1',capability:'contentHistory',kind:'read'},
  'content.operation.read':{owner:'S1',capability:'contentHistory',kind:'read'},
  'content.checkpoint.set':{owner:'S1',capability:'contentHistory',kind:'write'},
  'content.branch.merge':{owner:'S1',capability:'contentHistory',kind:'write'},
  'budget.inspect':{owner:'S1',capability:'sessionDrafts',kind:'read'}
};

// Methods the core advertises but no agent tool reaches today. This is the
// "engine can do it, the AI cannot" list that the model must be told about.
const UNREACHABLE_METHODS=['godotRuntime.describeCandidate','godotApplication.prepare','godotApplication.commit',
  'godotApplication.read','godotApplication.abort','godotJob.claim','godotJob.progress','godotJob.heartbeat',
  'godotJob.finish','backup.export','backup.inspect','backup.restore','backup.status','backup.cancel'];

function capabilityState(method,handshake){
  const entry=HOST_METHODS[method];
  if(!entry)return {known:false};
  if(entry.requiresHostToken)return {known:true,reachable:false,reason:'HOST_TOKEN_REQUIRED',owner:entry.owner,capability:entry.capability};
  const flag=handshake?.[entry.capability];
  if(flag===undefined)return {known:true,reachable:null,reason:'CAPABILITY_FLAG_UNKNOWN',owner:entry.owner,capability:entry.capability};
  return {known:true,reachable:flag===true,reason:flag===true?null:'CAPABILITY_DISABLED',owner:entry.owner,capability:entry.capability};
}

// Resolves a tool that does not map 1:1 to a single host method.
function localState(local,handshake){
  if(local.reachable!==undefined&&!local.needs)return {reachable:local.reachable,blockedBy:local.blockedBy||null};
  const needs=local.needs||[];
  let reachable=true,blockedBy=null;
  for(const flag of needs){
    const value=handshake?.[flag];
    if(value===undefined){if(reachable!==false){reachable=null;blockedBy='CAPABILITY_FLAG_UNKNOWN';}}
    else if(value!==true){reachable=false;blockedBy='CAPABILITY_DISABLED';}
  }
  if(local.reachable===false)return {reachable:false,blockedBy:local.blockedBy||'DEPENDENCY_NOT_WIRED'};
  return {reachable,blockedBy};
}

// Proposals describe a player action; they never grant permission to perform it.
function modeInventory(name,local,handshake,context,overrides){
  const modes=Object.entries(local.modes).map(([mode,entry])=>{
    const historyKey={operation:'operationResult','merge-candidate':'mergeCandidate'}[mode]||mode;
    const override=name==='godot_history'?overrides.historyMethods?.[historyKey]
      :overrides.libraryMethods?.[name==='asset_library'?'asset':'package']?.[mode];
    const hostMethod=entry.proposal?null:(override??entry.method);
    const needs=[...local.needs,...(entry.capability?[entry.capability]:[])];
    const state=localState({needs},handshake);
    if(state.reachable===true){
      if(!context.worldId){state.reachable=null;state.blockedBy='WORLD_BINDING_UNRESOLVED';}
      else if(override!==undefined&&override!==entry.method&&!entry.proposal){
        state.reachable=null;state.blockedBy='CUSTOM_METHOD_UNVERIFIED';
      } else if(entry.repository&&context.repository?.registered!==true){
        state.reachable=context.repository?.registered===false?false:null;
        state.blockedBy=context.repository?.reason||'CONTENT_REPOSITORY_UNAVAILABLE';
      }
    }
    return {mode,kind:entry.proposal?'proposal':'read',hostMethod,
      ...(entry.targetMethod?{proposedHostMethod:override??entry.targetMethod}:{}),
      reachable:state.reachable,blockedBy:state.blockedBy,
      ...(entry.proposal?{applies:false,requiresPlayerAction:true}:{}),needs};
  });
  const reads=modes.filter(mode=>mode.kind==='read');
  const considered=reads.length?reads:modes;
  const reachable=considered.some(mode=>mode.reachable===true)?true:considered.some(mode=>mode.reachable===null)?null:false;
  return {reachable,blockedBy:reachable===true?null:(considered.find(mode=>mode.reachable===reachable)?.blockedBy||null),modes};
}

async function readCapabilityContext(core,context,handshake){
  // Do not open a workspace: an inventory query must not acquire a draft lease.
  // The session binding takes precedence over the globally selected world.
  let worldId;
  try {worldId=(await core.call('task.context',{context}))?.world?.id;}
  catch {return {worldId:null,reason:'WORLD_BINDING_UNRESOLVED'};}
  if(typeof worldId!=='string'||!worldId)return {worldId:null,reason:'WORLD_BINDING_UNRESOLVED'};
  const result={worldId};
  if(handshake?.contentHistory===true){
    try {
      const status=await core.call('content.status',{worldId});
      result.repository={registered:typeof status.registered==='boolean'?status.registered:null};
    } catch(error){result.repository={registered:null,reason:error?.errorCode==='UNKNOWN_METHOD'?'DEPENDENCY_NOT_WIRED':'CONTENT_STATUS_UNAVAILABLE'};}
  }
  return result;
}

function buildInventory({manifest,routing={},handshake=null,localTools={},executionContext={},methodOverrides={}}={}){
  const definitions=(manifest?.contributes?.agentTools||[]).filter(tool=>tool.name!=='runtime_info');
  const tools=definitions.map(definition=>{
    const local=localTools[definition.name];
    if(local){
      const state=local.modes?modeInventory(definition.name,local,handshake,executionContext,methodOverrides):localState(local,handshake);
      return {name:definition.name,risk:definition.risk||'unknown',hostMethod:local.hostMethod||[...new Set((state.modes||[]).map(mode=>mode.hostMethod).filter(Boolean))].join('+')||null,advertised:true,
        wired:true,reachable:state.reachable,blockedBy:state.blockedBy,owner:local.owner||null,local:true,...(state.modes?{modes:state.modes}: {})};
    }
    const method=routing[definition.name]||null;
    const state=method?capabilityState(method,handshake):{known:false};
    return {name:definition.name,risk:definition.risk||'unknown',hostMethod:method,advertised:true,
      wired:Boolean(method),reachable:method?state.reachable:null,
      blockedBy:method&&state.reachable===false?state.reason:null,
      owner:method?(HOST_METHODS[method]?.owner||null):null};
  });
  // These methods are genuinely not reachable from any agent tool today. The
  // capability flag is reported separately so `reachable` cannot be misread.
  const unreachable=UNREACHABLE_METHODS.map(method=>{
    const state=capabilityState(method,handshake);
    return {method,owner:HOST_METHODS[method]?.owner||null,kind:HOST_METHODS[method]?.kind||null,
      reachable:false,capabilityEnabled:state.reachable,reason:'NO_AGENT_TOOL_ROUTES_THIS_METHOD'};
  });
  return {format:INVENTORY_FORMAT,toolCount:tools.length,tools,executionContext,
    handshake:handshake?{...handshake}:{available:false,reason:'CORE_HANDSHAKE_UNAVAILABLE'},
    unreachableMethods:unreachable,
    note:'Tool reachability summarizes direct read modes when present. Consult modes for context and proposal-only limits; true does not guarantee arguments or content exist. null means unknown and is never reported as available.'};
}

// Evidence-driven classification. Each evidence item is a fact with a source.
// Missing evidence produces 'undetermined' instead of a confident guess.
const EVIDENCE_RULES=[
  {kind:'project-contains-feature',category:'already-available-unread'},
  {kind:'tool-result-shows-state',category:'already-available-unread'},
  {kind:'missing-host-method',category:'state-or-interface-missing'},
  {kind:'missing-tool',category:'state-or-interface-missing'},
  {kind:'engine-api-supports',category:'developable-with-ordinary-script'},
  {kind:'ordinary-gdscript-sufficient',category:'developable-with-ordinary-script'},
  {kind:'duplicates-existing-component',category:'needs-reusable-component'},
  {kind:'needs-shared-component',category:'needs-reusable-component'},
  {kind:'web-target-restriction',category:'target-platform-unsupported'},
  {kind:'platform-unsupported',category:'target-platform-unsupported'},
  {kind:'requires-engine-change',category:'needs-core-or-host-change'},
  {kind:'requires-host-change',category:'needs-core-or-host-change'},
  {kind:'requires-sandbox-change',category:'needs-core-or-host-change'}
];

function classifyGap({request,evidence=[]}={}){
  const usable=evidence.filter(item=>item&&typeof item.kind==='string'&&typeof item.source==='string');
  if(!usable.length){
    return {format:INVENTORY_FORMAT,category:'undetermined',categoryLabel:GAP_CATEGORIES.undetermined.label,
      request:request||null,evidence:[],
      neededEvidence:['Read the actual project index and scene for the feature.','Query the real runtime or build state.',
        'Check whether the engine API supports it in the target platform.','Check whether an existing component already provides it.'],
      action:GAP_CATEGORIES.undetermined.action,playerEffect:GAP_CATEGORIES.undetermined.playerEffect};
  }
  const matched=usable.map(item=>({...item,rule:EVIDENCE_RULES.find(rule=>rule.kind===item.kind)?.category||null}))
    .filter(item=>item.rule);
  if(!matched.length){
    return {format:INVENTORY_FORMAT,category:'undetermined',categoryLabel:GAP_CATEGORIES.undetermined.label,
      request:request||null,evidence:usable,neededEvidence:['Evidence kinds are not recognised; record the observation in the declared vocabulary.'],
      action:GAP_CATEGORIES.undetermined.action,playerEffect:GAP_CATEGORIES.undetermined.playerEffect};
  }
  // A hard limitation outranks an ordinary-script route, which outranks "already there".
  const priority=['needs-core-or-host-change','target-platform-unsupported','needs-reusable-component',
    'developable-with-ordinary-script','state-or-interface-missing','already-available-unread'];
  const category=priority.find(candidate=>matched.some(item=>item.rule===candidate));
  const meta=GAP_CATEGORIES[category];
  return {format:INVENTORY_FORMAT,category,categoryLabel:meta.label,request:request||null,evidence:matched,
    action:meta.action,playerEffect:meta.playerEffect,
    nextStep:category==='already-available-unread'?'Re-read the cited source and use the existing capability.'
      :category==='state-or-interface-missing'?'Report the missing interface to its owner and continue with the parts that are reachable.'
      :category==='developable-with-ordinary-script'?'Implement it in the bound task project with real GDScript and scenes, then check it.'
      :category==='needs-reusable-component'?'Author a compatible component and check it independently before reuse.'
      :category==='target-platform-unsupported'?'State the restriction and the supported alternative; do not promise the unsupported behaviour.'
      :'Open a separate development item and preserve the existing world and draft.'};
}

function capabilityReport({manifest,routing,handshake,localTools,gaps,limits,services,executionContext,methodOverrides}={}){
  const inventory=buildInventory({manifest,routing,handshake,localTools,executionContext,methodOverrides});
  return {format:INVENTORY_FORMAT,...inventory,
    gapClassifications:(gaps||[]).map(gap=>classifyGap(gap)),
    limits:limits||{available:false,reason:'BUDGET_PROVIDER_NOT_WIRED'},
    // Which host providers this process actually received. A missing provider is
    // the audited defect this report must expose, not a silent degradation.
    services:services||{format:'craftmine.tool-services/1',wired:[],missing:[],complete:false,
      reason:'SERVICE_DESCRIPTION_UNAVAILABLE'},
    guidance:['Tools in this inventory define what is actually available; do not claim a capability outside it.',
      'A wired tool whose capability flag is false is disabled, not broken: report the reason and the owner.',
      'services.missing names a provider this process did not receive; its value is unknown, never zero or saved state.',
      'Ordinary gameplay, scenes, UI and GDScript are developable without a new host command.',
      'Engine internals, sandbox rules and the verification standard are not changeable by a world task.']};
}

module.exports={INVENTORY_FORMAT,GAP_CATEGORIES,HOST_METHODS,UNREACHABLE_METHODS,EVIDENCE_RULES,
  capabilityState,buildInventory,classifyGap,capabilityReport,readCapabilityContext};
