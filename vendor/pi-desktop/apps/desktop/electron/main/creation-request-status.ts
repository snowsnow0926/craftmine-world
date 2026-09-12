import {createHash} from "node:crypto";
type Turn={turnId?:string;status?:string}|null;
type Capture={worldId?:string;snapshotId?:string}|null;

/** A persisted last job is not evidence that a later player request was done. */
export function creationRequestStatus(sessionId:string,job:{taskId?:string;worldId?:string}|null,latest:Turn,
  currentCapture:Capture=null,jobCapture:Capture=null) {
  if(!latest?.turnId)return {resultRequestRelation:"unresolved" as const};
  const taskId="work-"+createHash("sha256").update(JSON.stringify([sessionId,latest.turnId])).digest("hex");
  const sameContinuation=!!job&&typeof job.worldId==="string"&&!!job.worldId&&!!currentCapture?.snapshotId&&currentCapture.worldId===job.worldId
    &&jobCapture?.worldId===job.worldId&&jobCapture?.snapshotId===currentCapture.snapshotId;
  return {latestRequest:{turnId:latest.turnId,taskId,status:latest.status??"unknown"},
    resultRequestRelation:!job?"unresolved" as const:job.taskId===taskId||sameContinuation?"current-request" as const:"previous-request" as const};
}
