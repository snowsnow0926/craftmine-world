import {createHash} from 'node:crypto';
import {assertCreationJobRequirements,freezeUndoRequirements} from './creation-check-requirements';
import type {CreationCapture} from './creation-target-service';
import type {DirectCreationIntent} from './creation-check-requirements';
import type {CreationEditInput} from './creation-edit-service';
type Data=Record<string,any>;
type Domain=(method:string,input:Data)=>Promise<any>;
type Context={projectId:string;sessionId:string;turnId:string};

/** Placement only uses current ground; explicit recent selections identify objects, not landing points. */
export function directCreationEditIntent(capture:CreationCapture,input:CreationEditInput):Exclude<DirectCreationIntent,{action:'undo'}>{
  if(input.action==='place'){
    if((capture as CreationCapture&{source?:string}).source==='recent'||capture.target.surface!=='ground'||!capture.target.position)throw Error('CREATION_PLACEMENT_GROUND_REQUIRED');
    return {action:'place',kind:input.kind!,scale:[1,1,1],color:'#84A866',...input.placement};
  }
  const targetId=capture.target.entityId;if(!targetId)throw Error('CREATION_OBJECT_REQUIRED');
  if(input.action==='modify')return {action:'modify',targetId,changes:input.changes!};
  if(input.action==='duplicate')return {action:'duplicate',targetId,count:input.count!,offset:input.offset!};
  if(input.action==='delete')return {action:'delete',targetId};
  throw Error('CREATION_EDIT_INVALID');
}

/** Read only the immutable source exported for the still-current formal build. */
export async function readFormalCreationJournal(domain:Domain,capture:CreationCapture){
  const worldId=capture.worldId,source=await domain('godotRuntime.exportSource',{worldId});
  if(source?.worldId!==worldId||source.buildId!==capture.buildId||source.baseId!=='creation-sandbox'||typeof source.contentOid!=='string'||!Array.isArray(source.files))throw Error('CREATION_TARGET_STALE');
  const name='world/creation-operations.json',file=source.files.find((entry:Data)=>entry.path===name);
  let journal:any=null;
  if(file){
    if(!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>4*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('CREATION_FORMAL_JOURNAL_INVALID');
    const content=await domain('content.readFile',{worldId,rev:source.contentOid,path:name,encoding:'text'});
    if(content?.worldId!==worldId||content.rev!==source.contentOid||content.path!==name||typeof content.text!=='string'||content.bytes!==file.bytes||content.sha256!==file.sha256||Buffer.byteLength(content.text,'utf8')!==file.bytes||createHash('sha256').update(content.text,'utf8').digest('hex')!==file.sha256)throw Error('CREATION_FORMAL_JOURNAL_MISMATCH');
    try{journal=JSON.parse(content.text);}catch{throw Error('CREATION_FORMAL_JOURNAL_INVALID');}
    if(journal?.format!=='craftmine.creation-operations/1'||!Array.isArray(journal.operations)||journal.operations.length>4096)throw Error('CREATION_FORMAL_JOURNAL_INVALID');
  }
  const formal=await domain('godotRuntime.describe',{worldId});
  if(formal?.worldId!==worldId||formal.buildId!==capture.buildId||formal.sourceRevision!==capture.sourceRevision||formal.manifestHash!==capture.manifestHash)throw Error('CREATION_TARGET_STALE');
  const latest=journal?.operations.slice().reverse().find((entry:Data)=>freezeUndoRequirements(capture,journal,entry.operationId).status==='verifiable');
  return {journal,latestUndoOperationId:latest?.operationId??null};
}

export async function assertDirectCreationCandidate(domain:Domain,context:Context,capture:CreationCapture,jobId:string,candidateId:string){
  const worldId=capture.worldId;
  const formal=await domain('godotRuntime.describe',{worldId});
  if(formal?.baseId!=='creation-sandbox'||formal.worldId!==worldId||formal.buildId!==capture.buildId||formal.sourceRevision!==capture.sourceRevision||formal.manifestHash!==capture.manifestHash)throw Error('CREATION_TARGET_STALE');
  const job=await domain('godotBuild.read',{context,worldId,jobId});
  if(job?.worldId!==worldId||job.jobId!==jobId||job.kind!=='check'||job.status!=='passed'||job.baseId!=='creation-sandbox'||job.candidateId!==candidateId)throw Error('CREATION_CHECK_NOT_PASSED');
  if(capture.observerUpgradeOnly){
    const advance=capture.sourceMigration;
    if(capture.sceneObjectTarget||capture.target.surface!=='none'||capture.autoApply||!advance||advance.formalBuildId!==capture.buildId||advance.formalSourceRevision!==capture.sourceRevision||advance.formalManifestHash!==capture.manifestHash||job.sourceRevision!==advance.revision||job.manifestHash!==advance.manifestHash||job.sourceStale!==false)throw Error('CREATION_OBSERVER_UPGRADE_SOURCE_REQUIRED');
  }else assertCreationJobRequirements(capture,job);
  const result=await domain('godotCandidate.read',{worldId,candidateId}),candidate=result?.candidate;
  if(result?.checkStatus!=='passed'||candidate?.status!=='ready'||candidate.worldId!==worldId||candidate.checkJobId!==jobId||candidate.buildId!==job.buildId||candidate.sourceRevision!==job.sourceRevision||candidate.manifestHash!==job.manifestHash||candidate.checkOutputHash!==job.outputHash)throw Error('CREATION_CANDIDATE_UNVERIFIED');
  const source=await domain('godotProject.index',{context,worldId,branchId:job.branchId??'main',offset:0,limit:1});
  if(source?.currentTaskId!==job.taskId||source.worldId!==worldId||source.baseId!=='creation-sandbox'||source.revision!==candidate.sourceRevision||source.manifestHash!==candidate.manifestHash)throw Error('CREATION_CHECK_SOURCE_CHANGED');
  if(candidate.content&&(source.content?.repoId!==candidate.content.repoId||source.content?.contentOid!==candidate.content.contentOid||source.content?.branchId!==candidate.content.branchId))throw Error('CREATION_CHECK_SOURCE_CHANGED');
}
