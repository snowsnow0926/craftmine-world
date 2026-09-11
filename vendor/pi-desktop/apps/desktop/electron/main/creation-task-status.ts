type RecordValue=Record<string,any>;

/** Present persisted job and formal-build facts, never infer success from model prose. */
export function creationTaskStatus(worldId:string,sessionId:string,job:RecordValue|null,formal:RecordValue,applicationPending=false){
  if(formal.worldId!==worldId)throw Error("CREATION_WORLD_CHANGED");
  if(!job)return {worldId,sessionId,phase:"idle",requirementStatus:"not-requested"};
  if(job.worldId!==worldId)throw Error("CREATION_WORLD_CHANGED");
  const terminal=["passed","failed","blocked","cancelled","interrupted"].includes(job.status);
  const hasRequirements=!!job.checkRequirements;
  let phase=job.status==="passed"?(formal.buildId===job.buildId?"applied":applicationPending?"applying":"ready")
    :job.status==="cancelled"?"cancelled":job.status==="interrupted"?"interrupted"
    :terminal?"failed":job.kind==="check"?"checking":"editing";
  const requirementStatus=hasRequirements?(job.status==="passed"?"passed":terminal?"failed":"pending")
    :formal.baseId==="creation-sandbox"?"unsupported":"not-requested";
  return {worldId,sessionId,taskId:job.taskId,jobId:job.jobId,phase,stage:job.stage??undefined,
    requirementStatus,sourceStale:job.sourceStale===true,
    error:typeof job.blockedReason==="string"?job.blockedReason:typeof job.interruptReason==="string"?job.interruptReason:undefined,
    updatedAt:job.updatedAt};
}
