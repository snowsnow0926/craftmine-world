'use strict';
const {createHash}=require('node:crypto');
const {creationTiming}=require('./creation-timing.cjs');
const {compileCreationOperation,SCENE_PATH,JOURNAL_PATH}=require('./creation-operations.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{errorCode:code});};
const check=(ok,code)=>{if(!ok)fail(code);};
const pin=value=>`${value.revision}:${value.manifestHash}`;

// A turn retains its captured point while its own bounded operations advance
// the draft. Unrelated edits require a new capture; they never silently retarget.
function createCreationSourceService({core,capture,sample,assertActive}) {
 const advances=new Map();
 async function index(context,worldId,version){
  let offset=0,first=null;const files=new Map();
  do {
   const page=await core.call('godotProject.index',{context,worldId,...version,offset,limit:32});assertActive(context);
   first??=page;
   check(page.worldId===worldId&&page.revision===first.revision&&page.manifestHash===first.manifestHash&&page.baseId==='creation-sandbox','CREATION_SOURCE_BINDING_INVALID');
   check(Array.isArray(page.files)&&page.files.length<=32,'CREATION_SOURCE_PAGE_INVALID');
   for(const file of page.files){check(typeof file.path==='string'&&!files.has(file.path)&&files.size<512,'CREATION_SOURCE_PAGE_INVALID');files.set(file.path,file);}
   const next=page.nextOffset;check(next==null||(Number.isSafeInteger(next)&&next>offset&&next<=512),'CREATION_SOURCE_PAGE_INVALID');offset=next;
  }while(offset!=null);
  return {...first,files};
 }
 async function read(context,worldId,source,file){
  const limit=file.path===JOURNAL_PATH?4*1024*1024:120000;
  check(Number.isSafeInteger(file.bytes)&&file.bytes<=limit,'CREATION_SOURCE_TOO_LARGE');
  let offset=0,text='';
  do {
   const part=await core.call('godotProject.read',{context,worldId,revision:source.revision,manifestHash:source.manifestHash,path:file.path,offset,limit:16000});assertActive(context);
   check(part.worldId===worldId&&part.revision===source.revision&&part.manifestHash===source.manifestHash&&part.sha256===file.sha256&&typeof part.text==='string','CREATION_SOURCE_CHANGED');
   text+=part.text;check(Buffer.byteLength(text)<=limit,'CREATION_SOURCE_TOO_LARGE');
   const next=part.nextOffset;check(next==null||(Number.isSafeInteger(next)&&next>offset),'CREATION_SOURCE_PAGE_INVALID');offset=next;
  }while(offset!=null);
  check(Buffer.byteLength(text)===file.bytes&&hash(text)===file.sha256,'CREATION_SOURCE_FILE_HASH_MISMATCH');
  return {text,sha256:file.sha256};
 }
 return async function execute({context,workspace,request}){
  const timing=creationTiming();
  try {
  check(typeof capture==='function','CREATION_TARGET_PROVIDER_UNAVAILABLE');
  const bound=await timing.measure('capture',()=>capture(context));assertActive(context);
  check(bound?.format==='craftmine.creation-target/1'&&bound.worldId===workspace.worldId,'CREATION_TARGET_REQUIRED');
  const e=request?.expected;
  for(const key of ['worldId','buildId','instanceId'])check(e?.[key]===bound[key],'CREATION_TARGET_IDENTITY_MISMATCH');
  check(e.targetSnapshotId===bound.snapshotId,'CREATION_TARGET_IDENTITY_MISMATCH');
  const version={revision:e.revision,manifestHash:e.manifestHash};
  const sourceIndex=await timing.measure('source-index',()=>index(context,workspace.worldId,version));
  check(sourceIndex.revision===e.revision&&sourceIndex.manifestHash===e.manifestHash,'CREATION_STALE_SOURCE');
  const files=Object.fromEntries([...sourceIndex.files.keys()].map(path=>[path,{}]));
  for(const path of [SCENE_PATH,JOURNAL_PATH])if(sourceIndex.files.has(path))files[path]=await timing.measure(path===JOURNAL_PATH?'read-journal':'read-scene',()=>read(context,workspace.worldId,sourceIndex,sourceIndex.files.get(path)));
  // The production creation base always carries the initial scene. A missing
  // file is damaged source, not permission to turn an unrelated base into one.
  check(files[SCENE_PATH]?.text,'CREATION_SOURCE_FILE_MISSING');
  let document;try{document=JSON.parse(files[SCENE_PATH].text);}catch{fail('CREATION_SOURCE_JSON_INVALID');}
  const targetSnapshot={...structuredClone(bound),source:bound.source??'ray',sourceRevision:e.revision,manifestHash:e.manifestHash,target:{...bound.target,revision:document.revision}};
  const source={worldId:workspace.worldId,buildId:bound.buildId,instanceId:bound.instanceId,revision:e.revision,manifestHash:e.manifestHash,files};
  const result=compileCreationOperation({source,targetSnapshot,request});
  const toolCallId='creation-'+hash(JSON.stringify([workspace.task.binding.taskId,request.operationId]));
  const params={context,worldId:workspace.worldId,toolCallId,revision:e.revision,manifestHash:e.manifestHash,operations:result.operations};
  if(sourceIndex.content){
   const c=sourceIndex.content;check(c.branchId==='main'&&typeof c.repoId==='string'&&/^[a-f0-9]{40,64}$/.test(c.contentOid),'CREATION_CONTENT_IDENTITY_INVALID');
   params.operation={operationId:toolCallId,worldId:workspace.worldId,repoId:c.repoId,branchId:'main',expectedHeadOid:c.contentOid,expectedAppliedOid:null,expectedProgressRevision:null};
  }
  const key=JSON.stringify([context.projectId,context.sessionId,context.turnId,bound.snapshotId]);
  const known=advances.get(key)??new Set([`${bound.sourceRevision}:${bound.manifestHash}`]);
  // This advance is written only by the main host after an exact stock-file
  // migration and receipt verification; the model cannot supply this record.
  const migration=bound.sourceMigration;
  if(migration?.format==='craftmine.creation-migration-advance/1'&&migration.formalBuildId===bound.buildId&&migration.formalSourceRevision===bound.sourceRevision&&migration.formalManifestHash===bound.manifestHash&&Number.isSafeInteger(migration.revision)&&/^[a-f0-9]{64}$/.test(migration.manifestHash))known.add(pin(migration));
  const previous=async()=>timing.measure('receipt-lookup',()=>core.call('godotProject.receipt',{binding:workspace.task.binding,worldId:workspace.worldId,toolCallId,method:'godotProject.patch',request:params}));
  const response=(receipt,replayed)=>({format:'craftmine.creation-operation-result/1',receipt:result.receipt,changeSummary:result.changeSummary,source:{revision:receipt.revision,manifestHash:receipt.manifestHash},replayed,applied:false,checkRequired:true,timing:timing.snapshot()});
  // Exact committed request lookup also recovers reply loss before checking a
  // new write's liveness. It never resubmits an uncertain patch.
  if(!result.replayed){const receipt=await previous();if(receipt){known.add(pin(receipt));advances.set(key,known);return response(receipt,true);}}
  if(result.replayed)return response(sourceIndex,true);
  check(request.action!=='place'||bound.source!=='recent','CREATION_PLACEMENT_GROUND_REQUIRED');
  if(!known.has(pin(sourceIndex))){
   // Opening a new task can reindex the same formal bytes under a different
   // revision. Only a complete core-proven formal source identity can rebase
   // this capture; caller-chosen pins or a journal assertion are insufficient.
   const formal=await timing.measure('formal-source',()=>core.call('godotRuntime.exportSource',{worldId:bound.worldId}));assertActive(context);
   check(formal?.worldId===bound.worldId&&formal.buildId===bound.buildId&&formal.baseId==='creation-sandbox'&&formal.sourceRevision===bound.sourceRevision,'CREATION_TARGET_SOURCE_CHANGED_RECAPTURE');
   const sameContent=sourceIndex.content&&sourceIndex.content.repoId===formal.repoId&&sourceIndex.content.contentOid===formal.contentOid;
   const formalFiles=Array.isArray(formal.files)?formal.files.filter(file=>file.kind===undefined||file.kind==='source'):[];
   const sameFiles=formalFiles.length===sourceIndex.files.size&&new Set(formalFiles.map(file=>file.path)).size===formalFiles.length&&formalFiles.every(file=>sourceIndex.files.get(file.path)?.sha256===file.sha256&&sourceIndex.files.get(file.path)?.bytes===file.bytes);
   check(sameContent||sameFiles,'CREATION_TARGET_SOURCE_CHANGED_RECAPTURE');known.add(pin(sourceIndex));
  }
  check(typeof sample==='function','CREATION_LIVE_PROVIDER_UNAVAILABLE');
  const live=await timing.measure('live-safety',()=>sample({worldId:bound.worldId,buildId:bound.buildId,instanceId:bound.instanceId}));assertActive(context);
  const age=Date.now()-Date.parse(live?.sampledAt);
  check(live?.worldId===bound.worldId&&live?.buildId===bound.buildId&&live?.instanceId===bound.instanceId&&Number.isFinite(age)&&age>=-5000&&age<=30000,'CREATION_TARGET_STALE');
  // Live source must still be the capture's build; current player position is
  // used for placement safety while the original requested target stays fixed.
  const position=live.player?.position;
  check(Array.isArray(position)&&position.length===3&&position.every(Number.isFinite),'CREATION_PLAYER_UNAVAILABLE');
  const checked=compileCreationOperation({source,targetSnapshot:{...targetSnapshot,playerPosition:position},request});
  // Compiler output is target/source-only; current player position only rejects.
  check(JSON.stringify(checked.operations)===JSON.stringify(result.operations),'CREATION_NONDETERMINISTIC_PATCH');
  let receipt;
  try{assertActive(context);receipt=await timing.measure('source-patch',()=>core.call('godotProject.patch',params));}catch(error){try{receipt=await previous();}catch{}if(!receipt)throw error;}
  known.add(pin(receipt));if(advances.size>=64&&!advances.has(key))advances.delete(advances.keys().next().value);advances.set(key,known);
  return response(receipt,false);
  } catch(error) {
   if(error&&typeof error==='object')error.creationTiming=timing.snapshot();
   throw error;
  }
 };
}
module.exports={createCreationSourceService};
