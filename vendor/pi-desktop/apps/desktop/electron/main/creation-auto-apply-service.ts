import type {CreationCapture} from "./creation-target-service";

type Context={projectId:string;sessionId:string;turnId:string};
type Data=Record<string,any>;
export type CreationCheckCompletion={jobId:string;context:Context};
type Dependencies={
  capture(context:Context):Promise<CreationCapture|null>;
  domain(method:string,input:Data):Promise<any>;
  apply(worldId:string,candidateId:string,expected:{buildId:string;instanceId:string},guard:()=>Promise<void>):Promise<Data>;
};

/** A plugin reports only a job id. Authority and evidence are reread by the host. */
export function createCreationAutoApplyService(deps:Dependencies){
  const running=new Map<string,Promise<Data>>();
  const completed=new Map<string,Data>();
  async function perform({jobId,context}:CreationCheckCompletion):Promise<Data>{
    const capture=await deps.capture(context);
    if(!capture?.autoApply)return {status:"manual",reason:"CREATION_AUTO_APPLY_NOT_AUTHORIZED"};
    const worldId=capture.worldId;
    let candidateId="";
    const guard=async()=>{
      const latest=await deps.capture(context);
      if(!latest?.autoApply||latest.snapshotId!==capture.snapshotId)throw Error("CREATION_AUTO_APPLY_NOT_AUTHORIZED");
      const formal=await deps.domain("godotRuntime.describe",{worldId});
      if(formal?.baseId!=="creation-sandbox"||formal.worldId!==worldId||formal.buildId!==capture.buildId||formal.sourceRevision!==capture.sourceRevision||formal.manifestHash!==capture.manifestHash)throw Error("CREATION_TARGET_STALE");
      const job=await deps.domain("godotBuild.read",{context,worldId,jobId});
      if(job?.worldId!==worldId||job.jobId!==jobId||job.kind!=="check"||job.status!=="passed"||job.baseId!=="creation-sandbox"||typeof job.candidateId!=="string"||!job.candidateId)throw Error("CREATION_CHECK_NOT_PASSED");
      if(candidateId&&candidateId!==job.candidateId)throw Error("CREATION_CANDIDATE_CHANGED");
      candidateId=job.candidateId;
      const result=await deps.domain("godotCandidate.read",{context,worldId,candidateId});
      const candidate=result?.candidate;
      if(result?.checkStatus!=="passed"||candidate?.status!=="ready"||candidate.worldId!==worldId||candidate.checkJobId!==jobId||candidate.buildId!==job.buildId||candidate.sourceRevision!==job.sourceRevision||candidate.manifestHash!==job.manifestHash||candidate.checkOutputHash!==job.outputHash)throw Error("CREATION_CANDIDATE_UNVERIFIED");
      const source=await deps.domain("godotProject.index",{context,worldId,branchId:job.branchId??"main",offset:0,limit:1});
      if(source?.currentTaskId!==job.taskId||source.worldId!==worldId||source.baseId!=="creation-sandbox"||source.revision!==candidate.sourceRevision||source.manifestHash!==candidate.manifestHash)throw Error("CREATION_CHECK_SOURCE_CHANGED");
      if(candidate.content&&(source.content?.repoId!==candidate.content.repoId||source.content?.contentOid!==candidate.content.contentOid||source.content?.branchId!==candidate.content.branchId))throw Error("CREATION_CHECK_SOURCE_CHANGED");
    };
    await guard();
    return deps.apply(worldId,candidateId,{buildId:capture.buildId,instanceId:capture.instanceId},guard);
  }
  return {
    completed(input:CreationCheckCompletion):Promise<Data>{
      if(!input||Object.keys(input).length!==2||typeof input.jobId!=="string"||!/^gjob-[a-f0-9]{64}$/.test(input.jobId)||!input.context||Object.keys(input.context).length!==3||!["projectId","sessionId","turnId"].every(key=>typeof (input.context as Data)[key]==="string"&&(input.context as Data)[key].length>0&&(input.context as Data)[key].length<=240))return Promise.reject(Error("CREATION_COMPLETION_INVALID"));
      const key=JSON.stringify([input.context.projectId,input.context.sessionId,input.context.turnId,input.jobId]);
      const known=completed.get(key);if(known)return Promise.resolve(structuredClone(known));
      const pending=running.get(key);if(pending)return pending;
      const task=perform(input).then(result=>{
        if(result.status==="applied"){completed.set(key,structuredClone(result));if(completed.size>64)completed.delete(completed.keys().next().value!);}
        return result;
      }).finally(()=>running.delete(key));
      running.set(key,task);return task;
    },
  };
}
