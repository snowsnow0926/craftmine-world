const {createHash}=require('node:crypto');
const need=(condition,code)=>{if(!condition)throw Error(code);};
const text=(value,max=240)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
const fields=(value,allowed)=>{need(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_ARGUMENTS');need(Object.keys(value).every(key=>allowed.includes(key)),'UNKNOWN_FIELD');};
const digest=value=>createHash('sha256').update(value).digest('hex');
const contextOf=binding=>Object.fromEntries(['projectId','sessionId','turnId'].map(key=>[key,binding[key]]));
const channels={
  'workbench.capabilities':[], 'task.current':[], 'task.recoverable':[],
  'library.search':['query','kind','offset','limit'], 'library.read':['ref','start','limit'],
  'library.capture':['operationId','kind','resourceId','tags','applicationId'],
  'library.install':['operationId','ref','revision','position'],
  'memory.search':['query','includeInactive','offset','limit'],
  'memory.propose':['operationId','kind','claim','tags','replaceId'], 'memory.retire':['id','reason'],
  'selection.set':['build','objectId','selectionRevision'], 'selection.clear':[],
  'draft.recheck':['operationId','taskId','generation','revision','draftHash'],
};

// Presentation requests carry no authority. The plugin main supplies the real
// viewed session and selected world; Rust remains the durable transaction owner.
function createWorkbenchService(core,{library,memory,verifications,reviews,getSettings}) {
  const selections=new Map(),selectionRequests=new Map();
  const owner=host=>{need(text(host?.projectId)&&(host.sessionId===null||text(host?.sessionId)),'HOST_IDENTITY_REQUIRED');return JSON.stringify([host.projectId,host.sessionId]);};
  async function selected(host,worldId){
    owner(host);const actual=(await getSettings()).activeWorldId;
    need(text(worldId,80)&&worldId===actual&&host.selectedWorld===worldId,'SELECTED_WORLD_MISMATCH');
    return core.call('world.read',{id:worldId});
  }
  async function current(host,worldId){
    if(!host.sessionId)return null;
    const workspace=await core.call('workspace.current',{projectId:host.projectId,sessionId:host.sessionId});
    if(!workspace||workspace.worldId!==worldId)return null;
    return core.call('task.context',{context:contextOf(workspace.task.binding)});
  }
  async function writing(host,worldId){
    need(host.context&&host.context.projectId===host.projectId&&host.context.sessionId===host.sessionId&&text(host.context.turnId),'HOST_ACTION_TURN_REQUIRED');
    const workspace=await core.call('workspace.inspect',{context:contextOf(host.context)});
    need(workspace.worldId===worldId,'WORKSPACE_WORLD_MISMATCH');need(workspace.task.status==='running','TASK_INACTIVE');
    await selected(host,worldId);
    return workspace;
  }
  async function selectionRead(host){
    const key=owner(host),selection=selections.get(key);if(!selection)return null;
    let world;try{world=await selected(host,selection.worldId);}catch(error){selections.delete(key);return null;}
    if(world.world.build.id!==selection.build.id||world.world.build.hash!==selection.build.hash){selections.delete(key);return null;}
    const object=world.world.build.scene.objects.find(object=>object.id===selection.objectId);
    if(!object){selections.delete(key);return null;}
    return {...selection,name:object.name};
  }
  async function validatedContext(context){
    const workspace=await core.call('workspace.inspect',{context:contextOf(context)}),worldId=workspace.worldId;
    // The panel may now display another world. Task memory is still bound to
    // its original Rust workspace; a UI switch cannot invalidate or redirect it.
    const host={...context,selectedWorld:worldId};
    const world=await core.call('world.read',{id:worldId});
    const result=await memory.search({scope:{projectId:context.projectId,worldId},sourceHashes:[workspace.task.draftHash],runtimeVersion:'craftmine-web/5',limit:50});
    const records=result.items.filter(record=>record.status==='validated'&&!record.supersededBy);
    const selection=await selectionRead(host);
    // A selection must still exist in the current draft before becoming context.
    return {worldId,memories:records.map(record=>({id:record.id,kind:record.kind,text:record.claim,status:record.status,worldId})),selection:selection&&workspace.task.draft.scene.objects.some(object=>object.id===selection.objectId)?selection:null,build:{id:world.world.build.id,hash:world.world.build.hash}};
  }
  async function handle(channel,payload={},host={}){
    if(channel==='workbench.prepareAction'){
      fields(payload,['channel','payload']);need(['library.install','memory.propose'].includes(payload.channel),'UNKNOWN_ACTION');
      fields(payload.payload,['worldId',...channels[payload.channel]]);const args=payload.payload;
      await selected(host,args.worldId);need(text(args.operationId),'OPERATION_ID_REQUIRED');
      if(payload.channel==='memory.propose')return core.call('memory.findReceipt',{projectId:host.projectId,sessionId:host.sessionId,worldId:args.worldId,operationId:args.operationId,request:{kind:args.kind,claim:typeof args.claim==='string'?args.claim.trim():args.claim,tags:args.tags??[],supersedes:args.replaceId?[args.replaceId]:[]}});
      const request={operation:'library.install',ref:args.ref,revision:0,...(args.position?{position:args.position}:{})};
      const receipt=await core.call('workspace.findReceipt',{projectId:host.projectId,sessionId:host.sessionId,worldId:args.worldId,toolCallId:args.operationId,request});
      return receipt?{receipt,replayed:true,applied:false,verificationStatus:'query-required'}:null;
    }
    need(Object.hasOwn(channels,channel),'UNKNOWN_WORKBENCH_CHANNEL');fields(payload,['worldId',...channels[channel]]);
    const selectionKey=channel.startsWith('selection.')?owner(host):null;
    const selectionRequest=selectionKey?(selectionRequests.get(selectionKey)||0)+1:null;
    if(selectionKey)selectionRequests.set(selectionKey,selectionRequest);
    const world=await selected(host,payload.worldId),{worldId,...args}=payload;
    if(selectionKey)need(selectionRequests.get(selectionKey)===selectionRequest,'STALE_SELECTION_REQUEST');
    if(channel==='workbench.capabilities')return {channels:Object.keys(channels).filter(name=>!name.startsWith('library.')||library).filter(name=>!name.startsWith('memory.')||memory).filter(name=>!['library.install','draft.recheck'].includes(name)||verifications)};
    if(channel==='task.current')return {context:await current(host,worldId),active:host.active===true};
    if(channel==='draft.recheck'){
      need(!host.active&&host.context&&host.context.projectId===host.projectId&&host.context.sessionId===host.sessionId,'HOST_ACTION_CONTEXT_REQUIRED');
      const context=contextOf(host.context),task=await current(host,worldId);
      need(task&&task.status==='finished'&&task.binding.taskId===args.taskId&&task.generation===args.generation&&task.draft.revision===args.revision&&task.draft.hash===args.draftHash,'STALE_DRAFT');
      need(text(args.operationId),'OPERATION_ID_REQUIRED');
      const first=task.requirements.find(requirement=>requirement.kind==='request');
      let requestText='',start=0;
      if(first)do {
        const source=await core.call('task.readRequirements',{context,requestId:first.id,start,limit:4000});
        requestText+=source.items.map(item=>item.text).join('');
        need(requestText.length<=16000,'REQUIREMENT_TOO_LARGE');
        start=source.next;
      } while(start!==null&&start!==undefined);
      requestText ||= '重新检查当前已保存草稿。';
      const origin=host.origin?.modelKey?{...host.origin,request:{messageId:first?.id||args.operationId,text:requestText}}:null;
      const existing=await core.call('verification.list',{worldId,offset:0,limit:50});
      const queued=existing.find(job=>job.current&&job.taskId===task.binding.taskId&&job.draftHash===args.draftHash&&job.workspaceRevision===args.revision&&['queued','running'].includes(job.status));
      const job=queued||await core.call('verification.retry',{context,toolCallId:args.operationId,revision:args.revision,draftHash:args.draftHash,summary:'重新检查当前已保存草稿',origin});
      verifications.enqueue(job,context);return {verificationId:job.id,status:job.status,revision:args.revision,draftHash:args.draftHash,applied:false};
    }
    if(channel==='task.recoverable'){
      if(!host.sessionId)return {items:[],modelReplay:false};
      const result=await core.call('task.recoverable',{projectId:host.projectId,worldId});
      return {...result,items:result.items.filter(item=>item.binding.sessionId===host.sessionId)};
    }
    if(channel==='library.search')return library.search(args);
    if(channel==='library.read')return library.read(args);
    if(channel==='library.capture'){
      need(!host.active,'MODEL_TASK_ACTIVE');
      const applications=await core.call('application.list',{worldId,limit:50});
      const item=applications.items.find(item=>item.current&&item.status==='applied'&&(!args.applicationId||item.id===args.applicationId));need(item,'CURRENT_APPLIED_SOURCE_REQUIRED');
      const application=await core.call('application.read',{id:item.id});
      need(application.input.worldId===worldId&&application.input.buildId===world.world.build.id,'APPLIED_SOURCE_MISMATCH');
      return library.capture({...args,applicationId:item.id,worldId,scope:{projectId:application.input.binding.projectId,worldId}});
    }
    if(channel==='library.install'){
      need(text(args.operationId),'OPERATION_ID_REQUIRED');const workspace=await writing(host,worldId);
      need(args.revision===undefined||args.revision===(host.previous?.draft?.revision??0),'STALE_DRAFT');
      need(workspace.task.revision===0,'ACTION_DRAFT_NOT_FRESH');
      const result=await library.install(contextOf(host.context),args.operationId,{ref:args.ref,revision:0,...(args.position?{position:args.position}:{})});
      try {
        await verifications.cancelTurn?.(host.context);await reviews?.cancelTurn?.(host.context);
        const job=await core.call('verification.submit',{context:contextOf(host.context),toolCallId:'check-'+digest(args.operationId),revision:result.receipt.revision,summary:'检查已加入草稿的固定版本作品',origin:host.origin||null});
        verifications.enqueue(job,contextOf(host.context));return {...result,verificationId:job.id,applied:false};
      } catch {
        // The committed draft must stay usable even when the check receipt or
        // broker handoff fails. No invented verification evidence is returned.
        return {...result,applied:false,verificationStatus:'retry-required'};
      }
    }
    if(channel==='memory.search'){
      const task=await current(host,worldId);
      return memory.search({...args,scope:{projectId:host.projectId,worldId},...(task?{sourceHashes:[task.draft.hash]}:{}),runtimeVersion:'craftmine-web/5'});
    }
    if(channel==='memory.retire'){need(!host.active,'MODEL_TASK_ACTIVE');return memory.retire({...args,scope:{projectId:host.projectId,worldId}});}
    if(channel==='memory.propose'){
      await writing(host,worldId);need(text(args.operationId),'OPERATION_ID_REQUIRED');need(['project-rule','workflow'].includes(args.kind),'INVALID_MEMORY_KIND');need(typeof args.claim==='string'&&args.claim.trim()&&args.claim.length<=400,'INVALID_MEMORY_CLAIM');
      const id='mem-'+digest(args.operationId),context=contextOf(host.context);
      await core.call('task.recordContext',{context,requestId:id,text:args.claim,kind:args.replaceId?'correction':'request'});
      return memory.propose({context,operationId:args.operationId,record:{id:'rule:r'+digest(args.operationId).slice(0,40),kind:args.kind,claim:args.claim,scope:{projectId:host.projectId,worldId},sourceRefs:['user:'+id],tags:args.tags||[],...(args.replaceId?{supersedes:[args.replaceId]}:{})}});
    }
    if(channel==='selection.clear'){selections.delete(owner(host));return {cleared:true};}
    if(channel==='selection.set'){
      fields(args.build,['id','hash']);need(args.build.id===world.world.build.id&&args.build.hash===world.world.build.hash,'STALE_SELECTION_BUILD');
      need(world.world.build.scene.objects.some(object=>object.id===args.objectId),'SELECTION_OBJECT_NOT_FOUND');need(Number.isSafeInteger(args.selectionRevision)&&args.selectionRevision>0,'INVALID_SELECTION_REVISION');
      const key=owner(host),previous=selections.get(key);
      need(!previous||previous.worldId!==worldId||previous.build.hash!==args.build.hash||args.selectionRevision>previous.selectionRevision,'STALE_SELECTION_REVISION');
      selections.set(key,{worldId,...structuredClone(args)});return {selection:await selectionRead(host)};
    }
    throw Error('UNKNOWN_WORKBENCH_CHANNEL');
  }
  return {handle,validatedContext,selectionRead};
}
module.exports={createWorkbenchService};
