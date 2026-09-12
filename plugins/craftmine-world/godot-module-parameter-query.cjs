'use strict';
const {createHash}=require('node:crypto');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{errorCode:code});};
const check=(ok,code)=>{if(!ok)fail(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const HASH=/^[a-f0-9]{64}$/;
const MODES=['module-parameters','module-parameter-preview'];
function validateModuleParameterQuery(args){
 check(plain(args)&&MODES.includes(args.mode),'INVALID_MODULE_QUERY');
 const preview=args.mode==='module-parameter-preview',keys=preview?['mode','bindingHash','changes']:['mode'];
 check(Object.keys(args).every(k=>keys.includes(k)),'INVALID_MODULE_QUERY');
 if(preview){
  check(typeof args.bindingHash==='string'&&HASH.test(args.bindingHash)&&plain(args.changes)&&Object.keys(args.changes).length>0,'INVALID_MODULE_PREVIEW');
  check(Object.keys(args.changes).every(k=>['model_scale_percent','quarter_turns','solid','label'].includes(k)),'INVALID_MODULE_PARAMETER');
  for(const [key,value]of Object.entries(args.changes)){
   if(key==='model_scale_percent')check(Number.isSafeInteger(value)&&value>=25&&value<=800,'INVALID_MODULE_PARAMETER');
   if(key==='quarter_turns')check(Number.isSafeInteger(value)&&value>=0&&value<=3,'INVALID_MODULE_PARAMETER');
   if(key==='solid')check(typeof value==='boolean','INVALID_MODULE_PARAMETER');
   if(key==='label')check(typeof value==='string'&&Array.from(value).length<=80&&!/[\x00-\x1f\x7f]/.test(value),'INVALID_MODULE_PARAMETER');
  }
 }
 return args;
}

// Query and preview only. Source commits still use the existing ordinary patch
// transaction; neither this loader nor its pure compiler acquires a draft lease.
function createModuleParameterQuery({core,capture,sample,assertActive=()=>{},loadHelper=()=>import('./godot-module-parameters.mjs')}){
 return async({context,args})=>{
  validateModuleParameterQuery(args);assertActive(context);
  check(typeof capture==='function'&&typeof sample==='function','MODULE_CAPTURE_PROVIDER_UNAVAILABLE');
  const task=await core.call('task.context',{context});assertActive(context);
  const worldId=task?.world?.id;check(typeof worldId==='string'&&worldId,'WORLD_BINDING_UNRESOLVED');
  const bound=await capture(context);assertActive(context);
  check(bound?.format==='craftmine.creation-target/1'&&bound.worldId===worldId&&bound.sceneObjectTarget,'MODULE_SCENE_OBJECT_CAPTURE_REQUIRED');
  const version={revision:bound.sourceRevision,manifestHash:bound.manifestHash};
  check(Number.isSafeInteger(version.revision)&&version.revision>=1&&typeof version.manifestHash==='string'&&HASH.test(version.manifestHash),'MODULE_CAPTURE_SOURCE_INVALID');
  const matchesPin=page=>page?.worldId===worldId&&page.revision===version.revision&&page.manifestHash===version.manifestHash;
  const matches=page=>matchesPin(page)&&page.baseId==='creation-sandbox';
  const head=await core.call('godotProject.index',{context,worldId,offset:0,limit:1});assertActive(context);
  check(matches(head),'MODULE_CAPTURE_SOURCE_STALE');
  const total=head.totalFiles;check(Number.isSafeInteger(total)&&total>=0&&total<=512,'MODULE_SOURCE_INDEX_INVALID');
  const manifestFiles=new Map();let offset=0;
  do{
   const page=await core.call('godotProject.index',{context,worldId,...version,offset,limit:32});assertActive(context);
   check(matches(page)&&page.totalFiles===total&&Array.isArray(page.files)&&page.files.length<=32,'MODULE_SOURCE_INDEX_INVALID');
   for(const file of page.files){
    check(typeof file?.path==='string'&&!manifestFiles.has(file.path)&&manifestFiles.size<512&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&typeof file.sha256==='string'&&HASH.test(file.sha256),'MODULE_SOURCE_INDEX_INVALID');
    manifestFiles.set(file.path,{path:file.path,bytes:file.bytes,sha256:file.sha256});
   }
   const next=page.nextOffset;check(manifestFiles.size<=total&&(next==null?manifestFiles.size===total:page.files.length>0&&next===manifestFiles.size&&next>offset&&next<total),'MODULE_SOURCE_INDEX_INVALID');offset=next;
  }while(offset!=null);
  const files=new Map();let loadedBytes=0;
  async function read(relative){
   if(files.has(relative))return;
   const file=manifestFiles.get(relative);check(file,'MODULE_SOURCE_FILE_MISSING');
   check(relative==='project.godot'||/\.(?:gd|tscn|json)$/.test(relative),'MODULE_NON_TEXT_READ_REFUSED');
   check(file.bytes<=180000&&loadedBytes+file.bytes<=1024*1024,'MODULE_SOURCE_TEXT_TOO_LARGE');
   let at=0,text='';
   do{
    const part=await core.call('godotProject.read',{context,worldId,...version,path:relative,offset:at,limit:16000});assertActive(context);
    check(matchesPin(part)&&part.path===relative&&part.sha256===file.sha256&&typeof part.text==='string','MODULE_SOURCE_READ_MISMATCH');
    text+=part.text;check(Buffer.byteLength(text)<=file.bytes,'MODULE_SOURCE_READ_MISMATCH');
    const next=part.nextOffset;check(next==null||Number.isSafeInteger(next)&&next>at&&next<=file.bytes,'MODULE_SOURCE_READ_MISMATCH');at=next;
   }while(at!=null);
   const bytes=Buffer.from(text,'utf8');check(bytes.length===file.bytes&&digest(bytes)===file.sha256,'MODULE_SOURCE_FILE_HASH_MISMATCH');
   files.set(relative,bytes);loadedBytes+=bytes.length;
  }
  await read('project.godot');const helper=await loadHelper();assertActive(context);
  const source={worldId,...version,manifestFiles,files};
  const required=helper.requiredModuleParameterPaths({source,capture:bound});
  check(Array.isArray(required)&&required.length<=24&&required.every(p=>typeof p==='string'),'MODULE_REQUIRED_PATHS_INVALID');
  for(const relative of new Set(required))await read(relative);
  const current=await core.call('godotProject.index',{context,worldId,offset:0,limit:1});assertActive(context);check(matches(current),'MODULE_CAPTURE_SOURCE_STALE');
  const observed=await sample({worldId,buildId:bound.buildId,instanceId:bound.instanceId});assertActive(context);
  const live={...observed,sceneObjectRefs:observed?.creation?.sceneObjectRefs};
  const captured=helper.captureModuleParameters({source,capture:bound,live});
  if(args.mode==='module-parameters')return {...captured,applied:false,runtimeSafety:{status:'not-assessed',autoApply:false,required:'Normal candidate check and physical progress compatibility before application'}};
  check(captured?.binding?.bindingHash===args.bindingHash,'MODULE_PARAMETER_BINDING_CHANGED');
  const result=helper.previewModuleParameters({source,capture:bound,live,binding:captured.binding,changes:args.changes});
  assertActive(context);
  return {...result,applied:false,runtimeSafety:{status:'not-assessed',autoApply:false,required:'Normal candidate check and physical progress compatibility before application'}};
 };
}
module.exports={MODES,validateModuleParameterQuery,createModuleParameterQuery};
