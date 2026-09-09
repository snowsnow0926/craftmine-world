// PI owns the agent loop. This broker exposes bounded domain operations only.
const {fields,inspectDraft,readDraftResource,patchDraft,readCapabilities,readVerification}=require('./domain.cjs');

function hostContext(context) {
  for(const key of ['projectId','sessionId','turnId','toolCallId','executionId']) {
    const value=context?.[key];
    if(typeof value!=='string'||!value.trim()||value.length>240||/[\x00-\x1f]/.test(value))throw Error('HOST_IDENTITY_REQUIRED: 世界工具需要有效的 PI 会话');
  }
  return {projectId:context.projectId,sessionId:context.sessionId,turnId:context.turnId};
}

function createWorldTools(core,getSettings,isEnded=()=>false,verifications,reviews) {
  const definitions=require('./manifest.json').contributes.agentTools.filter(tool=>tool.name!=='runtime_info');
  return definitions.map(definition=>({...definition,execute:async(args,invocation)=>{
    const context=hostContext(invocation);
    const assertActive=()=>{if(isEnded(context))throw Error('TURN_ENDED');};
    assertActive();
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('INVALID_ARGUMENTS');
    if(Buffer.byteLength(JSON.stringify(args),'utf8')>180000)throw Error('TOOL_INPUT_TOO_LARGE');
    // Reject forged identity/unknown fields before acquiring any draft lease.
    const allowed=Object.keys(definition.schema.properties);
    fields(args,definition.schema.required||[],allowed.filter(key=>!(definition.schema.required||[]).includes(key)));
    await core.start();
    if(definition.name==='verification_read') {
      const job=await core.call('verification.read',{context,id:args.id});
      return {...readVerification(job,args),reviews:await core.call('review.list',{verificationId:args.id}).then(records=>records.slice(0,1).map(record=>{
        const failed=(record.output?.acceptance?.assertions||[]).filter(assertion=>!assertion.passed);
        return {id:record.id,status:record.status,summary:record.output?.summary?.slice(0,1200),error:record.output?.error?.slice(0,600),requestPassed:record.output?.acceptance?.passed,advisory:true,
          failedCount:failed.length,failedAssertions:failed.slice(0,6).map(assertion=>({id:assertion.id,why:assertion.why?.slice(0,200),detail:assertion.detail?.slice(0,400)}))};
      }))};
    }
    if(definition.name==='verification_cancel') {
      const result=await core.call('verification.cancel',{context,id:args.id});
      await verifications.cancel(args.id);return result;
    }
    const selectedWorld=(await getSettings()).activeWorldId;
    assertActive();
    const workspace=await core.call('workspace.open',{context,selectedWorld});
    await verifications?.cancelOtherTurns(context);
    await reviews?.cancelOtherTurns(context);
    if(definition.name==='verification_submit') {
      const job=await core.call('verification.submit',{context,toolCallId:invocation.toolCallId,revision:args.workspaceRevision,summary:args.summary,origin:invocation.craftmineOrigin||null});
      verifications.enqueue(job,context);return job;
    }
    if(definition.name==='project_inspect')return inspectDraft(workspace,args);
    if(definition.name==='resource_read') {
      const result=readDraftResource(workspace,args);
      await core.call('workspace.recordRead',{context,revision:result.workspaceRevision,key:args.kind+':'+args.id,hash:result.hash});
      return result;
    }
    const record=await core.call('world.read',{id:workspace.worldId});
    if(definition.name==='capabilities_read')return readCapabilities(args,record.world.extensions,workspace.task.draft.scene);
    if(definition.name==='workspace_patch') {
      const params={context,toolCallId:invocation.toolCallId,request:args};
      const previous=await core.call('workspace.receipt',params);
      if(previous)return {workspaceRevision:previous.revision,draftHash:previous.draftHash,replayed:true,publishingAvailable:false};
      const patched=patchDraft(workspace,args,record.world);
      assertActive();
      const receipt=await core.call('workspace.commit',{...params,binding:workspace.task.binding,revision:workspace.task.revision,draft:patched.draft});
      await verifications?.cancelTurn(context);
      await reviews?.cancelTurn(context);
      return {workspaceRevision:receipt.revision,draftHash:receipt.draftHash,changed:patched.changed,replayed:false,publishingAvailable:false};
    }
    throw Error('UNKNOWN_WORLD_TOOL');
  }}));
}

module.exports={createWorldTools};
