// Private orchestrator operations. No panel channel or model tool exposes this router.
const {fields}=require('./domain.cjs');
const bindingKeys=['projectId','sessionId','turnId','taskId','baseBuild'];
function sameBinding(a,b){return !!a&&!!b&&Object.keys(a).length===bindingKeys.length&&bindingKeys.every(key=>a[key]===b[key]);}
function contextOf(binding){return Object.fromEntries(['projectId','sessionId','turnId'].map(key=>[key,binding[key]]));}
function boundedText(value,max){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>max)throw Error('INVALID_HOST_TEXT');return value;}
function assertIdentity(input,snapshot){
  if(!sameBinding(input.binding,snapshot.binding)||input.generation!==snapshot.generation)throw Error('CRAFTMINE_BUDGET_BINDING_MISMATCH');
}
function createHostRequests(core,{verifications,reviews,getSettings,workbench}){
  const reservations=new Map();
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
    if(method==='godotRuntime.describe'){
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
    if(method==='budget.configure'||method==='budget.findReceipt'){
      fields(params,['projectId','sessionId','worldId','taskId','generation','operationId','maxTokens']);
      return core.call(method,params);
    }
    if(method==='task.interrupt'){
      fields(params,['context','reason']);
      const result=await core.call(method,params);
      await verifications?.cancelTurn(params.context);await reviews?.cancelTurn(params.context);
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
