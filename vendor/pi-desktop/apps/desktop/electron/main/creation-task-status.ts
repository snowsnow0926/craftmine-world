type RecordValue=Record<string,any>;

/** Present persisted job and formal-build facts, never infer success from model prose. */
export function creationTaskStatus(worldId:string,sessionId:string,job:RecordValue|null,formal:RecordValue,applicationPending=false,automatic:RecordValue|null=null,adoption:RecordValue|null=null){
  if(formal.worldId!==worldId)throw Error("CREATION_WORLD_CHANGED");
  if(!job)return {worldId,sessionId,phase:"idle",requirementStatus:"not-requested"};
  if(job.worldId!==worldId)throw Error("CREATION_WORLD_CHANGED");
  const terminal=["passed","failed","blocked","cancelled","interrupted"].includes(job.status);
  const hasRequirements=!!job.checkRequirements;
  const adopted=adoption?.worldId===worldId&&adoption?.candidateId===job.candidateId&&adoption?.buildId===job.buildId
    &&adoption?.currentBuildId===formal.buildId&&adoption?.wasApplied===true;
  const retainedAdoption=adopted&&adoption?.inCurrentLineage===true;
  let phase=job.status==="passed"?(formal.buildId===job.buildId?"applied":applicationPending?"applying":"ready")
    :job.status==="cancelled"?"cancelled":job.status==="interrupted"?"interrupted"
    :terminal?"failed":job.kind==="check"?"checking":"editing";
  if(job.status==="passed"&&adopted)phase=retainedAdoption?"applied":"historical";
  if(!["applied","historical"].includes(phase) && automatic?.jobId===job.jobId && automatic?.context?.sessionId===sessionId && automatic?.status==="repairing")phase="repairing";
  if(phase==="ready" && automatic?.jobId===job.jobId && automatic?.context?.sessionId===sessionId) {
    if(["queued","applying"].includes(automatic.status))phase="applying";
    else if(automatic.status==="deferred")phase="deferred";
    else if(automatic.status==="failed")phase="failed";
    else if(automatic.status==="cancelled")phase="cancelled";
  }
  const requirementStatus=hasRequirements?(job.status==="passed"?"passed":terminal?"failed":"pending")
    :formal.baseId==="creation-sandbox"?"unsupported":"not-requested";
  const automaticallyApplied=phase==="applied"&&automatic?.worldId===worldId&&automatic?.jobId===job.jobId
    &&automatic?.context?.sessionId===sessionId&&automatic?.status==="applied";
  return {worldId,sessionId,taskId:job.taskId,jobId:job.jobId,candidateId:job.candidateId??undefined,buildId:job.buildId,phase,stage:job.stage??undefined,
    ...(automaticallyApplied?{automaticallyApplied:true}:{}),
    requirementStatus,sourceStale:job.sourceStale===true,laterVersion:retainedAdoption&&formal.buildId!==job.buildId,
    error:automatic?.reason&&["failed","deferred"].includes(phase)?automatic.reason:typeof job.blockedReason==="string"?job.blockedReason:typeof job.interruptReason==="string"?job.interruptReason:undefined,
    updatedAt:job.updatedAt};
}
