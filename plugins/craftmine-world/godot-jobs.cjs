// Managed Godot job state, durable usage and draft recovery.
//
// Every value here comes from a registered core RPC. Nothing is inferred from a
// naming convention: when the backing method is missing the result says so and
// names the owner. Executor- and token-gated operations are never exposed to the
// model (claim/progress/heartbeat/finish/checkDescriptor all require a token).
'use strict';

const JOBS_FORMAT='craftmine.godot-jobs/1';
const RECOVERY_FORMAT='craftmine.godot-draft-recovery/1';

// Executor-facing methods are deliberately absent: they take a lease token the
// model must never hold.
const MODEL_SAFE_METHODS={
  status:'godotExecutor.status',usage:'godotJob.usage',resume:'godotJob.continue',
  recoverable:'task.recoverable',resumeDraft:'task.resume'};
const TOKEN_GATED_METHODS=['godotJob.claim','godotJob.progress','godotJob.heartbeat','godotJob.finish',
  'godotJob.checkDescriptor','godotExecutor.register','godotExecutor.revoke'];

// Real recovery outcomes, mapped to a player-readable reason. An unmapped code
// keeps its raw value and is marked unknown instead of being guessed.
const RECOVERY_REASONS={
  TASK_NOT_RECOVERABLE:{kind:'expired',reason:'该草稿已经完成、已接续或已被放弃，不能再次接续。'},
  STALE_GENERATION:{kind:'expired',reason:'该草稿已被更新的执行接续，当前列表里的代次已经过期。'},
  RECOVERY_REPLAY_MISMATCH:{kind:'conflict',reason:'接续结果与首次结果不一致，未继续执行。'},
  NEW_TURN_REQUIRED:{kind:'conflict',reason:'需要在一轮新的对话中接续该草稿，当前轮次仍是原来的轮次。'},
  TASK_BINDING_MISMATCH:{kind:'conflict',reason:'该草稿属于另一个会话，未接续。'},
  STALE_RECOVERY_SELECTION:{kind:'conflict',reason:'可接续列表已经变化，请重新读取后再选择。'},
  WORLD_REVISION_CONFLICT:{kind:'conflict',reason:'正式世界已经变化，接续前需要重新确认。'},
  WORLD_APPLICATION_BUSY:{kind:'conflict',reason:'正式世界正在应用另一个候选，暂不能接续。'},
  TURN_ENDED:{kind:'conflict',reason:'当前对话轮次已结束，请在新的轮次中接续。'}
};

function fail(code){ throw Object.assign(Error(code),{errorCode:code}); }

function explainRecovery(code){
  if(typeof code!=='string'||!code)return {kind:'unknown',reason:'未知原因',code:code||null,unknown:true};
  const known=RECOVERY_REASONS[code];
  if(known)return {...known,code,unknown:false};
  return {kind:'unknown',reason:'未识别的恢复错误码，保留原始值。',code,unknown:true};
}

// Live, host-owned execution state. Read-only for the model.
//
// The managed executor runs inside the product process, so its own status is
// the authoritative gate; the core RPC only records the registration. When the
// live provider is wired it is preferred and its provenance is reported, so a
// stale core row can never be presented as "builds are available".
async function executorStatus(core,options={}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  if(typeof options.executorStatus==='function'){
    let live;
    try { live=await options.executorStatus(); }
    catch(error){ return {format:JOBS_FORMAT,scope:'executor',available:false,
      reason:error?.errorCode==='GODOT_EXECUTOR_UNAVAILABLE'?'GODOT_EXECUTOR_UNAVAILABLE':'EXECUTOR_STATUS_FAILED',
      errorCode:error?.errorCode||null,source:'live-executor',tokenGatedMethods:TOKEN_GATED_METHODS.slice()}; }
    if(live===null||live===undefined||typeof live!=='object'||Array.isArray(live))return {format:JOBS_FORMAT,scope:'executor',
      available:false,reason:'EXECUTOR_STATUS_INVALID',source:'live-executor',tokenGatedMethods:TOKEN_GATED_METHODS.slice()};
    return {format:JOBS_FORMAT,scope:'executor',status:live,source:'live-executor',
      // The model may not hold a lease token, so these stay host-only.
      tokenGatedMethods:TOKEN_GATED_METHODS.slice()};
  }
  let status;
  try { status=await core.call('godotExecutor.status',{}); }
  catch(error){
    if(error?.errorCode==='UNKNOWN_METHOD')return {format:JOBS_FORMAT,scope:'executor',available:false,
      reason:'DEPENDENCY_NOT_WIRED',requiredHostMethod:'godotExecutor.status',owner:'S2',
      source:'core-registration',tokenGatedMethods:TOKEN_GATED_METHODS.slice()};
    throw error;
  }
  return {format:JOBS_FORMAT,scope:'executor',status,source:'core-registration',
    liveProviderWired:false,
    note:'This is the durable registration row. The live executor gate is unknown until the product passes its executor status provider.',
    tokenGatedMethods:TOKEN_GATED_METHODS.slice()};
}

