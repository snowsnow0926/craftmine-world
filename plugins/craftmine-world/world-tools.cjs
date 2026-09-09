// PI owns the agent loop. This broker exposes bounded domain operations only.
const {fields,inspectDraft,readDraftResource,patchDraft,readCapabilities,readVerification,draftPackages,createLibraryService,createMemoryService}=require('./domain.cjs');
const docs=require('./godot-docs.cjs');
const {createProjectQuery}=require('./godot-query.cjs');
const {describeRuntime,normalizeLiveSample,projectFacts,limitAccounting}=require('./godot-observe.cjs');
const {capabilityReport,classifyGap}=require('./godot-capability.cjs');
const {createHistoryService}=require('./godot-history.cjs');
const {GODOT_METHODS,LOCAL_TOOLS,WRITE_TOOLS,GODOT_RECEIPTS}=require('./godot-routing.cjs');

function hostContext(context) {
  if(context?.toolCallId?.startsWith('@host:'))throw Error('RESERVED_HOST_RECEIPT');
  for(const key of ['projectId','sessionId','turnId','toolCallId','executionId']) {
    const value=context?.[key];
    if(typeof value!=='string'||!value.trim()||value.length>240||/[\x00-\x1f]/.test(value))throw Error('HOST_IDENTITY_REQUIRED: 世界工具需要有效的 PI 会话');
  }
  return {projectId:context.projectId,sessionId:context.sessionId,turnId:context.turnId};
}

