// Private orchestrator operations. No panel channel or model tool exposes this router.
const {fields}=require('./domain.cjs');
const bindingKeys=['projectId','sessionId','turnId','taskId','baseBuild'];
function sameBinding(a,b){return !!a&&!!b&&Object.keys(a).length===bindingKeys.length&&bindingKeys.every(key=>a[key]===b[key]);}
function contextOf(binding){return Object.fromEntries(['projectId','sessionId','turnId'].map(key=>[key,binding[key]]));}
function boundedText(value,max){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>max)throw Error('INVALID_HOST_TEXT');return value;}
function assertIdentity(input,snapshot){
  if(!sameBinding(input.binding,snapshot.binding)||input.generation!==snapshot.generation)throw Error('CRAFTMINE_BUDGET_BINDING_MISMATCH');
}
function createHostRequests(core,{verifications,reviews,getSettings,workbench,godotExecutor,assetService,reuseService,portableRestore}){
  const reservations=new Map();
  // The bounded surface of the S5 asset service and the S3 works/package
  // service. The router forwards a method name, never an arbitrary core call.
  const ASSET_METHODS=new Set(['search','read','versions','usage','annotate','scan','importAsset','previewRead','probe',
    'resolveLegacy','recordUsage','recordCheck','preview','cancel']);
  const PACKAGE_METHODS=new Set(['check','install','list','read','progress','grant','upgrade','uninstall','restore',
    'exportPackage','importPackage','installSource','sourceList','exportSource','usage','backupFull','backupVerify','backupRestoreFull','legacyConvert','explain']);
  const keyOf=(context,id)=>JSON.stringify([context.projectId,context.sessionId,context.turnId,id]);
  async function snapshot(context){
    const value=await core.call('task.context',{context});
    if(!workbench)return value;
    const supplemental=await workbench.validatedContext(context);
    return {...value,memories:supplemental.memories,selection:supplemental.selection};
  }
  async function reviewContext(id){
    const review=await core.call('review.read',{id});
    if(review.status!=='running'||!review.current)throw Error('CURRENT_RUNNING_REVIEW_REQUIRED');
    const job=await core.call('verification.read',{id:review.verificationId});
    if(job.status!=='passed'||!job.current)throw Error('CURRENT_VERIFICATION_REQUIRED');
    const value=await snapshot(contextOf(job.input.binding));
    if(!sameBinding(value.binding,job.input.binding))throw Error('REVIEW_TASK_BINDING_MISMATCH');
    return {...value,review:{id,verificationId:job.id,modelKey:job.input.origin.modelKey,inputHash:review.inputHash}};
  }
  async function budget(method,input,current,context){
    const {binding,generation,...args}=input;
    assertIdentity(input,current);
    const id=args.requestId;
    const key=keyOf(context,id);
    if(method==='budget.reserve'){
      if(args.limits!==undefined)throw Error('CRAFTMINE_HOST_LIMITS_REQUIRED');
      const limits=current.budget.limits;
      const previous=reservations.get(key);
      // Initialize only before the first physical request. An old null policy
      // stays null after consumption; retrying a lost reply keeps its clock.
      const deadlineAt=limits.deadlineAt??(current.budget.requestCount===0?(previous?.request.limits.deadlineAt??Date.now()+30*60*1000):null);
      const request={...args,binding:current.binding,generation:current.generation,limits:{...limits,deadlineAt}};
      if(previous&&JSON.stringify(previous.request)!==JSON.stringify(request))throw Error('CRAFTMINE_RESERVATION_REPLAY_MISMATCH');
      // Record before awaiting the durable call: a lost reply must still allow
      // an exact-owner settlement (Rust rejects a reservation that never existed).
      const entry=previous||{binding:current.binding,generation:current.generation,request};
      reservations.set(key,entry);
      return core.call(method,entry.request);
    }
    return core.call(method,{...args,binding:current.binding,generation:current.generation});
  }
  return async function onHostRequest(method,params={}){
    await core.start();
    if(method==='backup.restorePortableActive'){
      fields(params,['operationId','archivePath','archiveHash','expectedCurrentHash']);
      if(!portableRestore)throw Error('BACKUP_LIFECYCLE_UNAVAILABLE');
      await godotExecutor?.stop();
      try{return await portableRestore.restore(params);}
      finally{await godotExecutor?.start();}
    }
    if(method==='godotRuntime.describe'||method==='godotRuntime.exportSource'){
      fields(params,['worldId']);
      return core.call(method,params,60000);
    }
    if(method==='godotWorld.rebuildPlan'||method==='godotWorld.prepareRebuildSource'||method==='godotWorld.prepareCopyRuntime'){
      fields(params,['worldId']);
      return core.call(method,params,60000);
    }
    if(method==='godotRuntime.describeCandidate'){
      fields(params,['worldId','applicationId','token']);
      return core.call(method,params,60000);
    }
    if(method==='godotRuntime.saveProgress'){
      fields(params,['worldId','buildId','revision','runnerReceipt','snapshot']);
      return core.call(method,params,60000);
    }
    // Managed executor lifecycle. The executor process owns the pinned engine;
    // this router only reports its live state, drives the optional core
    // interfaces, and forwards enqueue/cancel from the trusted host.
    if(method==='godotExecutor.status'){
      fields(params,[]);
      return godotExecutor?.status()??{format:'craftmine.godot-executor-status/1',state:'unavailable',available:false,buildAvailable:false,checkAvailable:false,reason:'GODOT_EXECUTOR_UNAVAILABLE',jobs:[]};
    }
    if(method==='godotExecutor.revoke'){
      fields(params,['executorId']);
      const result=await core.call(method,params,60000);
      if(godotExecutor)await godotExecutor.stop();
      return result;
    }
    if(method==='godotExecutor.enqueue'){
      fields(params,['jobId','worldId','mode'],['kind','status']);
      if(!godotExecutor)throw Error('GODOT_EXECUTOR_UNAVAILABLE');
      return godotExecutor.enqueue(params);
    }
    if(method==='godotExecutor.cancel'){
      fields(params,['jobId']);
      return godotExecutor?.cancel(params.jobId)??{cancelled:false};
    }
    // S5 asset service and S3 works/package service. Only a method name from the
    // service's own bounded surface is forwarded; the service owns its field
    // validation, operation identity and idempotency.
    if(method==='asset.request'){
      fields(params,['method'],['args']);
      if(!assetService)throw Error('ASSET_SERVICE_UNAVAILABLE');
      if(!ASSET_METHODS.has(params.method))throw Error('UNSUPPORTED_ASSET_OPERATION');
      return assetService[params.method](params.args??{});
    }
    if(method==='package.request'){
      fields(params,['method'],['args']);
      if(!reuseService)throw Error('PACKAGE_SERVICE_UNAVAILABLE');
      if(!PACKAGE_METHODS.has(params.method))throw Error('UNSUPPORTED_PACKAGE_OPERATION');
      try { return await reuseService[params.method](params.args??{}); }
      catch(error) {
        if (!error.code && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.message??'')) error.code=error.message;
        if (!error.code) console.warn('Package operation failed:',params.method,String(error.message??error));
        throw error;
      }
    }
    const applicationFields={
      'godotJob.checkDescriptor':['jobId','token','artifacts'],
      'godotApplication.prepare':['id','token','candidateId','worldId','revision','snapshot'],
      'godotApplication.commit':['id','token','evidence'],
      'godotApplication.read':['id'],
      'godotApplication.abort':['id'],
      'world.read':['id'],
    };
    if(Object.hasOwn(applicationFields,method)){
      fields(params,applicationFields[method]);
      return core.call(method,params,60000);
    }
    // Godot world, project, job, history, asset and storage routes. Each entry
    // is [required, optional]; the router forwards nothing that is not listed,
    // and only the trusted host orchestrator can reach this table - no panel
    // channel and no model tool exposes it. Routes that the core does not
    // implement are deliberately absent rather than opened as generic RPC.
    const godotRoutes={
      'godotWorld.initialize':[['worldId','title','baseId','baseBuild','snapshot'],[]],
      'godotWorld.initStatus':[['worldId'],[]],
      'godotWorld.copyStatus':[['worldId'],['sourceWorldId']],
      'content.branch.create':[['worldId','branchId','fromRev'],['requestId','taskId','title']],
      'content.migrate.plan':[['worldId'],[]],
      'content.migrate.apply':[['worldId'],[]],
      'content.migrate.verify':[['worldId'],[]],
      'godotWorld.copy':[['sourceWorldId','targetWorldId','title','progress'],['snapshot','context']],
      'godotWorld.backupSnapshot':[['worldId'],['context']],
      'godotWorld.verifySnapshot':[['worldId','snapshot'],['context']],
      'godotProject.create':[['context','worldId','toolCallId','baseBuild','baseId','files'],[]],
      'godotProject.applyFiles':[['context','worldId','toolCallId','revision','manifestHash','files'],['operation']],
      'godotProject.index':[['context','worldId'],['revision','manifestHash','offset','limit','branchId']],
      'godotProject.read':[['context','worldId','revision','manifestHash','path'],['offset','limit','branchId']],
      'godotProject.patch':[['context','worldId','toolCallId','revision','manifestHash','operations'],['operation']],
      'godotProject.receipt':[['binding','worldId','toolCallId','method','request'],[]],
      'godotBuild.start':[['context','worldId','toolCallId','revision','manifestHash','mode'],['branchId']],
      'godotBuild.read':[['worldId','jobId'],['context']],
      'godotBuild.cancel':[['worldId','jobId'],['context']],
      'godotBuild.receipt':[['binding','worldId','toolCallId','method','request'],[]],
      'godotJob.continue':[['jobId','token'],[]],
      'godotJob.usage':[['worldId'],['context']],
      'godotCandidate.list':[['worldId'],['offset','limit']],
      'godotCandidate.read':[['worldId','candidateId'],[]],
      'godotStorage.status':[['worldId'],['context']],
      'godotStorage.reclaimPlan':[['worldId'],['context','protectedBuilds','keepRecentBuilds']],
      'godotStorage.reclaimCommit':[['worldId','planId','planHash'],['context','protectedBuilds','keepRecentBuilds']],
      'godotAsset.put':[['context','worldId','toolCallId','name','mediaType','sha256','bytesBase64'],[]],
      'godotAsset.list':[['context','worldId'],['offset','limit']],
      'content.status':[['worldId'],[]],
      'content.gitInfo':[['worldId'],[]],
      'content.history':[['worldId'],['rev','skip','limit']],
      'content.changes':[['worldId','from','to'],[]],
      'content.diff':[['worldId','from','to','path'],[]],
      'content.readFile':[['worldId','rev','path'],['encoding']],
      'content.branch.list':[['worldId'],[]],
      'content.version.list':[['worldId'],[]],
      'content.checkpoint.set':[['worldId','taskId','sequence','rev'],[]],
      'content.checkpoint.list':[['worldId','taskId'],[]],
      'content.apply.prepare':[['worldId','context','kind','targetOid','detail'],[]],
      'content.apply.advance':[['operationId'],[]],
      'content.apply.confirm':[['operationId','applicationId','detail'],[]],
      'content.apply.rollback':[['operationId','reason'],[]],
      'content.apply.recover':[['worldId'],[]],
      'content.operation.read':[['worldId','operationId'],[]],
      'content.reclaim.plan':[['worldId'],['keep']],
      'content.reclaim.prune':[['worldId'],['keep']],
      'content.verify':[['worldId'],['refs']],
      'content.bundle':[['worldId','target'],['refs']],
      'library.search':[[],['query','kind','tags','scope','offset','limit']],
      'library.read':[['ref'],[]],
      'library.capture':[['operationId','applicationId','worldId','kind','resourceId','bundle','scope','tags'],[]],
      'world.list':[[],[]],
      'workspace.endTurn':[['sessionId','turnId','status'],[]],
      'asset.bodyPath':[['assetId','version','path'],[]],
      'world.create':[['id','title','world'],[]],
      'world.saveProgress':[['id','revision','baseBuild','snapshot'],[]],
      'backup.exportPortable':[['operationId','archivePath'],[]],
      'backup.inspectPortable':[['archivePath'],[]],
      'backup.verifyPortable':[['archivePath'],[]],
      'backup.restorePortable':[['operationId','archivePath','targetDirectory'],[]],
      'backup.cancelPortable':[['operationId'],[]],
      'backup.protectedRefs':[['worldId'],[]],
      'backup.releasePortable':[['archiveId'],[]],
    };
    if(Object.hasOwn(godotRoutes,method)){
      const [required,optional]=godotRoutes[method];
      fields(params,required,optional);
      const result=await core.call(method,params,method.startsWith('backup.')?120000:60000);
      // The existing authorized build route performs the same dispatch as the
      // model tool. No additional renderer or generic executor route is opened.
      if(method==='godotBuild.start'&&result?.executionAvailable!==false&&godotExecutor){
        const execution=await godotExecutor.enqueue(result,params.context);
        return {...result,execution};
      }
      if(method==='godotBuild.cancel'&&godotExecutor){
        const execution=await godotExecutor.cancel(params.jobId);
        return {...result,execution};
      }
      return result;
    }
    if(method==='budget.configure'||method==='budget.findReceipt'){
      fields(params,['projectId','sessionId','worldId','taskId','generation','operationId','maxTokens']);
      return core.call(method,params);
    }
    if(method==='task.interrupt'){
      fields(params,['context','reason']);
      const result=await core.call(method,params);
      await verifications?.cancelTurn(params.context);await reviews?.cancelTurn(params.context);
      await godotExecutor?.cancelTurn(params.context);
      return result;
    }
    if(method==='workbench.request'){
      fields(params,['channel','payload','host']);
      if(!workbench)throw Error('WORKBENCH_UNAVAILABLE');
      return workbench.handle(params.channel,params.payload,params.host);
    }
    if(['backup.export','backup.inspect','backup.restore','backup.status','backup.cancel'].includes(method))return core.call(method,params,60000);
    if(method==='task.resume'||method==='task.discard'){
      fields(params,method==='task.resume'?['context','worldId','taskId','generation']:['projectId','sessionId','worldId','taskId','generation']);
      const context=params.context||params;
      const candidates=await core.call('task.recoverable',{projectId:context.projectId,worldId:params.worldId});
      if(!candidates.items.some(row=>row.taskId===params.taskId&&row.generation===params.generation&&row.binding.sessionId===context.sessionId))throw Error('STALE_RECOVERY_SELECTION');
      if(method==='task.resume')return core.call(method,{context:params.context,taskId:params.taskId,generation:params.generation});
      return core.call(method,{projectId:params.projectId,taskId:params.taskId,generation:params.generation});
    }
    if(method==='selection.read'){fields(params,[]);return {worldId:(await getSettings()).activeWorldId||null};}
    if(method==='maintenance.context'){
      fields(params,['projectId','sessionId']);
      const workspace=await core.call('workspace.current',params);
      if(!workspace)return null;
      const current=await snapshot(contextOf(workspace.task.binding));
      if(current.status!=='finished'||current.lease?.owned)throw Error('CRAFTMINE_FINISHED_TASK_REQUIRED');
      return current;
    }
    if(method==='turn.begin'){
      fields(params,['context','selectedWorld','request']);
      fields(params.request,['id','text'],['kind']);
      const workspace=await core.call('workspace.open',{context:params.context,selectedWorld:params.selectedWorld});
      await verifications?.cancelOtherTurns(params.context);await reviews?.cancelOtherTurns(params.context);
      await core.call('task.recordContext',{context:params.context,requestId:boundedText(params.request.id,240),text:boundedText(params.request.text,16000),kind:params.request.kind||'request'});
      const result=await snapshot(params.context);
      if(result.world.id!==workspace.worldId)throw Error('CRAFTMINE_WORLD_BINDING_MISMATCH');
      return result;
    }
    if(method==='task.context'){
      fields(params,['context'],['request']);
      const before=await snapshot(params.context);
      if(params.request){
        fields(params.request,['id','text']);
        const known=before.requirements.find(item=>item.id===params.request.id);
        // Context contains a bounded projection. Compare the full request in
        // Rust's durable journal, never against a potentially truncated view.
        await core.call('task.recordContext',{context:params.context,requestId:boundedText(params.request.id,240),text:boundedText(params.request.text,16000),kind:known?.kind||'correction'});
      }
      return params.request? snapshot(params.context):before;
    }
    if(method==='review.context'){fields(params,['reviewId']);return reviewContext(params.reviewId);}
    const review=method.startsWith('review.');
    const operation=review?method.replace('review.','budget.'):method;
    if(!['budget.reserve','budget.settle','budget.boundary'].includes(operation))throw Error('UNSUPPORTED_HOST_OPERATION');
    const allowed=operation==='budget.reserve'?['requestId','purpose','estimatedInputTokens','maxOutputTokens']:operation==='budget.settle'?['requestId','status','usage','errorCode']:['eventId','kind'];
    fields(params,review?['reviewId','binding','generation']:['context','binding','generation'],allowed);
    const {context:claimedContext,reviewId,...input}=params;
    let context=claimedContext,current;
    if(operation==='budget.settle'){
      // Settlement is accounting, not a new request or permission to resume.
      // The exact owner remains valid after cancellation or a newer turn.
      context=review?contextOf(input.binding):claimedContext;
      const reserved=reservations.get(keyOf(context,input.requestId));
      if(!reserved||(review&&reserved.reviewId!==reviewId))throw Error('CRAFTMINE_RESERVATION_NOT_FOUND');
      current=reserved;
    }else{
      current=review?await reviewContext(reviewId):await snapshot(context);
      context=contextOf(current.binding);
      if(review&&input.purpose!=='review')throw Error('CRAFTMINE_REVIEW_PURPOSE_REQUIRED');
    }
    const result=await budget(operation,input,current,context);
    if(review&&operation==='budget.reserve')reservations.get(keyOf(context,input.requestId)).reviewId=reviewId;
    return result;
  };
}
module.exports={createHostRequests,sameBinding};
