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
    note:'Durable job usage only. Model token/cache accounting is separate and is never merged into these numbers.'};
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
  explainRecovery,executorStatus,usageSummary,continueJob,listRecoverable,resumeDraft};
