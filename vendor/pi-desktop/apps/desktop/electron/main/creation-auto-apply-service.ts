import {creationRequirementsHash} from "./creation-check-requirements.ts";
import type {CreationCapture} from "./creation-target-service";

type Context={projectId:string;sessionId:string;turnId:string};
type Data=Record<string,any>;
export type CreationCheckCompletion={jobId:string;context:Context};
type Dependencies={
  capture(context:Context):Promise<CreationCapture|null>;
  settled?(context:Context):Promise<boolean>;
  domain(method:string,input:Data):Promise<any>;
  apply(worldId:string,candidateId:string,expected:{buildId:string;instanceId:string},guard:()=>Promise<void>):Promise<Data>;
};

/** A plugin reports only a job id. Authority and evidence are reread by the host. */
export function createCreationAutoApplyService(deps:Dependencies){
  const running=new Map<string,Promise<Data>>();
  const runningInputs=new Map<string,CreationCheckCompletion>();
  const completed=new Map<string,Data>();
  async function perform({jobId,context}:CreationCheckCompletion):Promise<Data>{
    const capture=await deps.capture(context);
    if(!capture?.autoApply)return {status:"manual",reason:"CREATION_AUTO_APPLY_NOT_AUTHORIZED"};
    const required=capture.creationRequirements?.status==="verifiable"?capture.creationRequirements.requirements:null;
    // Full Auto authorizes general project edits, too. Exact recognized wishes
    // keep their stronger semantic assertions; other edits require real frame,
    // save/reload and recovery evidence, never a model's claim of success.
    const general=capture.authorization==="full-auto"&&/^[a-f0-9]{64}$/.test(capture.requestHash??"");
    if(!required&&!general)return {status:"manual",reason:"CREATION_REQUIREMENTS_NEED_REVIEW"};
    const worldId=capture.worldId;
    const priorJob=await deps.domain("godotBuild.read",{context,worldId,jobId});
    const priorFormal=await deps.domain("godotRuntime.describe",{worldId});
    if(priorJob?.worldId===worldId&&priorJob.jobId===jobId&&priorJob.kind==="check"&&priorJob.status==="passed"&&priorJob.candidateId){
      const verified=await deps.domain("godotCandidate.read",{worldId,candidateId:priorJob.candidateId}),adoption=verified?.adoption;
      if(verified?.checkStatus==="passed"&&verified.candidate?.worldId===worldId&&verified.candidate.checkJobId===jobId&&verified.candidate.buildId===priorJob.buildId&&verified.candidate.checkOutputHash===priorJob.outputHash&&adoption?.worldId===worldId&&adoption.candidateId===priorJob.candidateId&&adoption.buildId===priorJob.buildId&&adoption.currentBuildId===priorFormal?.buildId&&adoption.wasApplied===true)
        return adoption.inCurrentLineage===true?{status:"applied",worldId,candidateId:priorJob.candidateId,recovered:true}:{status:"manual",worldId,candidateId:priorJob.candidateId,reason:"CREATION_RESULT_HISTORICAL"};
    }
    if(priorJob?.worldId===worldId&&priorJob.jobId===jobId&&priorJob.kind==="check"&&priorJob.status==="passed"&&priorJob.candidateId&&priorFormal?.worldId===worldId&&priorFormal.buildId===priorJob.buildId&&priorFormal.manifestHash===priorJob.manifestHash&&priorFormal.sourceRevision===priorJob.sourceRevision){
      const verified=await deps.domain("godotCandidate.read",{worldId,candidateId:priorJob.candidateId});
      if(verified?.checkStatus==="passed"&&verified.candidate?.worldId===worldId&&verified.candidate.checkJobId===jobId&&verified.candidate.buildId===priorJob.buildId&&verified.candidate.checkOutputHash===priorJob.outputHash)return {status:"applied",worldId,candidateId:priorJob.candidateId,recovered:true};
    }
    const newest=await deps.domain("godotBuild.latest",{worldId,sessionId:context.sessionId});
    if(newest?.worldId!==worldId)throw Error("CREATION_CHECK_OWNER_CHANGED");
    if(newest.jobId!==jobId)return {status:"manual",worldId,candidateId:priorJob?.candidateId,reason:"CREATION_CHECK_SUPERSEDED"};
    // Core adoption completes the author task and releases its world lease.
    // Keep the model's current turn writable until it has finished all edits.
    if(deps.settled&&!await deps.settled(context))return {status:"deferred",worldId,candidateId:priorJob?.candidateId,reason:"CREATION_AWAITING_TURN_FINISH"};
    let candidateId="";
    const guard=async()=>{
      const latest=await deps.capture(context);
      if(!latest?.autoApply||latest.snapshotId!==capture.snapshotId)throw Error("CREATION_AUTO_APPLY_NOT_AUTHORIZED");
      if(deps.settled&&!await deps.settled(context))throw Error("CREATION_TURN_BUSY");
      const newest=await deps.domain("godotBuild.latest",{worldId,sessionId:context.sessionId});
      if(newest?.worldId!==worldId||newest.jobId!==jobId)throw Error("CREATION_CHECK_SUPERSEDED");
      const formal=await deps.domain("godotRuntime.describe",{worldId});
      if(formal?.baseId!=="creation-sandbox"||formal.worldId!==worldId||formal.buildId!==capture.buildId||formal.sourceRevision!==capture.sourceRevision||formal.manifestHash!==capture.manifestHash)throw Error("CREATION_TARGET_STALE");
      const job=await deps.domain("godotBuild.read",{context,worldId,jobId});
      if(job?.worldId!==worldId||job.jobId!==jobId||job.kind!=="check"||job.status!=="passed"||job.baseId!=="creation-sandbox"||typeof job.candidateId!=="string"||!job.candidateId)throw Error("CREATION_CHECK_NOT_PASSED");
      if(required&&(job.checkRequirementsHash!==creationRequirementsHash(required)||!job.checkRequirements?.creation||creationRequirementsHash(job.checkRequirements.creation)!==creationRequirementsHash(required)))throw Error("CREATION_REQUIREMENTS_NOT_BOUND");
      if(candidateId&&candidateId!==job.candidateId)throw Error("CREATION_CANDIDATE_CHANGED");
      candidateId=job.candidateId;
      // This private host route accepts only ids; task ownership is established
      // by the context-bound job and source index on either side of this read.
      const result=await deps.domain("godotCandidate.read",{worldId,candidateId});
      const candidate=result?.candidate;
      if(result?.checkStatus!=="passed"||candidate?.status!=="ready"||candidate.worldId!==worldId||candidate.checkJobId!==jobId||candidate.buildId!==job.buildId||candidate.sourceRevision!==job.sourceRevision||candidate.manifestHash!==job.manifestHash||candidate.checkOutputHash!==job.outputHash)throw Error("CREATION_CANDIDATE_UNVERIFIED");
      if(!required){
        const checks=result.check?.assertions;
        if(!Array.isArray(checks)||!["runtime.ready","runtime.frame","runtime.no-errors","runtime.snapshot","runtime.isolation","runtime.recovery"].every(id=>checks.filter((item:any)=>item?.id===id&&item.passed===true).length===1))throw Error("CREATION_RUNTIME_EVIDENCE_REQUIRED");
        if(candidate.manifestHash===capture.manifestHash||candidate.sourceRevision<=capture.sourceRevision)throw Error("CREATION_NO_SOURCE_CHANGE");
      }
      const source=await deps.domain("godotProject.index",{context,worldId,branchId:job.branchId??"main",offset:0,limit:1});
      if(source?.currentTaskId!==job.taskId||source.worldId!==worldId||source.baseId!=="creation-sandbox"||source.revision!==candidate.sourceRevision||source.manifestHash!==candidate.manifestHash)throw Error("CREATION_CHECK_SOURCE_CHANGED");
      if(candidate.content&&(source.content?.repoId!==candidate.content.repoId||source.content?.contentOid!==candidate.content.contentOid||source.content?.branchId!==candidate.content.branchId))throw Error("CREATION_CHECK_SOURCE_CHANGED");
    };
    await guard();
    return deps.apply(worldId,candidateId,{buildId:capture.buildId,instanceId:capture.instanceId},guard);
  }
  return {
    isApplying(jobId:string,sessionId:string):boolean {
      return [...runningInputs.values()].some(input=>input.jobId===jobId&&input.context.sessionId===sessionId);
    },
    completed(input:CreationCheckCompletion):Promise<Data>{
      if(!input||Object.keys(input).length!==2||typeof input.jobId!=="string"||!/^gjob-[a-f0-9]{64}$/.test(input.jobId)||!input.context||Object.keys(input.context).length!==3||!["projectId","sessionId","turnId"].every(key=>typeof (input.context as Data)[key]==="string"&&(input.context as Data)[key].length>0&&(input.context as Data)[key].length<=240))return Promise.reject(Error("CREATION_COMPLETION_INVALID"));
      const key=JSON.stringify([input.context.projectId,input.context.sessionId,input.context.turnId,input.jobId]);
      const known=completed.get(key);if(known)return Promise.resolve(structuredClone(known));
      const pending=running.get(key);if(pending)return pending;
      const task=perform(input).then(result=>{
        if(result.status==="applied"){completed.set(key,structuredClone(result));if(completed.size>64)completed.delete(completed.keys().next().value!);}
        return result;
      }).finally(()=>{running.delete(key);runningInputs.delete(key);});
      runningInputs.set(key,structuredClone(input));running.set(key,task);return task;
    },
  };
}
