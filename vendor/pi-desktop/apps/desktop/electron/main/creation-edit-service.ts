import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import type {CreationCapture} from "./creation-target-service";

type Context={projectId:string;sessionId:string;turnId:string};
export type CreationEditInput={sessionId:string;captureId:string;operationId:string;action:"modify"|"delete"|"undo"|"place"|"duplicate"|"upgrade-observer";changes?:{scale?:number[];color?:string};undoOperationId?:string;kind?:"tree"|"rock"|"chest"|"door"|"marker";count?:number;offset?:number[]};
export type CreationEditStatus={operationId:string;sessionId:string;phase:"preparing"|"editing"|"checking"|"applying"|"applied"|"failed"|"interrupted";worldId?:string;jobId?:string;candidateId?:string;receipt?:any;error?:string};
type Bound={context:Context;capture:CreationCapture};
type Dependencies={
  directory?:string;
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
  if(!input||Object.keys(input).some(key=>!["sessionId","captureId","operationId","action","changes","undoOperationId","kind","count","offset"].includes(key)))fail("CREATION_EDIT_INVALID");
  if(![input.sessionId,input.captureId,input.operationId].every(id=>typeof id==="string"&&/^[a-zA-Z0-9._-]{1,128}$/.test(id)))fail("CREATION_EDIT_INVALID");
  if(!/^[a-zA-Z0-9_-]{1,120}$/.test(input.operationId))fail("CREATION_EDIT_INVALID");
  if(input.action!=="place"&&input.kind!==undefined||input.action!=="duplicate"&&(input.count!==undefined||input.offset!==undefined))fail("CREATION_EDIT_INVALID");
  if(input.action==="place"){
    if(!["tree","rock","chest","door","marker"].includes(input.kind??"")||input.changes!==undefined||input.undoOperationId!==undefined)fail("CREATION_EDIT_INVALID");
  }else if(input.action==="duplicate"){
    if(!Number.isInteger(input.count)||input.count!<1||input.count!>8||!Array.isArray(input.offset)||input.offset.length!==3||input.offset.some(n=>!Number.isFinite(n)||Math.abs(n)>8)||Math.hypot(...input.offset)<.5||input.changes!==undefined||input.undoOperationId!==undefined)fail("CREATION_EDIT_INVALID");
  }else if(input.action==="modify"){
    const changes=input.changes;
    if(input.undoOperationId!==undefined||!changes||!Object.keys(changes).length||Object.keys(changes).some(key=>!["scale","color"].includes(key)))fail("CREATION_EDIT_INVALID");
    if(changes.scale!==undefined&&(!Array.isArray(changes.scale)||changes.scale.length!==3||changes.scale.some(n=>!Number.isFinite(n)||n<.25||n>4)))fail("CREATION_EDIT_INVALID");
    if(changes.color!==undefined&&(typeof changes.color!=="string"||!/^#[a-fA-F0-9]{6}$/.test(changes.color)))fail("CREATION_EDIT_INVALID");
  }else if(input.action==="undo"){
    if(input.changes!==undefined||typeof input.undoOperationId!=="string"||!/^[a-zA-Z0-9_-]{1,120}$/.test(input.undoOperationId))fail("CREATION_EDIT_INVALID");
  }else if(!["delete","upgrade-observer"].includes(input.action)||input.changes!==undefined||input.undoOperationId!==undefined)fail("CREATION_EDIT_INVALID");
  return structuredClone(input);
}

/** Explicit player edits use normal plugin tools and a durable host turn, without a model. */
export function createCreationEditService(deps:Dependencies){
  type RecordEntry={owner:number|null;hash:string;status:CreationEditStatus};
  const records=new Map<string,RecordEntry>();
  const recordPath=(operationId:string)=>path.join(deps.directory!,createHash("sha256").update(operationId).digest("hex")+".json");
  const persist=(entry:RecordEntry)=>{
    if(!deps.directory)return;
    const target=recordPath(entry.status.operationId),temporary=target+".tmp";
    try{
      fs.mkdirSync(deps.directory,{recursive:true});
      fs.writeFileSync(temporary,JSON.stringify({format:"craftmine.creation-edit-state/1",hash:entry.hash,status:entry.status}),{encoding:"utf8",flag:"w"});
      fs.renameSync(temporary,target);
    }catch(error){try{fs.unlinkSync(temporary);}catch{}throw Error("CREATION_EDIT_STATE_PERSIST_FAILED: "+String(error));}
  };
  const lookup=(operationId:string):RecordEntry|undefined=>{
    const cached=records.get(operationId);if(cached)return cached;
    if(!deps.directory)return;
    let stored:any;
    try{const target=recordPath(operationId);if(fs.statSync(target).size>131072)fail("CREATION_EDIT_STATE_INVALID");stored=JSON.parse(fs.readFileSync(target,"utf8"));}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
    if(stored?.format!=="craftmine.creation-edit-state/1"||typeof stored.hash!=="string"||!/^[a-f0-9]{64}$/.test(stored.hash)||stored.status?.operationId!==operationId||typeof stored.status.sessionId!=="string"||!["preparing","editing","checking","applying","applied","failed","interrupted"].includes(stored.status.phase))fail("CREATION_EDIT_STATE_INVALID");
    const status:CreationEditStatus=stored.status;
    if(!["applied","failed","interrupted"].includes(status.phase))Object.assign(status,{phase:"interrupted",error:"CREATION_EDIT_INTERRUPTED_REVIEW_DRAFT"});
    const entry:RecordEntry={owner:null,hash:stored.hash,status};persist(entry);records.set(operationId,entry);return entry;
  };
  const busy=new Set<string>();
  const pause=deps.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  async function run(owner:number,input:CreationEditInput,status:CreationEditStatus){
    let bound:Bound|undefined;
    const publish=(patch:Partial<CreationEditStatus>)=>{
      const next={...status,...patch},entry=records.get(input.operationId)!;
      persist({...entry,status:next});Object.assign(status,next);deps.changed?.(owner,structuredClone(status));
    };
    try{
      bound=await deps.begin(owner,input);publish({worldId:bound.capture.worldId,phase:"editing"});
      const invoke=(name:string,args:Record<string,unknown>,step:string)=>deps.execute(bound!,name,args,`edit-${input.operationId}-${step}`);
      const source=await invoke("godot_project_index",{offset:0,limit:1},"index");
      const capture=bound.capture;
      let edited:any;
      if(input.action==='upgrade-observer'){
        if(!capture.observerUpgradeOnly||!capture.sourceMigration||capture.sourceMigration.revision!==source.revision||capture.sourceMigration.manifestHash!==source.manifestHash)fail('CREATION_OBSERVER_UPGRADE_SOURCE_REQUIRED');
        edited={source:{revision:source.revision,manifestHash:source.manifestHash}};
      }else{
        const request={operationId:input.operationId,action:input.action,expected:{worldId:capture.worldId,buildId:capture.buildId,instanceId:capture.instanceId,revision:source.revision,manifestHash:source.manifestHash,targetSnapshotId:capture.snapshotId},
          ...(input.action==="undo"?{undoOperationId:input.undoOperationId}:input.action==="place"?{kind:input.kind,scale:[1,1,1],color:"#84A866"}:{targetId:capture.target.entityId}),...(input.action==="duplicate"?{count:input.count,offset:input.offset}:{}),...(input.changes?{changes:input.changes}:{})};
        edited=await invoke("creation_operation",{request},"source");
      }
      publish({receipt:edited.receipt,phase:"checking"});
      const started=await invoke("godot_build_start",{...edited.source,mode:"check"},"check");
      if(started.execution?.enqueued!==true)fail(started.execution?.reason??"CREATION_EDIT_EXECUTOR_UNAVAILABLE");
      publish({jobId:started.jobId});
      const deadline=Date.now()+(deps.deadlineMs??600000);
      let job:any;
      do{
        job=await deps.readJob(bound,started.jobId);
        if(["passed","failed","cancelled","blocked","interrupted"].includes(job.status))break;
        if(Date.now()>deadline)fail("CREATION_EDIT_CHECK_TIMEOUT");
        await pause(250);
      }while(true);
      if(job.status!=="passed"||!job.candidateId)fail(job.errorCode??"CREATION_EDIT_CHECK_FAILED");
      publish({candidateId:job.candidateId,phase:"applying"});
      const result=await deps.apply(bound,job.jobId,job.candidateId);
      if(result?.status!=="applied")fail(result?.reason??"CREATION_EDIT_APPLY_FAILED");
      publish({phase:"applied"});
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      try{publish({phase:message.includes("CREATION_EDIT_STATE_PERSIST_FAILED")?"interrupted":"failed",error:message});}
      catch{Object.assign(status,{phase:"interrupted",error:message});deps.changed?.(owner,structuredClone(status));}
    }
    finally{
      if(bound)try{await deps.finish(bound,structuredClone(status));}catch(error){
        const message=`CREATION_EDIT_CLOSEOUT_FAILED: ${String(error)}`;
        try{publish({error:message});}catch{Object.assign(status,{phase:"interrupted",error:message});deps.changed?.(owner,structuredClone(status));}
      }
      busy.delete(input.sessionId);
    }
  }
  return {
    start(owner:number,value:unknown){
      const input=validateCreationEdit(value),hash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const previous=lookup(input.operationId);
      if(previous){if(previous.owner!==owner||previous.hash!==hash)fail("CREATION_EDIT_REPLAY_CONFLICT");return structuredClone(previous.status);}
      if(busy.has(input.sessionId))fail("CREATION_EDIT_BUSY");
      if(records.size>=128){const completed=[...records].find(([,entry])=>["applied","failed","interrupted"].includes(entry.status.phase));if(completed)records.delete(completed[0]);else fail("CREATION_EDIT_BUSY");}
      const status:CreationEditStatus={operationId:input.operationId,sessionId:input.sessionId,phase:"preparing"};
      const entry={owner,hash,status};persist(entry);records.set(input.operationId,entry);busy.add(input.sessionId);void run(owner,input,status);
      return structuredClone(status);
    },
    status(owner:number,operationId:string,authorization?:{sessionId:string;worldId:string}){
      const value=lookup(operationId);if(!value)fail("CREATION_EDIT_NOT_FOUND");
      if(authorization&&(value.status.sessionId!==authorization.sessionId||(value.status.worldId!==undefined&&value.status.worldId!==authorization.worldId)))fail("CREATION_EDIT_CONTEXT_CHANGED");
      if(value.owner!==owner){if(!authorization)fail("CREATION_EDIT_NOT_FOUND");value.owner=owner;}
      return structuredClone(value.status);
    },
  };
}
