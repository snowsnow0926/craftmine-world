import { createHash } from "node:crypto";
import { desktopServiceError, writeSelectedFile, type CraftmineFilePicker } from "./craftmine-backup-service";
import type { IssueContext, IssueRecord, IssueFollowup } from "./craftmine-issue-service";

type Details = {issue:IssueRecord;followups:IssueFollowup[];revision:number;playerStatus:string};
type Request = {worldId:string;issueId:string;revision:number;operationId:string};
type Result = {status:"completed"|"cancelled";operationId:string;issueId:string;revision:number;bytes?:number;sha256?:string;scope:"selected-record"};
const fail = (code:string):never => {throw desktopServiceError(code);};
const digest = (bytes:Buffer) => createHash("sha256").update(bytes).digest("hex");
const context = (value:IssueContext) => ({phase:value.phase,status:value.status,worldId:value.worldId,buildId:value.buildId,baseId:value.baseId,baseVersion:value.baseVersion,instanceId:value.instanceId,runtimeTarget:value.runtimeTarget,artifactManifestHash:value.artifactManifestHash});
const client = (value:IssueRecord["client"]) => ({version:value.version,...(value.commit===undefined?{}:{commit:value.commit})});
/** Only fields already collected by the local issue service. No live diagnostics. */
function projection(data:Details,input:Request){
 const r=data.issue;
 if(!r||r.id!==input.issueId||r.context.worldId!==input.worldId)fail("ISSUE_NOT_FOUND");
 if(data.revision!==input.revision)fail("ISSUE_REVISION_CHANGED");
 if(!Array.isArray(data.followups)||data.followups.length!==data.revision||data.revision>32||r.attachments.length!==0)fail("ISSUE_EXPORT_INVALID_RECORD");
 if(!["recorded","still-present","player-resolved","reopened"].includes(data.playerStatus))fail("ISSUE_EXPORT_INVALID_RECORD");
 return {record:{format:r.format,id:r.id,description:r.description,createdAt:r.createdAt,context:context(r.context),status:r.status,scope:r.scope,reproduction:r.reproduction,attachments:[],client:client(r.client)},
  followups:data.followups.map(f=>{if(f.issueId!==r.id||f.context.worldId!==input.worldId)fail("ISSUE_EXPORT_INVALID_RECORD");return {format:f.format,id:f.id,issueId:f.issueId,revision:f.revision,kind:f.kind,text:f.text,createdAt:f.createdAt,context:context(f.context),client:client(f.client)};}),revision:data.revision,playerStatus:data.playerStatus};
}
export function createCraftmineIssueExportService(options:{
 read:(worldId:string,issueId:string)=>Promise<Details>;selection:()=>Promise<string|null>;pickFile:CraftmineFilePicker;now?:()=>number;
 /** Host-only deterministic fault injection; never accepted from the panel. */
 fault?:(point:"beforeWrite"|"beforeCommit")=>void|Promise<void>;
}){
 type Operation={input:Request;requestHash:string;bytes?:Buffer;content?:string;path?:string;pending?:Promise<Result>;result?:Result};
 const operations=new Map<string,Operation>();let busy:string|null=null;
 const selected=async(worldId:string)=>{if(await options.selection()!==worldId)fail("ISSUE_WORLD_CHANGED");};
 async function run(entry:Operation):Promise<Result>{
  const input=entry.input;await selected(input.worldId);
  const content=JSON.stringify(projection(await options.read(input.worldId,input.issueId),input));
  if(entry.content!==undefined&&entry.content!==content)fail("ISSUE_REVISION_CHANGED");
  if(!entry.bytes){entry.content=content;entry.bytes=Buffer.from(JSON.stringify({format:"craftmine.local-issue-export/1",scope:"selected-record",createdAt:new Date((options.now??Date.now)()).toISOString(),...JSON.parse(content),exclusions:["credentials","chat","systemLogs","screenshots","worldSource","progressSnapshots","otherIssues"]},null,2)+"\n");}
  if(entry.bytes.length>512*1024)fail("ISSUE_EXPORT_TOO_LARGE");
  if(!entry.path){const path=await options.pickFile({kind:"save-issue",suggestedName:`Craftmine-issue-${input.issueId.slice(6,18)}.json`});
   if(!path)return {status:"cancelled",operationId:input.operationId,issueId:input.issueId,revision:input.revision,scope:"selected-record"};entry.path=path;}
  const verify=async()=>{await selected(input.worldId);const current=JSON.stringify(projection(await options.read(input.worldId,input.issueId),input));if(current!==entry.content)fail("ISSUE_REVISION_CHANGED");await selected(input.worldId);};
  await verify();await options.fault?.("beforeWrite");
  await writeSelectedFile(entry.path,entry.bytes,async()=>{await options.fault?.("beforeCommit");await verify();return true;});
  return {status:"completed",operationId:input.operationId,issueId:input.issueId,revision:input.revision,bytes:entry.bytes.length,sha256:digest(entry.bytes),scope:"selected-record"};
 }
 return {async request(channel:string,value:Record<string,unknown>={}):Promise<Result>{
  try{
   if(channel!=="issue.export"||!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!=="issueId,operationId,revision,worldId"||typeof value.worldId!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.worldId)||typeof value.issueId!=="string"||!/^issue-[a-f0-9]{64}$/.test(value.issueId)||typeof value.operationId!=="string"||!/^[a-zA-Z0-9_-]{8,100}$/.test(value.operationId)||!Number.isInteger(value.revision)||Number(value.revision)<0||Number(value.revision)>32)fail("ISSUE_INVALID_INPUT");
   const input=value as Request,requestHash=JSON.stringify([input.worldId,input.issueId,input.revision]);await selected(input.worldId);
   let entry=operations.get(input.operationId);if(entry&&entry.requestHash!==requestHash)fail("ISSUE_OPERATION_CONFLICT");
   if(entry?.result)return entry.result;if(entry?.pending)return await entry.pending;
   if(busy!==null)fail("ISSUE_BUSY");if(!entry){if(operations.size>=32)fail("ISSUE_EXPORT_LIMIT");entry={input:{...input},requestHash};operations.set(input.operationId,entry);}
   busy=input.operationId;const active=entry;active.pending=run(active).then(result=>{active.result=result;return result;}).finally(()=>{active.pending=undefined;busy=null;});return await active.pending;
  }catch(error){const code=(error as any)?.code;if(typeof code==="string"&&/^ISSUE_[A-Z_]+$/.test(code))throw desktopServiceError(code);throw desktopServiceError("ISSUE_EXPORT_WRITE_FAILED");}
 }};
}