function createWorldTools(core,getSettings,isEnded=()=>false,verifications,reviews,options={}) {
  const library=createLibraryService({call:(method,params)=>core.call(method,params)});
  const memory=createMemoryService({call:(method,params)=>core.call(method,params)});
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
    // Documentation needs neither the runtime nor a world binding.
    if(definition.name==='godot_docs') {
      if(args.mode==='info')return docs.docsInfo();
      if(args.mode==='search')return docs.searchDocs(args);
      if(args.mode==='read')return docs.readDoc(args);
      throw Error('INVALID_DOCS_MODE');
    }
    // Discussion-only turns may read anything and change nothing. The host may
    // pass a predicate, or expose discussionOnly/readOnlyTurn through settings;
    // either way the refusal happens before any host call.
    if(WRITE_TOOLS.has(definition.name)) {
      let blocked=typeof options.isDiscussionOnly==='function'&&options.isDiscussionOnly();
      if(!blocked) {
        const settings=await getSettings();
        blocked=settings?.discussionOnly===true||settings?.readOnlyTurn===true;
      }
      if(blocked)throw Error('DISCUSSION_MODE_READ_ONLY');
    }
    await core.start();
    if(definition.name==='godot_capability_report') {
      const handshake=await core.start();
      const gaps=args.request||Array.isArray(args.evidence)?[{request:args.request||null,evidence:args.evidence||[]}]:[];
      return capabilityReport({manifest:require('./manifest.json'),routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake,
        gaps,limits:limitAccounting(options.budget)});
    }
    if(definition.name==='requirements_read')return core.call('task.readRequirements',{context,...args});
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
    assertActive();
    await verifications?.cancelOtherTurns(context);
    await reviews?.cancelOtherTurns(context);
    const godotWrites={godot_project_create:true,godot_project_patch:true,godot_asset_put:true,godot_build_start:true};
    const godotReceipts=GODOT_RECEIPTS;
    if(definition.name==='godot_project_query') {
      const query=createProjectQuery({core,context,worldId:workspace.worldId});
      if(args.mode==='summary')return query.summary(args);
      if(args.mode==='scene'){if(!args.path)throw Error('PATH_REQUIRED');return query.scene(args);}
      if(args.mode==='scripts')return query.scripts(args);
      if(args.mode==='resources')return query.resources(args);
      if(args.mode==='find'){if(!args.name)throw Error('SYMBOL_NAME_REQUIRED');return query.find(args);}
      throw Error('INVALID_QUERY_MODE');
    }
    if(definition.name==='godot_runtime_state') {
      const descriptor=await describeRuntime(core,{worldId:workspace.worldId});
      // The saved snapshot body must never travel inside a live response.
      const {durableProgress,...descriptorOnly}=descriptor;
      const docsCompatibility=docs.checkEngineVersion(descriptor.engineVersion);
      if(args.scope==='build')return {...descriptorOnly,docsCompatibility};
      if(args.scope!=='live')throw Error('INVALID_SCOPE');
      if(!descriptor.available)return {format:'craftmine.godot-runtime-state/1',scope:'live',descriptor:descriptorOnly,
        live:{available:false,reason:descriptor.reason},docsCompatibility,
        note:'No durable runnable build is recorded for this world, so there is nothing to sample.'};
      let sample=null,failure=null;
      if(typeof options.sampleLiveState==='function'){
        try { sample=await options.sampleLiveState({worldId:workspace.worldId,buildId:descriptor.buildId}); }
        catch(error){ failure={available:false,reason:'LIVE_SAMPLE_FAILED',errorCode:error?.errorCode||null}; }
      }
      const live=failure||(typeof options.sampleLiveState==='function'
        ? normalizeLiveSample(sample,{worldId:workspace.worldId,buildId:descriptor.buildId})
        : {available:false,reason:'LIVE_OBSERVATION_NOT_WIRED',
           dependency:'host live sampler for the running Godot instance',
           note:'Camera, equipment, entities and quests below are unknown, not empty. Do not use the last saved progress as the current equipment.'});
      return {format:'craftmine.godot-runtime-state/1',scope:'live',descriptor:descriptorOnly,live,docsCompatibility,
        durableProgress:{source:'last-confirmed-save',savedAt:durableProgress?.savedAt??null}};
    }
    if(definition.name==='godot_project_facts') {
      const facts=await projectFacts({core,context,worldId:workspace.worldId,sampler:options.sampleLiveState});
      facts.limits=limitAccounting(options.budget);
      facts.docsCompatibility=docs.checkEngineVersion(facts.runtime?.engineVersion??facts.project?.engineVersion);
      return facts;
    }
    if(definition.name==='godot_history') {
      const history=createHistoryService({core,context,workspace,methods:options.historyMethods});
      if(args.mode==='history')return history.history(args);
      if(args.mode==='version'){if(!args.contentRef)throw Error('CONTENT_REF_REQUIRED');return history.version(args);}
      if(args.mode==='diff'){if(!args.from||!args.to)throw Error('DIFF_REQUIRES_FROM_AND_TO');return history.diff(args);}
      if(args.mode==='operation'){if(!args.operationId)throw Error('OPERATION_ID_REQUIRED');return history.operationResult(args);}
      if(args.mode==='asset-search'){if(!args.query)throw Error('QUERY_REQUIRED');return history.assetSearch(args);}
      if(args.mode==='asset-read'){if(!args.ref)throw Error('ASSET_REF_REQUIRED');return history.assetRead(args);}
      if(args.mode==='install-proposal'){if(!args.ref)throw Error('ASSET_REF_REQUIRED');return history.assetInstallProposal(args);}
      if(args.mode==='upgrade-proposal'){if(!args.ref)throw Error('ASSET_REF_REQUIRED');return history.assetUpgradeProposal(args);}
      throw Error('INVALID_HISTORY_MODE');
    }
    if(Object.hasOwn(GODOT_METHODS,definition.name)) {
      assertActive();
      // Project identity and receipts always come from the durable host binding.
      const params={...args,context,worldId:workspace.worldId};
      if(godotWrites[definition.name])params.toolCallId=invocation.toolCallId;
      if(definition.name==='godot_project_create')params.baseBuild=workspace.task.binding.baseBuild;
      const method=GODOT_METHODS[definition.name];
      try {return await core.call(method,params);}
      catch(error) {
        if(!godotWrites[definition.name]||error?.errorCode)throw error;
        // A transport failure cannot establish whether the commit happened.
        // Look up only the original receipt, including after the turn ended;
        // never reopen its lease or replay a write to discover the outcome.
        try {
          await core.start();
          const receipt=await core.call(godotReceipts[method],{binding:workspace.task.binding,
            worldId:workspace.worldId,toolCallId:params.toolCallId,method,request:params});
          if(receipt)return receipt;
        } catch {/* Preserve the original uncertain outcome if lookup is unavailable. */}
        throw error;
      }
    }
    if(definition.name==='library_search')return library.search(args);
    if(definition.name==='library_read')return library.read(args);
    if(definition.name==='library_install'){
      assertActive();
      const result=await library.install(context,invocation.toolCallId,{ref:args.ref,revision:args.workspaceRevision,...(args.position?{position:args.position}:{})});
      await verifications?.cancelTurn(context);await reviews?.cancelTurn(context);
      return {...result,workspaceRevision:result.receipt.revision,publishingAvailable:false};
    }
    if(definition.name==='memory_search')return memory.search({...args,scope:{projectId:context.projectId,worldId:workspace.worldId},sourceHashes:[workspace.task.draftHash]});
    if(definition.name==='memory_propose'){
      // A tool may suggest a memory, but only the existing durable evidence
      // can validate it. Never turn model text into a host user requirement.
      return memory.propose({context,operationId:invocation.toolCallId,record:{...args,scope:{projectId:context.projectId,worldId:workspace.worldId}}});
    }
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
    if(definition.name==='capabilities_read')return readCapabilities(args,draftPackages(workspace.task.draft,record.world).extensions,workspace.task.draft.scene);
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

module.exports={createWorldTools,GODOT_METHODS,LOCAL_TOOLS,WRITE_TOOLS};
