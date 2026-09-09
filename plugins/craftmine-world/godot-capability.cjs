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

// Owner and reachability of every host method a world tool may call. The owner
// is the single write-responsible agent for that subsystem; a gap report must
// route to that owner rather than leave the model guessing.
const HOST_METHODS={
  'godotProject.create':{owner:'A',capability:'godotProjects',kind:'write'},
  'godotProject.index':{owner:'A',capability:'godotProjects',kind:'read'},
  'godotProject.read':{owner:'A',capability:'godotProjects',kind:'read'},
  'godotProject.patch':{owner:'A',capability:'godotProjects',kind:'write'},
  'godotProject.receipt':{owner:'A',capability:'godotProjects',kind:'receipt'},
  'godotAsset.put':{owner:'A',capability:'godotProjects',kind:'write'},
  'godotAsset.list':{owner:'A',capability:'godotProjects',kind:'read'},
  'godotBuild.start':{owner:'C',capability:'godotBuildJobs',kind:'write'},
  'godotBuild.read':{owner:'C',capability:'godotBuildJobs',kind:'read'},
  'godotBuild.cancel':{owner:'C',capability:'godotBuildJobs',kind:'write'},
  'godotBuild.receipt':{owner:'C',capability:'godotBuildJobs',kind:'receipt'},
  'godotCandidate.read':{owner:'C',capability:'godotBuildJobs',kind:'read'},
  'godotCandidate.list':{owner:'C',capability:'godotBuildJobs',kind:'read'},
  'godotApplication.prepare':{owner:'C',capability:'playerApplications',kind:'write'},
  'godotApplication.commit':{owner:'C',capability:'playerApplications',kind:'write'},
  'godotApplication.read':{owner:'C',capability:'playerApplications',kind:'read'},
  'godotApplication.abort':{owner:'C',capability:'playerApplications',kind:'write'},
  'godotRuntime.describe':{owner:'C',capability:'godotProjects',kind:'read'},
  'godotRuntime.describeCandidate':{owner:'C',capability:'playerApplications',kind:'read',requiresHostToken:true},
  'godotRuntime.saveProgress':{owner:'C',capability:'godotProjects',kind:'write'},
  'godotExecutor.register':{owner:'C',capability:'godotExecutorGate',kind:'write'},
  'godotJob.claim':{owner:'C',capability:'godotExecutorGate',kind:'write'},
  'godotJob.progress':{owner:'C',capability:'godotExecutorGate',kind:'write'},
  'godotJob.heartbeat':{owner:'C',capability:'godotExecutorGate',kind:'write'},
  'godotJob.finish':{owner:'C',capability:'godotExecutorGate',kind:'write'},
  'library.search':{owner:'H',capability:'publishesWorlds',kind:'read'},
  'library.read':{owner:'H',capability:'publishesWorlds',kind:'read'},
  'library.capture':{owner:'H',capability:'publishesWorlds',kind:'write'},
  'memory.search':{owner:'J',capability:'advisoryReviews',kind:'read'},
  'memory.propose':{owner:'J',capability:'advisoryReviews',kind:'write'},
  'verification.submit':{owner:'C',capability:'verificationJobs',kind:'write'},
  'verification.read':{owner:'C',capability:'verificationJobs',kind:'read'},
  'verification.cancel':{owner:'C',capability:'verificationJobs',kind:'write'},
  'workspace.open':{owner:'C',capability:'sessionDrafts',kind:'read'},
  'workspace.commit':{owner:'C',capability:'sessionDrafts',kind:'write'},
  'workspace.receipt':{owner:'C',capability:'sessionDrafts',kind:'receipt'},
  'task.readRequirements':{owner:'C',capability:'sessionDrafts',kind:'read'},
  'task.context':{owner:'C',capability:'sessionDrafts',kind:'read'},
  'task.recoverable':{owner:'C',capability:'sessionDrafts',kind:'read'},
  'task.resume':{owner:'C',capability:'sessionDrafts',kind:'write'},
  'backup.export':{owner:'H',capability:'publishesWorlds',kind:'write'},
  'backup.inspect':{owner:'H',capability:'publishesWorlds',kind:'read'},
  'backup.restore':{owner:'H',capability:'publishesWorlds',kind:'write'},
  'backup.status':{owner:'H',capability:'publishesWorlds',kind:'read'},
  'backup.cancel':{owner:'H',capability:'publishesWorlds',kind:'write'}
};

