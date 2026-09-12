// Private orchestrator operations. No panel channel or model tool exposes this router.
const {fields}=require('./domain.cjs');
const bindingKeys=['projectId','sessionId','turnId','taskId','baseBuild'];
function sameBinding(a,b){return !!a&&!!b&&Object.keys(a).length===bindingKeys.length&&bindingKeys.every(key=>a[key]===b[key]);}
function contextOf(binding){return Object.fromEntries(['projectId','sessionId','turnId'].map(key=>[key,binding[key]]));}
function boundedText(value,max){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>max)throw Error('INVALID_HOST_TEXT');return value;}
function assertIdentity(input,snapshot){
  if(!sameBinding(input.binding,snapshot.binding)||input.generation!==snapshot.generation)throw Error('CRAFTMINE_BUDGET_BINDING_MISMATCH');
}
function createHostRequests(core,{verifications,reviews,getSettings,workbench,godotExecutor,assetService,reuseService,portableRestore,packageTurns,targetFeedback}){
  const reservations=new Map();
  const unlimitedRequests=process.env.CRAFTMINE_P8_UNLIMITED_REQUESTS==='1';
  // The bounded surface of the S5 asset service and the S3 works/package
  // service. The router forwards a method name, never an arbitrary core call.
  const ASSET_METHODS=new Set(['search','read','versions','usage','annotate','scan','importAsset','previewRead','probe',
    'resolveLegacy','recordUsage','recordCheck','preview','cancel']);
  const PACKAGE_METHODS=new Set(['check','install','list','read','progress','grant','upgrade','uninstall','restore',
    'exportPackage','importPackage','installSource','sourceList','exportSource','sourceProposals','installSourceProposal','usage','backupFull','backupVerify','backupRestoreFull','legacyConvert','explain']);
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
      const limits=unlimitedRequests&&current.budget.requestCount===0
        ?{...current.budget.limits,maxRequests:null,maxTokens:null}:current.budget.limits;
      // Limits are host-owned. The sidecar may only echo the exact authorized
      // policy, never choose values or widen an already admitted task.
      if(args.limits!==undefined){
        const proposed=args.limits;
        if(!unlimitedRequests||!proposed||typeof proposed!=='object'||Array.isArray(proposed)||
          Object.keys(proposed).sort().join(',')!=='maxCompactions,maxRequests,maxTokens'||
          proposed.maxRequests!==null||proposed.maxTokens!==null||proposed.maxCompactions!==8||
          proposed.maxRequests!==limits.maxRequests||proposed.maxTokens!==limits.maxTokens||proposed.maxCompactions!==limits.maxCompactions)
          throw Error('CRAFTMINE_HOST_LIMITS_REQUIRED');
      }
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
    if(['targetFeedback.describe','targetFeedback.submit','targetFeedback.status'].includes(method)){
      if(!targetFeedback)throw Error('TARGET_FEEDBACK_UNAVAILABLE');
      return targetFeedback[method.split('.')[1]](params);
    }
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
    if(method==='package.sourceJob'){
      fields(params,['worldId','jobId']);
      if(!packageTurns)throw Error('PACKAGE_TURN_LIFECYCLE_REQUIRED');
      return packageTurns.readJob(params);
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
      'world.archiveStatus':['id'],
      'world.archiveFailed':['id','revision','baseBuild'],
      'world.restoreArchived':['id'],
      'world.archivedList':[],
      'godotWorld.initCancel':['worldId'],
      'godotWorld.initCancelClear':['worldId'],
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
      'godotBuild.latest':[[],['worldId','sessionId']],
      'task.recoverable':[['projectId','worldId'],[]],
      'godotWorld.initialize':[['worldId','title','baseId','baseBuild','snapshot'],[]],
      'godotWorld.initStatus':[['worldId'],[]],
      'godotWorld.initLaunchFailed':[['worldId','initId','candidateId','applicationId'],[]],
      'godotWorld.initLaunchRetry':[['worldId','initId','candidateId','applicationId'],[]],
      'godotWorld.copyStatus':[['worldId'],['sourceWorldId']],
      'content.branch.create':[['worldId','branchId','fromRev'],['requestId','taskId','title']],
      'content.migrate.plan':[['worldId'],[]],
      'content.migrate.apply':[['worldId'],[]],
      'content.migrate.verify':[['worldId'],[]],
      'godotWorld.copy':[['sourceWorldId','targetWorldId','title','progress'],['snapshot','context']],
      'godotWorld.backupSnapshot':[['worldId'],['context']],
      'godotWorld.verifySnapshot':[['worldId','snapshot'],['context']],
      'godotProject.create':[['context','worldId','toolCallId','baseBuild','baseId','files'],[]],
      'godotProject.applyFiles':[['context','worldId','toolCallId','revision','manifestHash','files'],['operation','initialLoadRepair']],
      'godotProject.index':[['context','worldId'],['revision','manifestHash','offset','limit','branchId']],
      'godotProject.sourceContext':[['worldId'],[]],
      'godotProject.read':[['context','worldId','revision','manifestHash','path'],['offset','limit','branchId']],
      'godotProject.patch':[['context','worldId','toolCallId','revision','manifestHash','operations'],['operation']],
      'godotProject.receipt':[['binding','worldId','toolCallId','method','request'],[]],
      'godotBuild.start':[['context','worldId','toolCallId','revision','manifestHash','mode'],['branchId','checkRequirements']],
      'godotBuild.read':[['worldId','jobId'],['context']],
      'godotBuild.cancel':[['worldId','jobId'],['context']],
      'godotBuild.receipt':[['binding','worldId','toolCallId','method','request'],[]],
      'godotJob.continue':[['context','worldId','originJobId','toolCallId'],[]],
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
      if(method==='godotBuild.latest'){
        if(!Object.hasOwn(params,'worldId')&&!Object.hasOwn(params,'sessionId'))throw Error('SESSION_OR_WORLD_ID_REQUIRED');
        if(Object.hasOwn(params,'worldId'))boundedText(params.worldId,128);
        if(Object.hasOwn(params,'sessionId'))boundedText(params.sessionId,240);
      }
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
      fields(params,['context','selectedWorld','request'],['resumeInterrupted']);
      if(params.resumeInterrupted!==undefined&&typeof params.resumeInterrupted!=='boolean')throw Error('INVALID_RECOVERY_INTENT');
      fields(params.request,['id','text'],['kind']);
      // Validate the fresh request before it can change a recovery generation.
      boundedText(params.request.id,240);boundedText(params.request.text,16000);
      let workspace;
      try{workspace=await core.call('workspace.open',{context:params.context,selectedWorld:params.selectedWorld});}
      catch(error){
        if(params.resumeInterrupted!==true||(error?.errorCode??error?.code??error?.message)!=='EXPLICIT_RECOVERY_REQUIRED')throw error;
        const {projectId,sessionId,turnId}=params.context;
        const previous=await core.call('workspace.current',{projectId,sessionId}),binding=previous?.task?.binding;
        if(previous?.worldId!==params.selectedWorld||binding?.projectId!==projectId||binding?.sessionId!==sessionId||binding?.turnId===turnId)throw Error('RECOVERY_WORLD_BINDING_MISMATCH');
        const retained=await core.call('task.context',{context:contextOf(binding)});
        if(!sameBinding(retained?.binding,binding)||retained.world?.id!==params.selectedWorld||retained.recovery!=='interrupted'||!Number.isSafeInteger(retained.generation)||retained.generation<0)throw Error('RECOVERY_CONFLICT');
        const resumed=await core.call('task.resume',{context:params.context,taskId:binding.taskId,generation:retained.generation,renewRequestWindow:true});
        workspace=resumed?.workspace;
        if(workspace?.worldId!==params.selectedWorld||workspace.task?.binding?.projectId!==projectId||workspace.task?.binding?.sessionId!==sessionId||workspace.task?.binding?.turnId!==turnId||resumed.generation!==retained.generation+1||resumed.budget?.ownerTaskId!==retained.budget?.ownerTaskId)throw Error('RECOVERY_BINDING_UNCONFIRMED');
      }
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
        const requestId=boundedText(params.request.id,240),text=boundedText(params.request.text,16000);
        let known=before.requirements.find(item=>item.id===requestId);
        // A resumed turn can contain several original requests; the prompt
        // projection includes only the first. Absence there is not absence
        // from the durable journal. Read just the exact record's kind, then
        // leave full-text replay validation to Rust as before.
        if(!known){
          try{
            const journal=await core.call('task.readRequirements',{context:params.context,requestId,start:0,limit:1});
            if(!sameBinding(journal.binding,before.binding)||journal.worldId!==before.world.id||journal.totalRecords!==1||journal.items?.length!==1||journal.items[0].id!==requestId||!['request','correction'].includes(journal.items[0].kind))throw Error('CRAFTMINE_REQUIREMENT_BINDING_MISMATCH');
            known=journal.items[0];
          }catch(error){if((error?.errorCode??error?.code??error?.message)!=='REQUIREMENT_NOT_FOUND')throw error;}
        }
        await core.call('task.recordContext',{context:params.context,requestId,text,kind:known?.kind||'correction'});
      }
      return params.request? snapshot(params.context):before;
    }
    if(method==='review.context'){fields(params,['reviewId']);return reviewContext(params.reviewId);}
    const review=method.startsWith('review.');
    const operation=review?method.replace('review.','budget.'):method;
    if(!['budget.reserve','budget.settle','budget.boundary'].includes(operation))throw Error('UNSUPPORTED_HOST_OPERATION');
    const allowed=operation==='budget.reserve'?['requestId','purpose','estimatedInputTokens','maxOutputTokens',...(!review?['limits']:[])]:operation==='budget.settle'?['requestId','status','usage','errorCode']:['eventId','kind'];
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