// Cumulative durable usage for one world, including unknown-safe totals.
async function usageSummary(core,{context,worldId}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  if(typeof worldId!=='string'||!worldId)throw Error('WORLD_ID_REQUIRED');
  const usage=await core.call('godotJob.usage',{context,worldId});
  const items=Array.isArray(usage?.items)?usage.items:[];
  const totals=usage?.totals&&typeof usage.totals==='object'?usage.totals:{};
  return {format:JOBS_FORMAT,scope:'usage',worldId,items,
    totals:{executions:totals.executions??items.length,wallClockMillis:totals.wallClockMillis??null,
      sourceBytes:totals.sourceBytes??null,assetBytes:totals.assetBytes??null,hostBytes:totals.hostBytes??null,
      artifactBytes:totals.artifactBytes??null,artifactCount:totals.artifactCount??null},
    limits:usage?.limits??null,unknown:Array.isArray(usage?.unknown)?usage.unknown:null,
    limitsScope:'last-recorded-job-usage',
    note:'Durable job usage only. Model token/cache accounting is separate and is never merged into these numbers.'};
}

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0?value:null;
const number=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const clone=value=>JSON.parse(JSON.stringify(value));
const gap=(reason,error)=>({available:false,reason,...(error?{errorCode:error.errorCode??error.code??null}:{})});
const sourceIdentity=value=>({revision:number(value?.sourceRevision),manifestHash:text(value?.manifestHash),branchId:text(value?.branchId??value?.content?.branchId)});
function sourceRelation(a,b){
  if(a.revision===null||b.revision===null||a.manifestHash===null||b.manifestHash===null)return 'unknown';
  if(a.branchId!==null&&b.branchId!==null&&a.branchId!==b.branchId)return 'different-branch';
  return a.revision===b.revision&&a.manifestHash===b.manifestHash?'same-source':'different-source';
}

/** Rebuild facts after lost model context, exclusively from existing core rows.
 * Latest is explicitly session-filtered by godotBuild.latest's durable JOIN;
 * it is never a world-latest fallback or an invented current-turn failure. */