// Methods the core advertises but no agent tool reaches today. This is the
// "engine can do it, the AI cannot" list that the model must be told about.
const UNREACHABLE_METHODS=['godotRuntime.describeCandidate','godotApplication.prepare','godotApplication.commit',
  'godotApplication.read','godotApplication.abort','godotJob.claim','godotJob.progress','godotJob.heartbeat',
  'godotJob.finish','library.capture','backup.export','backup.inspect','backup.restore','backup.status','backup.cancel',
  'task.context','task.recoverable'];

function capabilityState(method,handshake){
  const entry=HOST_METHODS[method];
  if(!entry)return {known:false};
  if(entry.requiresHostToken)return {known:true,reachable:false,reason:'HOST_TOKEN_REQUIRED',owner:entry.owner,capability:entry.capability};
  const flag=handshake?.[entry.capability];
  if(flag===undefined)return {known:true,reachable:null,reason:'CAPABILITY_FLAG_UNKNOWN',owner:entry.owner,capability:entry.capability};
  return {known:true,reachable:flag===true,reason:flag===true?null:'CAPABILITY_DISABLED',owner:entry.owner,capability:entry.capability};
}

function buildInventory({manifest,routing={},handshake=null,localTools={}}={}){
  const definitions=(manifest?.contributes?.agentTools||[]).filter(tool=>tool.name!=='runtime_info');
  const tools=definitions.map(definition=>{
    const local=localTools[definition.name];
    if(local)return {name:definition.name,risk:definition.risk||'unknown',hostMethod:local.hostMethod||null,advertised:true,
      wired:true,reachable:local.reachable===undefined?null:local.reachable,blockedBy:local.blockedBy||null,
      owner:local.owner||null,local:true};
    const method=routing[definition.name]||null;
    const state=method?capabilityState(method,handshake):{known:false};
    return {name:definition.name,risk:definition.risk||'unknown',hostMethod:method,advertised:true,
      wired:Boolean(method),reachable:method?state.reachable:null,
      blockedBy:method&&state.reachable===false?state.reason:null,
      owner:method?(HOST_METHODS[method]?.owner||null):null};
  });
  const unreachable=UNREACHABLE_METHODS.map(method=>({method,owner:HOST_METHODS[method]?.owner||null,
    kind:HOST_METHODS[method]?.kind||null,reachable:capabilityState(method,handshake).reachable,
    reason:capabilityState(method,handshake).reason||'NO_AGENT_TOOL_ROUTES_THIS_METHOD'}));
  return {format:INVENTORY_FORMAT,toolCount:tools.length,tools,
    handshake:handshake?{...handshake}:{available:false,reason:'CORE_HANDSHAKE_UNAVAILABLE'},
    unreachableMethods:unreachable,
    note:'reachable=null means the capability flag is unknown; it is never reported as available.'};
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

function capabilityReport({manifest,routing,handshake,localTools,gaps,limits}={}){
  const inventory=buildInventory({manifest,routing,handshake,localTools});
  return {format:INVENTORY_FORMAT,...inventory,
    gapClassifications:(gaps||[]).map(gap=>classifyGap(gap)),
    limits:limits||{available:false,reason:'BUDGET_PROVIDER_NOT_WIRED'},
    guidance:['Tools in this inventory define what is actually available; do not claim a capability outside it.',
      'A wired tool whose capability flag is false is disabled, not broken: report the reason and the owner.',
      'Ordinary gameplay, scenes, UI and GDScript are developable without a new host command.',
      'Engine internals, sandbox rules and the verification standard are not changeable by a world task.']};
}

module.exports={INVENTORY_FORMAT,GAP_CATEGORIES,HOST_METHODS,UNREACHABLE_METHODS,EVIDENCE_RULES,
  capabilityState,buildInventory,classifyGap,capabilityReport};
