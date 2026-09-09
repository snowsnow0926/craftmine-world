import {lstat,open} from 'node:fs/promises';
import {isAbsolute,parse,join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {writeSelectedFile,desktopServiceError,type CraftmineDomainCall} from './craftmine-backup-service';

const MAX_ZIP=5*1024*1024;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
function failure(code:string):never {throw desktopServiceError(code);}
const fields=(value:any,allowed:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))failure('INVALID_PARAMS');};
const identifier=(value:any)=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(value))failure('INVALID_OPERATION_ID');return value as string;};
const canonical=(value:any):string=>JSON.stringify(value,Object.keys(value).sort());
async function ordinaryFile(target:string,missing=false) {
  if(!isAbsolute(target))failure('PACKAGE_SELECTED_PATH_INVALID');
  const absolute=resolve(target),root=parse(absolute).root;let current=root;
  for(const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current=join(current,part);const stat=await lstat(current).catch(error=>{if(missing&&error.code==='ENOENT')return null;throw error;});
    if(stat?.isSymbolicLink())failure('PACKAGE_LINK_DENIED');
    if(stat&&current===absolute&&!stat.isFile())failure('PACKAGE_NONFILE_DENIED');
  }
  return absolute;
}
async function readZip(target:string) {
  const file=await open(await ordinaryFile(target),'r');
  try {
    const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_ZIP)failure('PACKAGE_ARCHIVE_TOO_LARGE');
    const buffer=Buffer.alloc(stat.size+1);let total=0;
    while(total<buffer.length){const result=await file.read(buffer,total,buffer.length-total,total);if(!result.bytesRead)break;total+=result.bytesRead;}
    const after=await file.stat();if(total!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)failure('PACKAGE_FILE_CHANGED');
    return buffer.subarray(0,total);
  }finally{await file.close();}
}
export function createCraftminePackageService(options:{domainCall:CraftmineDomainCall;selection:()=>Promise<string|null>|string|null;pickFile:(input:{kind:'export-source'|'open-source';suggestedName?:string})=>Promise<string|null>;now?:()=>number}) {
  const now=options.now??Date.now;
  type Grant={worldId:string;path:string;sha256:string;expiresAt:number};
  type Operation={binding:string;grantId?:string;pending?:Promise<any>;result?:any};
  const grants=new Map<string,Grant>(),operations=new Map<string,Operation>();let disposed=false;
  const selected=async(worldId:string)=>{if(disposed)failure('PACKAGE_SERVICE_DISPOSED');if(await options.selection()!==worldId)failure('WORLD_CHANGED');};
  const prune=()=>{for(const [id,grant]of grants)if(grant.expiresAt<=now())grants.delete(id);};
  const privateCall=(method:string,args:any)=>options.domainCall('package.request',{method,args});
  async function install(worldId:string,method:string,args:any) {
    const operationId=identifier(args.operationId),key=worldId+':'+operationId,binding=canonical({worldId,method,operationId,grantId:args.grantId??null});
    let operation=operations.get(key);
    if(operation){if(operation.binding!==binding)failure('PACKAGE_OPERATION_CONFLICT');if(operation.result)return operation.result;if(operation.pending)return operation.pending;}
    else {if(operations.size>=64)failure('PACKAGE_OPERATION_LIMIT');operation={binding};operations.set(key,operation);}
    const entry=operation;
    entry.pending=(async()=>{
      await selected(worldId);
      if(!entry.grantId) {
        if(method==='repeatImportSource')entry.grantId=identifier(args.grantId);
        else {
          const picked=await options.pickFile({kind:'open-source'});await selected(worldId);if(!picked)return {status:'cancelled',worldId,operationId};
          if(grants.size>=8)failure('PACKAGE_GRANT_LIMIT');const path=await ordinaryFile(picked),bytes=await readZip(path),grantId=randomUUID();
          grants.set(grantId,{worldId,path,sha256:hash(bytes),expiresAt:now()+10*60_000});entry.grantId=grantId;
        }
      }
      const grant=grants.get(entry.grantId);if(!grant||grant.expiresAt<=now())failure('PACKAGE_GRANT_EXPIRED');if(grant.worldId!==worldId)failure('PACKAGE_GRANT_WORLD_MISMATCH');
      const bytes=await readZip(grant.path);if(hash(bytes)!==grant.sha256)failure('PACKAGE_FILE_CHANGED');await selected(worldId);
      const result=await privateCall('installSource',{worldId,operationId,archiveBase64:bytes.toString('base64')});
      if(result.worldId!==worldId||result.applied!==false||result.archiveSha256!==grant.sha256||!['check-queued','source-saved-check-blocked'].includes(result.status)||!Array.isArray(result.instanceIds)||result.instanceIds.length>1024||result.instanceIds.some((id:any)=>typeof id!=='string'||id.length>240)||!Number.isSafeInteger(result.source?.revision)||!/^[a-f0-9]{64}$/.test(result.source?.manifestHash))failure('PACKAGE_INSTALL_RECEIPT_INVALID');
      // Project a receipt, never the core job's private request/body/paths.
      if (typeof result.job?.jobId !== 'string' || !/^gjob-[a-f0-9]{64}$/.test(result.job.jobId)) failure('PACKAGE_INSTALL_JOB_INVALID');
      return {status:result.status,applied:false,worldId,operationId,grantId:entry.grantId,instanceIds:result.instanceIds,archiveSha256:result.archiveSha256,source:{revision:result.source?.revision,manifestHash:result.source?.manifestHash,commitOid:result.source?.commitOid,assetLockHash:result.source?.assetLockHash},job:{id:result.job.jobId,status:result.job?.status,...(result.job?.error?{error:{code:result.job.error.code}}:{}),...(typeof result.job?.reason==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(result.job.reason)?{reason:result.job.reason}:{})}};
    })().then(result=>{entry.result=result;return result;}).finally(()=>{entry.pending=undefined;});
    return entry.pending;
  }
  return {
    async request(channel:string,input:any) {
      try {
        if(channel!=='package.request')failure('UNKNOWN_PACKAGE_CHANNEL');fields(input,['worldId','method','params']);
        const {worldId,method}=input,args=input.params??{};if(typeof worldId!=='string'||!worldId||args.worldId!==worldId)failure('PACKAGE_WORLD_MISMATCH');
        await selected(worldId);prune();
        if(method==='sourceJob') {
          fields(args,['worldId','jobId']);
          if(typeof args.jobId!=='string'||!/^gjob-[a-f0-9]{64}$/.test(args.jobId))failure('INVALID_PARAMS');
          const result=await options.domainCall('package.sourceJob',{worldId,jobId:args.jobId});await selected(worldId);
          const statuses=['blocked','queued','claimed','running','passed','failed','cancelled','interrupted'];
          if(result.worldId!==worldId||result.jobId!==args.jobId||!statuses.includes(result.status))failure('PACKAGE_JOB_RECEIPT_INVALID');
          return {worldId,jobId:args.jobId,status:result.status,terminal:['passed','failed','cancelled','interrupted'].includes(result.status)};
        }
        if(method==='sourceList') {fields(args,['worldId']);const result=await privateCall('sourceList',{worldId});await selected(worldId);if(result.worldId!==worldId||!Array.isArray(result.items))failure('PACKAGE_SOURCE_RECEIPT_INVALID');return {worldId,revision:result.revision,manifestHash:result.manifestHash,mainScene:result.mainScene,items:result.items.slice(0,512).map((item:any)=>({nodePath:item.nodePath,name:item.name,entityId:item.entityId,supported:item.supported===true,...(item.reason?{reason:item.reason}:{})})),truncated:result.truncated===true||result.items.length>512};}
        if(method==='exportSource') {
          fields(args,['worldId','revision','manifestHash','nodePath','assetId','version']);
          if(typeof args.assetId!=='string'||!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(args.assetId))failure('INVALID_PARAMS');
          const picked=await options.pickFile({kind:'export-source',suggestedName:args.assetId+'.zip'});await selected(worldId);if(!picked)return {status:'cancelled',worldId};
          const target=await ordinaryFile(picked,true),result=await privateCall('exportSource',args);await selected(worldId);
          if(typeof result.archiveBase64!=='string'||result.archiveBase64.length>Math.ceil(MAX_ZIP/3)*4)failure('PACKAGE_ARCHIVE_TOO_LARGE');
          const bytes=Buffer.from(result.archiveBase64,'base64');if(bytes.length>MAX_ZIP||bytes.toString('base64')!==result.archiveBase64||hash(bytes)!==result.archiveSha256)failure('PACKAGE_EXPORT_HASH_MISMATCH');
          await writeSelectedFile(target,bytes,()=>!disposed);
          return {status:'completed',worldId,archiveSha256:result.archiveSha256,bytes:bytes.length,files:result.files,requiredSourceFiles:result.requiredSourceFiles};
        }
        if(method==='importSource'||method==='repeatImportSource') {
          fields(args,method==='importSource'?['worldId','operationId']:['worldId','operationId','grantId']);const result=await install(worldId,method,args);await selected(worldId);return result;
        }
        failure('UNKNOWN_PACKAGE_METHOD');
      }catch(error){const candidate=error as {code?:unknown;errorCode?:unknown;message?:unknown};const code=candidate.errorCode??candidate.code??candidate.message;throw desktopServiceError(typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(code)?code:'PACKAGE_OPERATION_FAILED');}
    },
    dispose(){disposed=true;grants.clear();},
  };
}
