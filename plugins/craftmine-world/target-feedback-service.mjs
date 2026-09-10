// Private host-owned parameter authoring. Uses the existing source transaction
// and executor; never applies candidates or edits formal progress.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseScene} from '../../desktop/godot/shared/scene_materializer.mjs';
import {describeTargetFeedback,patchTargetFeedback} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const check=(condition,code)=>{if(!condition)fail(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,allowed)=>check(object(value)&&Object.keys(value).every(key=>allowed.includes(key)),'TARGET_FEEDBACK_INVALID_ARGUMENT');
const id=value=>check(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value),'TARGET_FEEDBACK_INVALID_ID');
const terminal=job=>['passed','failed','cancelled','interrupted'].includes(job?.status);
const maxIntentBytes=8*1024*1024;
const regular=info=>check(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size<=maxIntentBytes,'TARGET_FEEDBACK_INTENT_FILE_REFUSED');
async function noLinks(directory){let current=path.resolve(directory);while(true){const info=await fs.lstat(current);check(!info.isSymbolicLink(),'TARGET_FEEDBACK_LINK_REFUSED');const next=path.dirname(current);if(next===current)return;current=next;}}

export function createTargetFeedbackService({call,selected,begin,enqueue,turns,stagingRoot}){
 for(const value of [call,selected,begin,enqueue])check(typeof value==='function','TARGET_FEEDBACK_HOST_REQUIRED');
 check(turns&&typeof turns.finish==='function'&&typeof turns.watch==='function'&&typeof turns.readJob==='function'&&path.isAbsolute(stagingRoot),'TARGET_FEEDBACK_HOST_REQUIRED');
 const active=new Map();
 const selection=async worldId=>{id(worldId);check(await selected()===worldId,'GODOT_WORLD_CHANGED');};
 async function formal(worldId){
  await selection(worldId);
  const record=await call('world.read',{id:worldId});
  check(record.id===worldId&&record.runtimeKind==='godot','GODOT_WORLD_REQUIRED');
  const status=await call('content.status',{worldId});
  check(status.backend==='git'&&typeof status.headOid==='string'&&status.headOid===status.appliedOid,'TARGET_FEEDBACK_UNAPPLIED_DRAFT');
  const source=await call('godotRuntime.exportSource',{worldId});
  check(source.worldId===worldId&&source.baseId==='first-person'&&source.baseVersion==='0.1.0'&&source.buildId===record.world.build.id
   &&source.repoId===status.repoId&&source.contentOid===status.appliedOid,'TARGET_FEEDBACK_FORMAL_SOURCE_REQUIRED');
  return {record,status,source};
 }
 async function read(worldId,context=null){
  const initial=await formal(worldId);
  context??=(await call('godotProject.sourceContext',{worldId})).context;
  check(object(context),'TARGET_FEEDBACK_CONTEXT_REQUIRED');
  const files=new Map();let offset=0,index,total=0;
  do{
   const page=await call('godotProject.index',{context,worldId,branchId:'main',offset,limit:32,...(index?{revision:index.revision,manifestHash:index.manifestHash}:{})});
   index??=page;check(page.worldId===worldId&&page.branchId==='main'&&page.revision===index.revision&&page.manifestHash===index.manifestHash,'TARGET_FEEDBACK_SOURCE_CHANGED');
   for(const file of page.files){
    check(!files.has(file.path),'TARGET_FEEDBACK_SOURCE_CHANGED');let next=0;const chunks=[];
    do{const part=await call('godotProject.read',{context,worldId,branchId:'main',revision:index.revision,manifestHash:index.manifestHash,path:file.path,offset:next,limit:16000});
     check(part.sha256===file.sha256,'TARGET_FEEDBACK_SOURCE_CHANGED');chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text,'utf8'));const prior=next;next=part.nextOffset;check(next==null||(Number.isSafeInteger(next)&&next>prior),'TARGET_FEEDBACK_SOURCE_CHANGED');
    }while(next!=null);
    const bytes=Buffer.concat(chunks);total+=bytes.length;check(total<=64*1024*1024&&bytes.length===file.bytes&&hash(bytes)===file.sha256,'TARGET_FEEDBACK_SOURCE_CHANGED');files.set(file.path,bytes);
   }
   const prior=offset;offset=page.nextOffset;check(offset==null||(Number.isSafeInteger(offset)&&offset>prior),'TARGET_FEEDBACK_SOURCE_CHANGED');
  }while(offset!=null);
  const final=await formal(worldId);check(initial.status.headOid===final.status.headOid&&initial.source.buildId===final.source.buildId,'TARGET_FEEDBACK_SOURCE_CHANGED');
  const entries=final.source.files.filter(file=>file.kind===undefined||file.kind==='source');
  check(entries.length===files.size&&entries.every(file=>files.has(file.path)&&hash(files.get(file.path))===file.sha256),'TARGET_FEEDBACK_FORMAL_SOURCE_REQUIRED');
  const project=files.get('project.godot')?.toString('utf8')??'';
  const scenes=[...project.matchAll(/^run\/main_scene\s*=\s*"res:\/\/([^"\r\n]+)"\s*$/gm)];
  check(scenes.length===1&&files.has(scenes[0][1]),'TARGET_FEEDBACK_MAIN_SCENE_REQUIRED');
  const scenePath=scenes[0][1],sceneText=files.get(scenePath).toString('utf8');
  return {...final,context,index,files,scenePath,sceneText};
 }
 const binding=(source,target)=>({format:'craftmine.target-feedback-source/1',worldId:source.record.id,buildId:source.source.buildId,
  contentOid:source.status.headOid,revision:source.index.revision,manifestHash:source.index.manifestHash,targetId:target.binding.targetId,targetHash:hash(JSON.stringify(target.binding))});
 async function describe(args){
  fields(args,['worldId']);const source=await read(args.worldId);const targets=[],unsupported=[];
  for(const node of parseScene(source.sceneText).nodes){
   if(node.properties.target_id===undefined)continue;
   const match=/^&?"([A-Za-z0-9][A-Za-z0-9._-]{0,127})"$/.exec(node.properties.target_id);
   if(!match){unsupported.push({nodeName:node.name,reason:'TARGET_CONFIGURATION_EXPLICIT_ID_REQUIRED'});continue;}
   try{const target=describeTargetFeedback({...pickSource(source),targetId:match[1]});targets.push({targetId:match[1],label:node.name,configuration:target.configuration,binding:binding(source,target),values:target.values});}
   catch(error){unsupported.push({targetId:match[1],nodeName:node.name,reason:error.code??String(error)});}
  }
  await selection(args.worldId);return {worldId:args.worldId,buildId:source.source.buildId,targets,unsupported,scope:'instance'};
 }
 function pickSource(source){return {sceneText:source.sceneText,scenePath:source.scenePath,files:source.files};}
 const keyFor=(worldId,operationId)=>hash(JSON.stringify([worldId,operationId]));
 async function intentPath(worldId,operationId){id(worldId);id(operationId);await fs.mkdir(stagingRoot,{recursive:true});await noLinks(stagingRoot);return path.join(stagingRoot,keyFor(worldId,operationId)+'.json');}
 function validateIntent(intent){
  fields(intent,['format','requestHash','worldId','operationId','targetId','context','applyRequest','taskBinding','receipt','buildRequest','job','result','checkRequirements']);
  check(intent.format==='craftmine.target-feedback-operation/1'&&/^[a-f0-9]{64}$/.test(intent.requestHash),'TARGET_FEEDBACK_INTENT_INVALID');id(intent.worldId);id(intent.operationId);
  if(intent.result){fields(intent.result,['status','worldId','operationId','applied','draftRetained']);check(intent.result.status==='unchanged'&&intent.result.worldId===intent.worldId&&intent.result.operationId===intent.operationId&&intent.result.applied===false&&intent.result.draftRetained===false,'TARGET_FEEDBACK_INTENT_INVALID');return;}
  id(intent.targetId);check(object(intent.context)&&object(intent.applyRequest)&&intent.applyRequest.worldId===intent.worldId&&isDeepStrictEqual(intent.applyRequest.context,intent.context)&&intent.applyRequest.operation?.operationId===intent.operationId&&intent.applyRequest.operation?.worldId===intent.worldId,'TARGET_FEEDBACK_INTENT_INVALID');
  if(intent.checkRequirements!==undefined){
   fields(intent.checkRequirements,['format','targetFeedback']);fields(intent.checkRequirements.targetFeedback,['targetId','hitFlashMilliseconds']);
   const required=intent.checkRequirements.targetFeedback;
   check(intent.checkRequirements.format==='craftmine.godot-check-requirements/1'&&required.targetId===intent.targetId&&Number.isInteger(required.hitFlashMilliseconds)&&required.hitFlashMilliseconds>=1&&required.hitFlashMilliseconds<=1000,'TARGET_FEEDBACK_INTENT_INVALID');
  }
  if(intent.buildRequest)check(intent.buildRequest.worldId===intent.worldId&&intent.buildRequest.mode==='check'&&isDeepStrictEqual(intent.buildRequest.context,intent.context),'TARGET_FEEDBACK_INTENT_INVALID');
  if(intent.buildRequest)check(isDeepStrictEqual(intent.buildRequest.checkRequirements,intent.checkRequirements),'TARGET_FEEDBACK_INTENT_INVALID');
  if(intent.job)check(typeof intent.job.jobId==='string','TARGET_FEEDBACK_INTENT_INVALID');
 }
 async function load(file){let fd;try{
  await noLinks(file);const before=await fs.lstat(file);regular(before);fd=await fs.open(file,'r');const opened=await fd.stat();regular(opened);check(before.dev===opened.dev&&before.ino===opened.ino,'TARGET_FEEDBACK_INTENT_FILE_REFUSED');
  const buffer=Buffer.alloc(maxIntentBytes+1);let offset=0;
  while(offset<buffer.length){const part=await fd.read(buffer,offset,buffer.length-offset,offset);if(!part.bytesRead)break;offset+=part.bytesRead;}
  check(offset<=maxIntentBytes,'TARGET_FEEDBACK_INTENT_FILE_REFUSED');const intent=JSON.parse(buffer.subarray(0,offset).toString('utf8'));validateIntent(intent);return intent;
 }catch(error){if(error.code==='ENOENT')return null;throw error;}finally{await fd?.close();}}
 async function store(file,intent){
  validateIntent(intent);const bytes=Buffer.from(JSON.stringify(intent));check(bytes.length<=maxIntentBytes,'TARGET_FEEDBACK_INTENT_FILE_REFUSED');await noLinks(path.dirname(file));
  try{regular(await fs.lstat(file));}catch(error){if(error.code!=='ENOENT')throw error;}
  const temp=file+'.'+randomUUID()+'.new',fd=await fs.open(temp,'wx',0o600);let moved=false;
  try{await fd.writeFile(bytes);await fd.sync();await fd.close();await fs.rename(temp,file);moved=true;}finally{await fd.close().catch(()=>{});if(!moved)await fs.unlink(temp).catch(()=>{});}
 }
 const response=intent=>({worldId:intent.worldId,operationId:intent.operationId,targetId:intent.targetId,
  status:intent.job?.status==='blocked'?'source-saved-check-blocked':terminal(intent.job)?intent.job.status:'check-queued',
  applied:false,draftRetained:true,source:intent.receipt?{revision:intent.receipt.revision,manifestHash:intent.receipt.manifestHash}:null,
  job:intent.job?{jobId:intent.job.jobId,status:intent.job.status,buildId:intent.job.buildId,candidateId:intent.job.candidateId??null}:null});
 const receipt=async(intent,method,request)=>call(method==='godotBuild.start'?'godotBuild.receipt':'godotProject.receipt',
  {binding:intent.taskBinding,worldId:intent.worldId,toolCallId:request.toolCallId,method,request});
 const interrupted=intent=>({status:'interrupted',worldId:intent.worldId,operationId:intent.operationId,applied:false,
  draftRetained:!!intent.receipt,source:intent.receipt?{revision:intent.receipt.revision,manifestHash:intent.receipt.manifestHash}:null,
  retrySameOperation:!intent.taskBinding,reason:intent.taskBinding?'TARGET_FEEDBACK_CHECK_REQUIRES_DRAFT_RECOVERY':'TARGET_FEEDBACK_TURN_NOT_STARTED'});
 async function recoverReceipts(intent){
  if(!intent.taskBinding)return;
  intent.receipt??=await receipt(intent,'godotProject.applyFiles',intent.applyRequest);
  if(intent.buildRequest)intent.job??=await receipt(intent,'godotBuild.start',intent.buildRequest);
 }
 async function submit(args){
  fields(args,['worldId','operationId','targetId','binding','values']);id(args.worldId);id(args.operationId);id(args.targetId);
  await selection(args.worldId);const key=keyFor(args.worldId,args.operationId),requestHash=hash(JSON.stringify(args));
  const existing=active.get(key);if(existing){check(existing.requestHash===requestHash,'REPLAY_MISMATCH');return existing.promise;}
  const entry={requestHash};active.set(key,entry);
  entry.promise=(async()=>{
   const file=await intentPath(args.worldId,args.operationId);let intent=await load(file),owned=false,handedOff=false;
   const resumedBeforeTurn=!!intent&&!intent.taskBinding&&!intent.result;
   if(intent)check(intent.requestHash===requestHash&&intent.worldId===args.worldId&&intent.operationId===args.operationId,'REPLAY_MISMATCH');
   const requirements={format:'craftmine.godot-check-requirements/1',targetFeedback:{targetId:args.targetId,hitFlashMilliseconds:args.values?.hitFlashMilliseconds}};
   if(intent?.checkRequirements)check(isDeepStrictEqual(intent.checkRequirements,requirements),'TARGET_FEEDBACK_INTENT_INVALID');
   try{
    if(intent?.result)return intent.result;
    if(intent?.taskBinding){
     await recoverReceipts(intent);
     await store(file,intent);
     // Startup ends abandoned turns. An incomplete source-only operation is
     // recoverable as a retained draft, not by reviving its ended task lease.
     if(!intent.job)return interrupted(intent);
    }
    if(!intent){
     let source=await read(args.worldId);let target=describeTargetFeedback({...pickSource(source),targetId:args.targetId});
     check(isDeepStrictEqual(args.binding,binding(source,target)),'TARGET_FEEDBACK_STALE_BINDING');
     const patch=patchTargetFeedback({...pickSource(source),targetId:args.targetId,binding:target.binding,values:args.values});
     if(!patch.changed){
      const result={status:'unchanged',worldId:args.worldId,operationId:args.operationId,applied:false,draftRetained:false};
      await store(file,{format:'craftmine.target-feedback-operation/1',requestHash,worldId:args.worldId,operationId:args.operationId,result});return result;
     }
     const context={projectId:'craftmine-target-feedback',sessionId:'feedback-'+key.slice(0,40),turnId:args.operationId};
     intent={format:'craftmine.target-feedback-operation/1',requestHash,worldId:args.worldId,operationId:args.operationId,targetId:args.targetId,context,
      checkRequirements:requirements};
     // Persist the exact source operation before beginning a lease or writing.
     intent.applyRequest={context,worldId:args.worldId,toolCallId:'feedback-'+key.slice(0,40),revision:source.index.revision,manifestHash:source.index.manifestHash,
      operation:{operationId:args.operationId,worldId:args.worldId,repoId:source.status.repoId,branchId:'main',expectedHeadOid:source.status.headOid,expectedAppliedOid:source.status.appliedOid,expectedProgressRevision:source.record.revision},
      files:[{path:source.scenePath,bytesBase64:Buffer.from(patch.text).toString('base64'),expectedHash:patch.previousHash}]};
     await store(file,intent);
    }
    if(intent.job){
     intent.job=await turns.readJob({worldId:intent.worldId,jobId:intent.job.jobId});await store(file,intent);
     if(!terminal(intent.job)&&intent.job.status!=='blocked'){turns.watch({...intent.job,worldId:intent.worldId},intent.context);handedOff=true;await enqueue(intent.job,intent.context);}
     return response(intent);
    }
    if(resumedBeforeTurn){
     const source=await read(args.worldId),target=describeTargetFeedback({...pickSource(source),targetId:args.targetId});
     check(isDeepStrictEqual(args.binding,binding(source,target)),'TARGET_FEEDBACK_STALE_BINDING');
     const patch=patchTargetFeedback({...pickSource(source),targetId:args.targetId,binding:target.binding,values:args.values});
     const expected={context:{projectId:'craftmine-target-feedback',sessionId:'feedback-'+key.slice(0,40),turnId:args.operationId},worldId:args.worldId,toolCallId:'feedback-'+key.slice(0,40),revision:source.index.revision,manifestHash:source.index.manifestHash,
      operation:{operationId:args.operationId,worldId:args.worldId,repoId:source.status.repoId,branchId:'main',expectedHeadOid:source.status.headOid,expectedAppliedOid:source.status.appliedOid,expectedProgressRevision:source.record.revision},
      files:[{path:source.scenePath,bytesBase64:Buffer.from(patch.text).toString('base64'),expectedHash:patch.previousHash}]};
     check(isDeepStrictEqual(intent.applyRequest,expected),'TARGET_FEEDBACK_INTENT_INVALID');
     intent.checkRequirements=requirements;await store(file,intent);
    }
    owned=true;
    const begun=await begin({context:intent.context,selectedWorld:intent.worldId,request:{id:intent.operationId,text:'Adjust this target instance hit feedback and check the candidate; do not apply it.'}});
    check(object(begun.binding),'TARGET_FEEDBACK_CONTEXT_REQUIRED');intent.taskBinding=begun.binding;await store(file,intent);
    await selection(intent.worldId);
    if(!intent.receipt){
     // CAS is enforced by the existing core transaction. Replay of an already
     // committed request returns its receipt without applying the edit again.
     try{intent.receipt=await call('godotProject.applyFiles',intent.applyRequest);}catch(error){intent.receipt=await receipt(intent,'godotProject.applyFiles',intent.applyRequest);if(!intent.receipt)throw error;}
     await store(file,intent);
    }
    intent.buildRequest={context:intent.context,worldId:intent.worldId,branchId:'main',toolCallId:intent.applyRequest.toolCallId+'-check',revision:intent.receipt.revision,manifestHash:intent.receipt.manifestHash,mode:'check',...(intent.checkRequirements?{checkRequirements:intent.checkRequirements}:{})};await store(file,intent);
    try{intent.job=await call('godotBuild.start',intent.buildRequest);}catch(error){intent.job=await receipt(intent,'godotBuild.start',intent.buildRequest);if(!intent.job)throw error;}
    await store(file,intent);
    if(intent.job.status!=='blocked'){turns.watch({...intent.job,worldId:intent.worldId},intent.context);handedOff=true;await enqueue(intent.job,intent.context);}
    return response(intent);
   }finally{if(owned&&!handedOff)await turns.finish(intent.context,'error');}
  })().finally(()=>{if(active.get(key)===entry)active.delete(key);});return entry.promise;
 }
 async function status(args){fields(args,['worldId','operationId']);await selection(args.worldId);id(args.operationId);
  await active.get(keyFor(args.worldId,args.operationId))?.promise.catch(()=>{});
  const file=await intentPath(args.worldId,args.operationId),intent=await load(file);check(intent&&intent.worldId===args.worldId&&intent.operationId===args.operationId,'TARGET_FEEDBACK_OPERATION_NOT_FOUND');
  if(intent.result)return intent.result;
  await recoverReceipts(intent);await store(file,intent);
  if(!intent.job)return interrupted(intent);
  intent.job=await turns.readJob({worldId:args.worldId,jobId:intent.job.jobId});return response(intent);
 }
 return {describe,submit,status,drain:()=>Promise.allSettled([...active.values()].map(entry=>entry.promise))};
}