async function readRecoveryFacts(core,{context,worldId,project,runtime}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  const result={format:'craftmine.godot-recovery-facts/1',provenance:'core-durable-records',
    snapshotConsistency:'independent-core-reads',currentTask:gap('TASK_CONTEXT_NOT_READ'),budget:gap('TASK_BUDGET_UNKNOWN'),
    latestJob:gap('LATEST_SESSION_JOB_NOT_READ'),
    application:{available:false,reason:'PENDING_APPLICATION_NOT_DISCOVERABLE_FROM_CORE_JOB',
      formalBuildId:runtime?.available?text(runtime.buildId):null,formalSource:runtime?.available?sourceIdentity(runtime):null},
    coverage:{jobSelection:'latest-in-verified-session',olderFailureHistory:'not-scanned',applicationQueue:'unknown'},
    limitations:['No model-written summaries or new persistence ledger are used.',
      'A previous task in the same session is historical evidence; its failure is not charged to the current task.',
      'A passed check or matching source does not prove application, gameplay or the current live instance.']};
  let task;
  try{
    task=await core.call('task.context',{context});
    if(!record(task)||task.world?.id!==worldId||!record(task.binding)||!text(task.binding.taskId)||
      !['projectId','sessionId','turnId'].every(key=>text(context?.[key])&&task.binding[key]===context[key]))throw Object.assign(Error('RECOVERY_TASK_IDENTITY_MISMATCH'),{errorCode:'RECOVERY_TASK_IDENTITY_MISMATCH'});
    result.currentTask={available:true,binding:Object.fromEntries(['projectId','sessionId','turnId','taskId','baseBuild'].map(key=>[key,text(task.binding[key])])),
      generation:number(task.generation),status:text(task.status),
      draft:{revision:number(task.draft?.revision),hash:text(task.draft?.hash),scope:'task-draft-not-godot-source'},recovery:text(task.recovery)};
    // ownerTaskId may legitimately be an older task after resume. Preserve the
    // entire core budget, nulls and unknown counters; add no limits or stops.
    if(record(task.budget))result.budget={available:true,source:'task.context.budget',value:clone(task.budget)};
  }catch(error){
    result.currentTask=gap(error?.errorCode==='RECOVERY_TASK_IDENTITY_MISMATCH'?'RECOVERY_TASK_IDENTITY_MISMATCH':'TASK_CONTEXT_UNAVAILABLE',error);
    result.latestJob=gap('VERIFIED_SESSION_CONTEXT_REQUIRED');return result;
  }
  try{
    const latest=await core.call('godotBuild.latest',{worldId,sessionId:task.binding.sessionId});
    if(latest===null){result.latestJob={available:true,found:false,scope:'verified-session',selection:'core-session-latest'};return result;}
    if(!record(latest)||latest.worldId!==worldId||latest.sessionId!==undefined&&latest.sessionId!==task.binding.sessionId||!text(latest.jobId)||!text(latest.buildId))throw Object.assign(Error('RECOVERY_JOB_IDENTITY_MISMATCH'),{errorCode:'RECOVERY_JOB_IDENTITY_MISMATCH'});
    const currentTaskMatch=text(latest.taskId)?latest.taskId===task.binding.taskId:null;
    const jobSource=sourceIdentity(latest),projectSource=project?.available?sourceIdentity({...project,sourceRevision:project.revision}):{revision:null,manifestHash:null,branchId:null};
    const diagnostics=require('./godot-diagnostics.cjs').diagnoseGodotBuildRead(latest);
    result.latestJob={available:true,found:true,selection:'core-session-latest',
      scope:currentTaskMatch===true?'current-task':currentTaskMatch===false?'same-session-other-task':'task-identity-unknown',currentTaskMatch,
      jobId:latest.jobId,worldId,taskId:text(latest.taskId),buildId:latest.buildId,kind:text(latest.kind),status:diagnostics.reportedStatus,
      stage:text(latest.stage),source:jobSource,sourceStale:typeof latest.sourceStale==='boolean'?latest.sourceStale:null,
      outputHash:text(latest.outputHash),checkRequirementsHash:text(latest.checkRequirementsHash),originJobId:text(latest.originJobId),candidateId:text(latest.candidateId),
      createdAt:number(latest.createdAt),updatedAt:number(latest.updatedAt),
      sourceComparison:{job:jobSource,projectSnapshot:projectSource,relation:sourceRelation(jobSource,projectSource)},diagnostics,
      candidate:gap(text(latest.candidateId)?'CANDIDATE_NOT_READ':'NO_CANDIDATE_RECORDED'),
      formalBuildMatch:runtime?.available&&text(runtime.buildId)?latest.buildId===runtime.buildId:null};
    if(text(latest.candidateId)){
      try{
        const response=await core.call('godotCandidate.read',{context,worldId,candidateId:latest.candidateId}),candidate=response?.candidate;
        if(!record(candidate)||candidate.worldId!==worldId||candidate.candidateId!==latest.candidateId||candidate.buildId!==latest.buildId||candidate.checkJobId!==latest.jobId||
          (text(latest.outputHash)&&candidate.checkOutputHash!==latest.outputHash)||
          ['sourceRevision','manifestHash'].some(key=>latest[key]!=null&&candidate[key]!=null&&latest[key]!==candidate[key]))throw Object.assign(Error('RECOVERY_CANDIDATE_IDENTITY_MISMATCH'),{errorCode:'RECOVERY_CANDIDATE_IDENTITY_MISMATCH'});
        result.latestJob.candidate={available:true,candidateId:candidate.candidateId,buildId:candidate.buildId,checkJobId:candidate.checkJobId,
          status:text(candidate.status),source:sourceIdentity(candidate),checkOutputHash:text(candidate.checkOutputHash)};
      }catch(error){result.latestJob.candidate=gap('CANDIDATE_RECOVERY_UNAVAILABLE',error);}
    }
  }catch(error){result.latestJob=gap(error?.errorCode==='RECOVERY_JOB_IDENTITY_MISMATCH'?'RECOVERY_JOB_IDENTITY_MISMATCH':'LATEST_SESSION_JOB_UNAVAILABLE',error);}
  return result;
}

