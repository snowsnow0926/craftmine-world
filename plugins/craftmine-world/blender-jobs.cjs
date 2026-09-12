'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const native=require('./blender-broker.cjs');
const {hash,digest,check,ordinary,readOrdinary}=native;
const FORMAT='craftmine.blender-job/1';
const TERMINAL=new Set(['imported','generated','failed','cancelled','interrupted']);
const ID=/^[a-f0-9-]{36}$/;
const SHA=/^[a-f0-9]{64}$/;
const now=()=>new Date().toISOString();
const bindingEqual=(a,b)=>a.projectId===b.projectId&&a.worldId===b.worldId;
function publicRecord(record) {
  return {format:FORMAT,jobId:record.jobId,worldId:record.worldId,status:record.status,createdAt:record.createdAt,updatedAt:record.updatedAt,
    source:{revision:record.revision,manifestHash:record.manifestHash},modelPath:record.modelPath,
    ...(record.artifacts?{artifacts:record.artifacts,stats:record.stats,sourceJobId:record.jobId}:{}),
    ...(record.imported?{imported:record.imported}:{}),reason:record.reason??null,applied:false,playableVerified:false,
    ...(record.diagnostics?{diagnostics:record.diagnostics}:{}),
    next:record.status==='imported'?'Read the updated Godot project; place the GLB in the scene, implement requested interactions, then build/check and verify actual application.':
      record.status==='generated'?'Output is preserved. Reinspect current source. To retry with current pins, run blender_generate with previousJobId and script="pass".':null};
}
function createBlenderJobs(core,options={}) {
  const root=path.join(options.dataPath,'blender-jobs');
  const tasksRoot=path.join(options.dataPath,'bt');
  const running=new Map(),receipts=new Map(),starting=new Map();let initialized=null,recovered=null,closed=false,capability={available:false,reason:'BLENDER_NOT_CHECKED'};
  const requestHash=args=>hash(JSON.stringify([args.name,args.script,args.revision,args.manifestHash,args.expectedHash,args.previousJobId??null]));
  const invocationKey=(context,toolCallId,storeDirectory)=>hash(JSON.stringify([context.projectId,context.sessionId,context.turnId,toolCallId,storeDirectory]));
  const assertActive=async context=>{check(!closed,'BLENDER_SERVICE_STOPPED');await options.assertActive?.(context);check(!closed,'BLENDER_SERVICE_STOPPED');};
  async function persist(record){record.updatedAt=now();const directory=path.join(root,record.jobId);await ordinary(directory,'directory');const temporary=path.join(directory,'record-'+randomUUID()+'.tmp');await fs.writeFile(temporary,JSON.stringify(record),{flag:'wx'});await fs.rename(temporary,path.join(directory,'record.json'));}
  function init(){return initialized??=(async()=>{
    await fs.mkdir(root,{recursive:true});await fs.mkdir(tasksRoot,{recursive:true});await ordinary(root,'directory');await ordinary(tasksRoot,'directory');
    for(const entry of await fs.readdir(root,{withFileTypes:true}))if(entry.isDirectory()&&ID.test(entry.name)){
      try {const record=JSON.parse(await readOrdinary(path.join(root,entry.name,'record.json'),256*1024));
        if(record.format===FORMAT&&record.jobId===entry.name&&record.context&&record.originToolCallId&&record.requestHash)receipts.set(invocationKey(record.context,record.originToolCallId,record.storeDirectory),{jobId:record.jobId,requestHash:record.requestHash});
        if(record.format===FORMAT&&record.jobId===entry.name&&!TERMINAL.has(record.status)){record.status='interrupted';record.reason='BLENDER_HOST_RESTARTED';await persist(record);}
      }catch{/* Corrupt records never grant ownership or resumable source. */}
    }
  })();}
  async function discover(){return (options.discover??native.discover)(options.toolchain);}
  async function ready(){const found=await discover(),key=JSON.stringify([core.directory??options.dataPath,found.brokerSha256]);
    if(recovered?.key!==key){const promise=(options.recover??native.recover)(found,tasksRoot);recovered={key,promise};}
    try{found.recovery=await recovered.promise;}catch(error){recovered=null;throw error;}return found;}
  async function status(){await init();try{const found=await ready();capability={available:true,state:'ready',reason:null,brokerSha256:found.brokerSha256,recovery:found.recovery,
    execution:'native-isolation-required-per-job',sourceImportFileLimitBytes:4*1024*1024};}catch(error){capability={available:false,state:'unavailable',reason:error.message};}
    return {format:'craftmine.blender-status/1',...capability,tools:['blender_generate','blender_job_read','blender_cancel'],
      guidance:await fs.readFile(path.join(__dirname,'guidance','blender-modeling.md'),'utf8')};}
  async function load(jobId,binding){check(ID.test(jobId),'BLENDER_JOB_ID_INVALID');await init();const record=JSON.parse(await readOrdinary(path.join(root,jobId,'record.json'),256*1024));
    check(record.format===FORMAT&&record.jobId===jobId&&bindingEqual(record,binding)&&record.storeDirectory===path.resolve(core.directory??options.dataPath),'BLENDER_JOB_BINDING_MISMATCH');return record;}
  async function stage(receipt,request,record) {
    const artifactRoot=path.join(tasksRoot,record.nativeTaskId,'artifacts');
    check(path.resolve(receipt.artifactsRoot??'')===artifactRoot,'BLENDER_ARTIFACT_ROOT_MISMATCH');await ordinary(artifactRoot,'directory');
    const expected=['model.glb','report.json','script.py','source.blend'];
    check(Array.isArray(receipt.artifacts)&&receipt.artifacts.length===expected.length&&[...receipt.artifacts.map(item=>item.path)].sort().join('|')===expected.join('|'),'BLENDER_ARTIFACT_LIST_INVALID');
    const destination=path.join(root,record.jobId,'assets');await fs.mkdir(destination);await ordinary(destination,'directory');
    const artifacts=[];
    for(const item of receipt.artifacts){check(Number.isSafeInteger(item.bytes)&&item.bytes>0&&SHA.test(item.sha256),'BLENDER_ARTIFACT_INVALID');
      const bytes=await readOrdinary(path.join(artifactRoot,item.path),item.path==='report.json'?65536:256*1024*1024);
      check(bytes.length===item.bytes&&hash(bytes)===item.sha256,'BLENDER_ARTIFACT_HASH_MISMATCH');
      if(item.path==='script.py')check(item.sha256===record.scriptSha256,'BLENDER_SCRIPT_CHANGED');
      await fs.writeFile(path.join(destination,item.path),bytes,{flag:'wx'});artifacts.push({path:item.path,bytes:item.bytes,sha256:item.sha256});
    }
    const report=JSON.parse(await readOrdinary(path.join(destination,'report.json'),65536));
    const stats={source:'untrusted-model-report'};for(const key of ['meshObjects','vertices','polygons','materials','animations'])if(Number.isSafeInteger(report[key])&&report[key]>=0)stats[key]=report[key];
    record.artifacts=artifacts;record.stats=stats;record.runtimeVersion=receipt.runtimeVersion;record.runtimeInventoryDigest=receipt.runtimeInventoryDigest;
  }
  async function importModel(record,context,signal){
    check(!signal.aborted,'BLENDER_JOB_CANCELLED');await assertActive(context);
    const source=await core.call('godotProject.index',{context,worldId:record.worldId,limit:1});
    check(record.storeDirectory===path.resolve(core.directory??options.dataPath),'BLENDER_STORE_CHANGED');
    check(source.worldId===record.worldId&&source.revision===record.revision&&source.manifestHash===record.manifestHash,'BLENDER_SOURCE_STALE');
    const model=record.artifacts.find(item=>item.path==='model.glb');
    const bytes=await readOrdinary(path.join(root,record.jobId,'assets','model.glb'),256*1024*1024);check(hash(bytes)===model.sha256,'BLENDER_ARTIFACT_HASH_MISMATCH');
    check(bytes.length<=4*1024*1024,'PROJECT_FILE_TOO_LARGE');
    const params={context,worldId:record.worldId,toolCallId:record.importToolCallId,revision:record.revision,manifestHash:record.manifestHash,
      operations:[{op:'putBytes',path:record.modelPath,expectedHash:record.expectedHash,bytesBase64:bytes.toString('base64')}]};
    if(source.content){const {repoId,branchId,contentOid}=source.content;check(typeof repoId==='string'&&branchId==='main'&&/^[a-f0-9]{40,64}$/.test(contentOid),'GODOT_PROJECT_CONTENT_IDENTITY_INVALID');
      params.operation={operationId:'blender-'+record.jobId,worldId:record.worldId,repoId,branchId,expectedHeadOid:contentOid,expectedAppliedOid:null,expectedProgressRevision:null};}
    await assertActive(context);check(!signal.aborted,'BLENDER_JOB_CANCELLED');
    // Persist the exact request identity before crossing the transactional core.
    record.status='importing';await persist(record);
    await assertActive(context);check(!signal.aborted,'BLENDER_JOB_CANCELLED');
    let result;
    try{result=await core.call('godotProject.patch',params,30000);}catch(error){
      if(!error.errorCode){try{result=await core.call('godotProject.receipt',{binding:record.taskBinding,worldId:record.worldId,toolCallId:params.toolCallId,method:'godotProject.patch',request:params});}catch{}}
      if(!result)throw error;
    }
    check(result?.worldId===record.worldId&&Number.isSafeInteger(result.revision)&&SHA.test(result.manifestHash),'BLENDER_IMPORT_RECEIPT_INVALID');
    record.status='imported';record.imported={revision:result.revision,manifestHash:result.manifestHash,modelSha256:model.sha256};record.reason=null;
  }
  async function generateNew(args,{context,worldId,workspace,toolCallId}){
    await init();await assertActive(context);
    check(typeof args.script==='string'&&args.script.trim().length>0&&Buffer.byteLength(args.script)<=160000,'BLENDER_SCRIPT_INVALID');
    check(typeof args.name==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(args.name),'BLENDER_NAME_INVALID');
    check(Number.isSafeInteger(args.revision)&&args.revision>=0&&SHA.test(args.manifestHash)&&(args.expectedHash===null||SHA.test(args.expectedHash)),'BLENDER_SOURCE_IDENTITY_REQUIRED');
    const discovery=await ready();
    const source=await core.call('godotProject.index',{context,worldId,revision:args.revision,manifestHash:args.manifestHash,limit:1});
    check(source.worldId===worldId&&source.revision===args.revision&&source.manifestHash===args.manifestHash,'BLENDER_SOURCE_STALE');
    check(typeof workspace?.task?.binding?.taskId==='string','BLENDER_TASK_BINDING_REQUIRED');
    let previousBytes;
    if(args.previousJobId){const previous=await load(args.previousJobId,{...context,worldId});check(previous.artifacts?.length>0,'BLENDER_SOURCE_UNAVAILABLE');const artifact=previous.artifacts.find(item=>item.path==='source.blend');
      previousBytes=await readOrdinary(path.join(root,previous.jobId,'assets','source.blend'),256*1024*1024);check(hash(previousBytes)===artifact?.sha256,'BLENDER_SOURCE_HASH_MISMATCH');}
    await assertActive(context);
    const jobId=randomUUID(),directory=path.join(root,jobId),input=path.join(directory,'input');await fs.mkdir(input,{recursive:true});await ordinary(input,'directory');
    const script=Buffer.from(args.script);await fs.writeFile(path.join(input,'script.py'),script,{flag:'wx'});
    const files=[{path:'script.py',bytes:script.length,sha256:hash(script)}];
    if(previousBytes){await fs.writeFile(path.join(input,'source.blend'),previousBytes,{flag:'wx'});files.push({path:'source.blend',bytes:previousBytes.length,sha256:hash(previousBytes)});}
    const record={format:FORMAT,jobId,nativeTaskId:'bl-'+jobId.replaceAll('-','').slice(0,20),storeDirectory:path.resolve(core.directory??options.dataPath),projectId:context.projectId,worldId,context,taskBinding:workspace.task.binding,importToolCallId:'blender-'+jobId,
      originToolCallId:toolCallId,requestHash:requestHash(args),revision:args.revision,manifestHash:args.manifestHash,modelPath:'assets/blender/'+args.name+'.glb',expectedHash:args.expectedHash,
      scriptSha256:hash(script),status:'queued',createdAt:now(),previousJobId:args.previousJobId??null};
    const request={schemaVersion:1,requestId:jobId,taskId:record.nativeTaskId,operation:'model',projectRoot:input,tasksRoot,runtimeRoot:discovery.toolchain.runtimeRoot,
      sourceBinding:{worldId,buildId:source.baseBuild??workspace.task.binding.baseBuild,sourceRevision:args.revision,sourceDigest:args.manifestHash},inputHash:digest(files)};
    await persist(record);receipts.set(invocationKey(context,toolCallId,record.storeDirectory),{jobId,requestHash:record.requestHash});await assertActive(context);
    const controller=new AbortController();const entry={record,controller,promise:null};running.set(jobId,entry);
    entry.promise=(async()=>{try{
      record.status='running';await persist(record);const receipt=await (options.runBroker??native.runBroker)(discovery,request,controller.signal);
      check(!controller.signal.aborted,'BLENDER_JOB_CANCELLED');native.validateReceipt(receipt,request,discovery);await stage(receipt,request,record);
      record.status='generated';await persist(record);await importModel(record,context,controller.signal);
    }catch(error){record.reason=/^[A-Z][A-Z0-9_:.-]{0,160}$/.test(error.message)?error.message:'BLENDER_JOB_FAILED';
      try{let log=(await readOrdinary(path.join(tasksRoot,record.nativeTaskId,'logs','task.log'),4*1024*1024)).toString('utf8').slice(-6000);
        for(const [prefix,label]of [[options.dataPath,'<managed>'],[discovery.toolchain.runtimeRoot,'<runtime>']])log=log.replaceAll(prefix,label).replaceAll(prefix.replaceAll('\\','/'),label);
        record.diagnostics={source:'untrusted-script-log',text:log};}catch{/* A missing or linked log supplies no evidence. */}
      record.status=controller.signal.aborted?'cancelled':record.artifacts?'generated':'failed';
    }finally{await persist(record);running.delete(jobId);}})();entry.promise.catch(()=>{});
    return publicRecord({...record,status:'queued'});
  }
  async function generate(args,binding){
    await init();await assertActive(binding.context);
    const key=invocationKey(binding.context,binding.toolCallId,path.resolve(core.directory??options.dataPath));
    if(starting.has(key)){await starting.get(key);}
    const receipt=receipts.get(key);
    if(receipt){check(receipt.requestHash===requestHash(args),'BLENDER_INVOCATION_CHANGED');return publicRecord(await load(receipt.jobId,{...binding.context,worldId:binding.worldId}));}
    const pending=generateNew(args,binding);starting.set(key,pending);
    try{return await pending;}finally{starting.delete(key);}
  }
  async function read({jobId},binding){const active=running.get(jobId);if(active&&bindingEqual(active.record,binding))await Promise.race([active.promise,new Promise(resolve=>{const timer=setTimeout(resolve,1000);timer.unref?.();})]);return publicRecord(await load(jobId,binding));}
  async function cancel({jobId},binding){const record=await load(jobId,binding);const entry=running.get(jobId);
    check(record.context.sessionId===binding.context.sessionId&&record.context.turnId===binding.context.turnId,'BLENDER_CANCEL_SCOPE_MISMATCH');
    if(entry){entry.controller.abort();await entry.promise;}return publicRecord(await load(jobId,binding));}
  async function cancelTurn(context){const entries=[...running.values()].filter(entry=>entry.record.context.sessionId===context.sessionId&&entry.record.context.turnId===context.turnId);for(const entry of entries)entry.controller.abort();await Promise.allSettled(entries.map(entry=>entry.promise));}
  async function stop(){closed=true;for(const entry of running.values())entry.controller.abort();await Promise.allSettled([...starting.values()]);
    const entries=[...running.values()];for(const entry of entries)entry.controller.abort();await Promise.allSettled(entries.map(entry=>entry.promise));recovered=null;initialized=null;}
  async function tool(name,args,binding){const identity={...binding,projectId:binding.context.projectId};
    if(name==='blender_status')return status();if(name==='blender_generate')return generate(args,binding);if(name==='blender_job_read')return read(args,identity);if(name==='blender_cancel')return cancel(args,identity);throw Error('BLENDER_TOOL_UNKNOWN');}
  return {tool,status,cancelTurn,stop,start:async()=>{closed=false;await status();},drain:stop};
}
module.exports={createBlenderJobs};
