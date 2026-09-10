import {createHash} from "node:crypto";
import type {CreationCapture} from "./creation-target-service";

type Context={projectId:string;sessionId:string;turnId:string};
export type CreationEditInput={sessionId:string;captureId:string;operationId:string;action:"modify"|"delete"|"undo";changes?:{scale?:number[];color?:string};undoOperationId?:string};
export type CreationEditStatus={operationId:string;sessionId:string;phase:"preparing"|"editing"|"checking"|"applying"|"applied"|"failed";worldId?:string;jobId?:string;candidateId?:string;receipt?:any;error?:string};
type Bound={context:Context;capture:CreationCapture};
type Dependencies={
  begin(owner:number,input:CreationEditInput):Promise<Bound>;
  execute(bound:Bound,name:string,args:Record<string,unknown>,toolCallId:string):Promise<any>;
  readJob(bound:Bound,jobId:string):Promise<any>;
  apply(bound:Bound,jobId:string,candidateId:string):Promise<any>;
  finish(bound:Bound,status:CreationEditStatus):Promise<void>;
  changed?(owner:number,status:CreationEditStatus):void;
  pause?(ms:number):Promise<void>;
  deadlineMs?:number;
};
function fail(code:string):never{throw Error(code);}
export function validateCreationEdit(value:unknown):CreationEditInput {
  const input=value as CreationEditInput;
  if(!input||Object.keys(input).some(key=>!["sessionId","captureId","operationId","action","changes","undoOperationId"].includes(key)))fail("CREATION_EDIT_INVALID");
  if(![input.sessionId,input.captureId,input.operationId].every(id=>typeof id==="string"&&/^[a-zA-Z0-9._-]{1,128}$/.test(id)))fail("CREATION_EDIT_INVALID");
  if(!/^[a-zA-Z0-9_-]{1,120}$/.test(input.operationId))fail("CREATION_EDIT_INVALID");
  if(input.action==="modify"){
    const changes=input.changes;
    if(input.undoOperationId!==undefined||!changes||!Object.keys(changes).length||Object.keys(changes).some(key=>!["scale","color"].includes(key)))fail("CREATION_EDIT_INVALID");
    if(changes.scale!==undefined&&(!Array.isArray(changes.scale)||changes.scale.length!==3||changes.scale.some(n=>!Number.isFinite(n)||n<.25||n>4)))fail("CREATION_EDIT_INVALID");
    if(changes.color!==undefined&&(typeof changes.color!=="string"||!/^#[a-fA-F0-9]{6}$/.test(changes.color)))fail("CREATION_EDIT_INVALID");
  }else if(input.action==="undo"){
    if(input.changes!==undefined||typeof input.undoOperationId!=="string"||!/^[a-zA-Z0-9_-]{1,120}$/.test(input.undoOperationId))fail("CREATION_EDIT_INVALID");
  }else if(input.action!=="delete"||input.changes!==undefined||input.undoOperationId!==undefined)fail("CREATION_EDIT_INVALID");
  return structuredClone(input);
}

/** Explicit player edits use normal plugin tools and a durable host turn, without a model. */
export function createCreationEditService(deps:Dependencies){
  const records=new Map<string,{owner:number;hash:string;status:CreationEditStatus}>();
  const busy=new Set<string>();
  const pause=deps.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  async function run(owner:number,input:CreationEditInput,status:CreationEditStatus){
    let bound:Bound|undefined;
    const publish=(patch:Partial<CreationEditStatus>)=>{Object.assign(status,patch);deps.changed?.(owner,structuredClone(status));};
    try{
      bound=await deps.begin(owner,input);publish({worldId:bound.capture.worldId,phase:"editing"});
      const invoke=(name:string,args:Record<string,unknown>,step:string)=>deps.execute(bound!,name,args,`edit-${input.operationId}-${step}`);
      const source=await invoke("godot_project_index",{offset:0,limit:1},"index");
      const capture=bound.capture;
      const request={operationId:input.operationId,action:input.action,expected:{worldId:capture.worldId,buildId:capture.buildId,instanceId:capture.instanceId,revision:source.revision,manifestHash:source.manifestHash,targetSnapshotId:capture.snapshotId},
        ...(input.action==="undo"?{undoOperationId:input.undoOperationId}:{targetId:capture.target.entityId}),...(input.changes?{changes:input.changes}:{})};
      const edited=await invoke("creation_operation",{request},"source");publish({receipt:edited.receipt,phase:"checking"});
      const started=await invoke("godot_build_start",{...edited.source,mode:"check"},"check");
      if(started.execution?.enqueued!==true)fail(started.execution?.reason??"CREATION_EDIT_EXECUTOR_UNAVAILABLE");
      publish({jobId:started.jobId});
      const deadline=Date.now()+(deps.deadlineMs??600000);
      let job:any;
      do{
        job=await deps.readJob(bound,started.jobId);
        if(["passed","failed","cancelled","blocked"].includes(job.status))break;
        if(Date.now()>deadline)fail("CREATION_EDIT_CHECK_TIMEOUT");
        await pause(250);
      }while(true);
      if(job.status!=="passed"||!job.candidateId)fail(job.errorCode??"CREATION_EDIT_CHECK_FAILED");
      publish({candidateId:job.candidateId,phase:"applying"});
      const result=await deps.apply(bound,job.jobId,job.candidateId);
      if(result?.status!=="applied")fail(result?.reason??"CREATION_EDIT_APPLY_FAILED");
      publish({phase:"applied"});
    }catch(error){publish({phase:"failed",error:error instanceof Error?error.message:String(error)});}
    finally{
      if(bound)try{await deps.finish(bound,structuredClone(status));}catch(error){publish({error:`CREATION_EDIT_CLOSEOUT_FAILED: ${String(error)}`});}
      busy.delete(input.sessionId);
    }
  }
  return {
    start(owner:number,value:unknown){
      const input=validateCreationEdit(value),hash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const previous=records.get(input.operationId);
      if(previous){if(previous.owner!==owner||previous.hash!==hash)fail("CREATION_EDIT_REPLAY_CONFLICT");return structuredClone(previous.status);}
      if(busy.has(input.sessionId))fail("CREATION_EDIT_BUSY");
      if(records.size>=128){const completed=[...records].find(([,entry])=>["applied","failed"].includes(entry.status.phase));if(completed)records.delete(completed[0]);else fail("CREATION_EDIT_BUSY");}
      const status:CreationEditStatus={operationId:input.operationId,sessionId:input.sessionId,phase:"preparing"};
      records.set(input.operationId,{owner,hash,status});busy.add(input.sessionId);void run(owner,input,status);
      return structuredClone(status);
    },
    status(owner:number,operationId:string){const value=records.get(operationId);if(!value||value.owner!==owner)fail("CREATION_EDIT_NOT_FOUND");return structuredClone(value.status);},
  };
}