// Continue an interrupted, cancelled or failed job. Identity is host-bound; the
// tool call id makes the request idempotent on replay.
async function continueJob(core,{context,worldId,originJobId,toolCallId}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  if(typeof worldId!=='string'||!worldId)throw Error('WORLD_ID_REQUIRED');
  if(typeof originJobId!=='string'||!originJobId.trim()||originJobId.length>240)throw Error('INVALID_ORIGIN_JOB_ID');
  if(typeof toolCallId!=='string'||!toolCallId.trim()||toolCallId.length>240)throw Error('INVALID_TOOL_CALL_ID');
  try {
    return {format:JOBS_FORMAT,scope:'resume',result:await core.call('godotJob.continue',
      {context,worldId,originJobId,toolCallId})};
  } catch(error){
    if(error?.errorCode==='UNKNOWN_METHOD')return {format:JOBS_FORMAT,scope:'resume',available:false,
      reason:'DEPENDENCY_NOT_WIRED',requiredHostMethod:'godotJob.continue',owner:'R1'};
    throw error;
  }
}

// Interrupted drafts the player may resume. Only the exact task still listed for
// this project and session is resumable; the model cannot widen the selection.
async function listRecoverable(core,{projectId,worldId,sessionId}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  if(typeof projectId!=='string'||!projectId)throw Error('PROJECT_ID_REQUIRED');
  const result=await core.call('task.recoverable',{projectId,...(worldId?{worldId}:{})});
  const rows=Array.isArray(result?.items)?result.items:[];
  // A draft belongs to one session. Do not show another session's task id or
  // draft hash to this model; the host list is project-wide.
  const scoped=sessionId?rows.filter(item=>item?.binding?.sessionId===sessionId):rows;
  const items=scoped.map(item=>({
    taskId:item?.taskId??null,worldId:item?.worldId??null,generation:item?.generation??null,
    draftRevision:item?.draftRevision??null,draftHash:item?.draftHash??null,status:item?.status??null,
    createdAt:item?.binding?.createdAt??null,
    resumable:item?.status==='interrupted',
    blockedReason:item?.status!=='interrupted'?'NOT_INTERRUPTED':null}));
  return {format:RECOVERY_FORMAT,scope:'list',projectId,worldId:worldId||null,items,
    modelReplay:result?.modelReplay===true,
    note:'A draft resumes with the task and draft it already has; the model cannot replay a completed turn.'};
}

// Resume one exact draft. Requires the task to still be listed for this project
// and to belong to the current session, so a stale or foreign selection fails
// with a precise reason instead of silently opening another task.
async function resumeDraft(core,{context,worldId,taskId,generation}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  if(typeof taskId!=='string'||!taskId.trim()||taskId.length>240)throw Error('INVALID_TASK_ID');
  if(!Number.isSafeInteger(generation)||generation<1)throw Error('INVALID_GENERATION');
  const listed=await listRecoverable(core,{projectId:context.projectId,worldId,sessionId:context.sessionId});
  const match=listed.items.find(item=>item.taskId===taskId&&Number(item.generation)===Number(generation));
  if(!match)return {format:RECOVERY_FORMAT,scope:'resume',resumed:false,
    reason:explainRecovery('STALE_RECOVERY_SELECTION'),listed:listed.items};
  if(!match.resumable)return {format:RECOVERY_FORMAT,scope:'resume',resumed:false,
    reason:explainRecovery(match.blockedReason==='OTHER_SESSION'?'TASK_BINDING_MISMATCH':'TASK_NOT_RECOVERABLE'),
    listed:listed.items};
  try {
    const result=await core.call('task.resume',{context,taskId,generation});
    return {format:RECOVERY_FORMAT,scope:'resume',resumed:true,taskId,generation,
      workspace:result?.workspace??null,generationAfter:result?.generation??null,
      budget:result?.budget??null,modelReplay:result?.modelReplay===true,replayed:result?.replayed===true};
  } catch(error){
    const code=error?.errorCode||error?.message;
    if(code==='UNKNOWN_METHOD')return {format:RECOVERY_FORMAT,scope:'resume',resumed:false,
      reason:{kind:'unknown',reason:'核心没有登记恢复接口。',code,unknown:true},
      requiredHostMethod:'task.resume',owner:'R1'};
    return {format:RECOVERY_FORMAT,scope:'resume',resumed:false,reason:explainRecovery(code)};
  }
}

module.exports={JOBS_FORMAT,RECOVERY_FORMAT,MODEL_SAFE_METHODS,TOKEN_GATED_METHODS,RECOVERY_REASONS,
  explainRecovery,executorStatus,usageSummary,continueJob,listRecoverable,resumeDraft,readRecoveryFacts};
