// PI owns the agent loop. This broker exposes bounded domain operations only.
const {createHash}=require('node:crypto');
const {fields,inspectDraft,readDraftResource,patchDraft,readCapabilities,readVerification,draftPackages,createLibraryService,createMemoryService}=require('./domain.cjs');
const docs=require('./godot-docs.cjs');
const {createProjectQuery}=require('./godot-query.cjs');
const {describeRuntime,normalizeLiveSample,projectFacts,readLimitAccounting}=require('./godot-observe.cjs');
const {capabilityReport,classifyGap,readCapabilityContext}=require('./godot-capability.cjs');
const {createHistoryService}=require('./godot-history.cjs');
const {createLibraryBinding,validateSourceAssetRef}=require('./godot-library.cjs');
const {MODES:MODULE_PARAMETER_MODES,validateModuleParameterQuery,createModuleParameterQuery}=require('./godot-module-parameter-query.cjs');
const {executorStatus,usageSummary,continueJob,listRecoverable,resumeDraft,explainRecovery}=require('./godot-jobs.cjs');
const {validateToolServices,describeToolServices}=require('./tool-services.cjs');
const {GODOT_METHODS,LOCAL_TOOLS,WRITE_TOOLS,CONDITIONAL_WRITE_TOOLS,GODOT_RECEIPTS}=require('./godot-routing.cjs');

function hostContext(context) {
  if(context?.toolCallId?.startsWith('@host:'))throw Error('RESERVED_HOST_RECEIPT');
  for(const key of ['projectId','sessionId','turnId','toolCallId','executionId']) {
    const value=context?.[key];
    if(typeof value!=='string'||!value.trim()||value.length>240||/[\x00-\x1f]/.test(value))throw Error('HOST_IDENTITY_REQUIRED: 世界工具需要有效的 PI 会话');
  }
  return {projectId:context.projectId,sessionId:context.sessionId,turnId:context.turnId};
}

function createWorldTools(core,getSettings,isEnded=()=>false,verifications,reviews,options={}) {
  // The provider contract is validated once, at construction, so a wrong type
  // fails the plugin load instead of silently degrading a live reading.
  validateToolServices(options);
  const services=describeToolServices(options);
  const library=createLibraryService({call:(method,params)=>core.call(method,params)});
  const memory=createMemoryService({call:(method,params)=>core.call(method,params)});
  const definitions=require('./manifest.json').contributes.agentTools.filter(tool=>tool.name!=='runtime_info');
  // Last accepted live instance per world, so a restarted game process
  // invalidates the previous sample instead of being read as the same one.
  const liveInstances=new Map();
  let creationExecute,moduleParameterQuery;
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
      if(['api-info','api-class','api-search'].includes(args.mode)){
        const mode=args.mode==='api-info'?'info':args.mode==='api-search'?'search':args.memberName!==undefined?'member':'class';
        const result=require('./godot-engine-api.cjs').queryEngineApi({...args,mode});
        return {...result,tool:'godot_docs',toolMode:args.mode,
          ...(Array.isArray(result.modes)?{metadataQueryModes:result.modes,modes:['api-info','api-class','api-search']}: {})};
      }
      if(args.mode==='info')return docs.docsInfo();
      if(args.mode==='search')return docs.searchDocs(args);
      if(args.mode==='read')return docs.readDoc(args);
      throw Error('INVALID_DOCS_MODE');
    }
    // Validate exact catalog IDs before opening the host-bound workspace.
    if(definition.name==='godot_guidance')require('./godot-guidance.cjs').validateRequest(args);
    if(definition.name==='package_library'&&args.mode==='propose-source-install')validateSourceAssetRef(args.ref);
    if(definition.name==='godot_project_query'&&MODULE_PARAMETER_MODES.includes(args.mode))validateModuleParameterQuery(args);
    // Discussion-only turns may read anything and change nothing. The host may
    // pass a predicate, or expose discussionOnly/readOnlyTurn through settings;
    // either way the refusal happens before any host call.
    const conditionalWrite=CONDITIONAL_WRITE_TOOLS[definition.name];
    const isWrite=WRITE_TOOLS.has(definition.name)||(conditionalWrite!==undefined&&args.mode===conditionalWrite);
    if(isWrite) {
      let blocked=typeof options.isDiscussionOnly==='function'&&options.isDiscussionOnly();
      if(!blocked) {
        const settings=await getSettings();
        blocked=settings?.discussionOnly===true||settings?.readOnlyTurn===true;
      }
      if(blocked)throw Error('DISCUSSION_MODE_READ_ONLY');
    }
    await core.start();
    if(definition.name==='godot_performance_observe')return require('./godot-performance-query.cjs').queryPerformance({
      core,context,samplePerformance:options.samplePerformance,sampleLiveState:options.sampleLiveState,
      sampleEnginePerformance:options.sampleEnginePerformance,assertActive});
    if(definition.name==='godot_project_query'&&MODULE_PARAMETER_MODES.includes(args.mode)){
      moduleParameterQuery??=createModuleParameterQuery({core,capture:options.creationTarget,sample:options.sampleLiveState,assertActive:activeContext=>{if(isEnded(activeContext))throw Error('TURN_ENDED');}});
      return moduleParameterQuery({context,args});
    }
    if(definition.name==='package_library'&&args.mode==='propose-source-install'){
      // Suggestions are read-only, including world resolution: do not open a
      // workspace or acquire a draft lease just to suggest a catalog source.
      const binding=await core.call('task.context',{context});
      const worldId=binding?.world?.id;
      if(typeof worldId!=='string'||!worldId)throw Error('WORLD_BINDING_UNRESOLVED');
      assertActive();
      const result=await createLibraryBinding({core,worldId}).proposeSourceInstall({ref:args.ref});
      assertActive();
      return result;
    }
    if(definition.name==='godot_capability_report') {
      const handshake=await core.start();
      const gaps=args.request||Array.isArray(args.evidence)?[{request:args.request||null,evidence:args.evidence||[]}]:[];
      let executor;
      try {executor=await executorStatus(core,options);}
      catch(error){executor={source:'core-registration',available:false,reason:'EXECUTOR_STATUS_FAILED',errorCode:error?.errorCode||null};}
      return capabilityReport({manifest:require('./manifest.json'),routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake,
        gaps,limits:await readLimitAccounting(options.budget,context),services,executor,
        executionContext:await readCapabilityContext(core,context,handshake),
        methodOverrides:{historyMethods:options.historyMethods,libraryMethods:options.libraryMethods}});
    }
    // The executor gate is global, so it must answer even when no world is bound.
    if(definition.name==='godot_jobs'&&args.mode==='status')return executorStatus(core,options);
    if(definition.name==='requirements_read')return core.call('task.readRequirements',{...args,context});
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
      await verifications?.cancel(args.id);return result;
    }
    const selectedWorld=(await getSettings()).activeWorldId;
    assertActive();
    const workspace=await core.call('workspace.open',{context,selectedWorld});
    assertActive();
    if(definition.name==='godot_guidance')return require('./godot-guidance.cjs').queryGuidance(core,
      {context,worldId:workspace.worldId,args,assertActive});
    await verifications?.cancelOtherTurns(context);
    await reviews?.cancelOtherTurns(context);
    const godotWrites={godot_project_create:true,godot_project_patch:true,godot_asset_put:true,godot_build_start:true};
    const godotReceipts=GODOT_RECEIPTS;
    // Hand a queued core job to the live managed executor. A missing provider is
    // reported as unwired with its owner; the durable job row still exists, so
    // the player and the model both see that execution did not start.
    const handOffJob=async(job,context)=>{
      const jobId=typeof job?.jobId==='string'?job.jobId:typeof job?.id==='string'?job.id:null;
      if(!jobId)return {enqueued:false,reason:'JOB_ID_MISSING',owner:'S2'};
      if(typeof options.executorEnqueue!=='function')return {enqueued:false,reason:'EXECUTOR_PROVIDER_NOT_WIRED',owner:'S2',
        note:'The core job is recorded but no live executor received it.'};
      try {
        const result=await options.executorEnqueue({jobId,worldId:workspace.worldId,mode:job?.kind??job?.mode??'build'},context);
        return {enqueued:result?.enqueued===true,reason:result?.reason??null,owner:'S2'};
      } catch(error){
        return {enqueued:false,reason:error?.errorCode||error?.message||'EXECUTOR_ENQUEUE_FAILED',owner:'S2'};
      }
    };
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
      const previous=liveInstances.get(workspace.worldId)||null;
      const live=failure||(typeof options.sampleLiveState==='function'
        ? normalizeLiveSample(sample,{worldId:workspace.worldId,buildId:descriptor.buildId,
            instanceId:previous?.instanceId??null},{maxAgeMs:options.maxSampleAgeMs})
        : {available:false,reason:'LIVE_OBSERVATION_NOT_WIRED',
           dependency:'host live sampler for the running Godot instance',
           note:'Camera, equipment, entities and quests below are unknown, not empty. Do not use the last saved progress as the current equipment.'});
      // Only a fresh, identity-verified sample becomes the new baseline.
      if(live.available&&!live.stale)liveInstances.set(workspace.worldId,{instanceId:live.instanceId,sampledAt:live.sampledAt});
      return {format:'craftmine.godot-runtime-state/1',scope:'live',descriptor:descriptorOnly,live,docsCompatibility,
        previousInstance:previous,durableProgress:{source:'last-confirmed-save',savedAt:durableProgress?.savedAt??null}};
    }
    if(definition.name==='godot_project_facts') {
      const facts=await projectFacts({core,context,worldId:workspace.worldId,sampler:options.sampleLiveState});
      facts.limits=await readLimitAccounting(options.budget,context);
      facts.docsCompatibility=docs.checkEngineVersion(facts.runtime?.engineVersion??facts.project?.engineVersion);
      // A model switch or a compaction must be able to recheck everything from
      // durable sources: capability flags, executor gate, durable usage.
      facts.modelSwitch={capabilityHandshake:await core.start(),requiresReinspection:true};
      facts.services=services;
      try { facts.executor=await executorStatus(core,options); }
      catch(error){ facts.executor={available:false,reason:error?.errorCode==='UNKNOWN_METHOD'?'DEPENDENCY_NOT_WIRED':'EXECUTOR_STATUS_FAILED',
        requiredHostMethod:'godotExecutor.status',owner:'S2'}; }
      try { facts.usage=await usageSummary(core,{context,worldId:workspace.worldId}); }
      catch(error){ facts.usage={available:false,reason:error?.errorCode==='UNKNOWN_METHOD'?'DEPENDENCY_NOT_WIRED':'USAGE_READ_FAILED',
        requiredHostMethod:'godotJob.usage',owner:'R1'}; }
      return facts;
    }
    if(definition.name==='godot_jobs') {
      if(args.mode==='status')return executorStatus(core,options);
      if(args.mode==='usage')return usageSummary(core,{context,worldId:workspace.worldId});
      if(args.mode==='resume') {
        if(!args.originJobId)throw Error('ORIGIN_JOB_ID_REQUIRED');
        const resumed=await continueJob(core,{context,worldId:workspace.worldId,originJobId:args.originJobId,toolCallId:invocation.toolCallId});
        // A continued job is queued again in the core; it still needs the live
        // executor, so the same hand-off applies as for a fresh start.
        if(resumed?.available===false)return resumed;
        return {...resumed,execution:await handOffJob(resumed?.result,context)};
      }
      throw Error('INVALID_JOBS_MODE');
    }
    if(definition.name==='godot_draft_recovery') {
      if(args.mode==='list')return listRecoverable(core,{projectId:context.projectId,worldId:workspace.worldId,sessionId:context.sessionId});
      if(args.mode==='resume') {
        if(!args.taskId)throw Error('TASK_ID_REQUIRED');
        if(!Number.isSafeInteger(args.generation))throw Error('GENERATION_REQUIRED');
        return resumeDraft(core,{context,worldId:workspace.worldId,taskId:args.taskId,generation:args.generation});
      }
      throw Error('INVALID_RECOVERY_MODE');
    }
    if(definition.name==='creation_operation'){
      creationExecute??=require('./creation-source-service.cjs').createCreationSourceService({core,capture:options.creationTarget,sample:options.sampleLiveState,assertActive:context=>{if(isEnded(context))throw Error('TURN_ENDED');}});
      return creationExecute({context,workspace,request:args.request});
    }
    if(definition.name==='asset_library') {
      const library=createLibraryBinding({core,context,worldId:workspace.worldId,methods:options.libraryMethods});
      if(args.mode==='search')return library.assetSearch(args);
      if(args.mode==='read'){if(!args.assetId)throw Error('ASSET_ID_REQUIRED');return library.assetRead(args);}
      if(args.mode==='versions'){if(!args.assetId)throw Error('ASSET_ID_REQUIRED');return library.assetVersions(args);}
      throw Error('INVALID_ASSET_MODE');
    }
    if(definition.name==='package_library') {
      const library=createLibraryBinding({core,context,worldId:workspace.worldId,methods:options.libraryMethods});
      if(args.mode==='check'){if(!args.ref)throw Error('ASSET_REF_REQUIRED');return library.packageCheck(args);}
      if(args.mode==='read'){if(!args.instanceId)throw Error('INSTANCE_ID_REQUIRED');return library.packageRead(args);}
      if(args.mode==='list')return library.packageList(args);
      if(args.mode==='propose') {
        // The bound world is the only install target the model may name; it
        // cannot widen the selection to another world.
        const selection=args.intent==='instance-only'?[workspace.worldId]:(args.selection||[]);
        return library.proposeChange({intent:args.intent,ref:args.ref,selection,target:args.target,
          instanceId:args.instanceId,progressRef:args.progressRef,operationId:invocation.toolCallId});
      }
      throw Error('INVALID_PACKAGE_MODE');
    }
    if(definition.name==='godot_history') {
      const history=createHistoryService({core,context,workspace,methods:options.historyMethods});
      if(args.mode==='history')return history.history(args);
      if(args.mode==='version'){if(!args.contentRef)throw Error('CONTENT_REF_REQUIRED');return history.version(args);}
      if(args.mode==='diff'){if(!args.from||!args.to)throw Error('DIFF_REQUIRES_FROM_AND_TO');return history.diff(args);}
      if(args.mode==='operation'){if(!args.operationId)throw Error('OPERATION_ID_REQUIRED');return history.operationResult(args);}
      if(args.mode==='checkpoint'){if(!args.contentRef)throw Error('CONTENT_REF_REQUIRED');return history.checkpoint(args);}
      if(args.mode==='merge-candidate'){if(!args.from||!args.to)throw Error('DIFF_REQUIRES_FROM_AND_TO');return history.mergeCandidate(args);}
      throw Error('INVALID_HISTORY_MODE');
    }
    if(Object.hasOwn(GODOT_METHODS,definition.name)) {
      assertActive();
      // Project identity and receipts always come from the durable host binding.
      const params={...args,context,worldId:workspace.worldId};
      if(godotWrites[definition.name])params.toolCallId=invocation.toolCallId;
      if(definition.name==='godot_project_create')params.baseBuild=workspace.task.binding.baseBuild;
      if(definition.name==='godot_build_start'&&args.mode==='check'&&typeof options.creationTarget==='function'){
        const captured=await options.creationTarget(context);assertActive();
        if(captured?.creationRequirements?.status==='verifiable')params.checkRequirements={format:'craftmine.godot-check-requirements/1',creation:captured.creationRequirements.requirements};
      }
      const method=GODOT_METHODS[definition.name];
      const decorateBuildRead=async record=>{
        assertActive();
        if((await getSettings()).activeWorldId!==selectedWorld)throw Error('GODOT_BUILD_READ_WORLD_CHANGED');
        assertActive();
        if(record?.jobId!==params.jobId||record?.worldId!==params.worldId)throw Error('GODOT_BUILD_READ_IDENTITY_CHANGED');
        let nativeEvidence={status:'unknown',reason:'NATIVE_EVIDENCE_NOT_WIRED'};
        if(typeof options.executorNativeDiagnosticEvidence==='function'){
          try{nativeEvidence=await options.executorNativeDiagnosticEvidence(structuredClone(record));}
          catch{nativeEvidence={status:'unknown',reason:'NATIVE_EVIDENCE_UNAVAILABLE'};}
          assertActive();
          if((await getSettings()).activeWorldId!==selectedWorld)throw Error('GODOT_BUILD_READ_WORLD_CHANGED');
          assertActive();
        }
        return {...record,diagnostics:require('./godot-diagnostics.cjs').diagnoseGodotBuildRead(record,nativeEvidence)};
      };
      if(definition.name==='godot_build_read'&&((options.buildReadWaitMs??0)>0||typeof options.executorCreationCompletion==='function')){
        const record=await require('./godot-build-read-wait.cjs').readGodotBuildWithWait({core,params,waitMs:options.buildReadWaitMs,assertActive,
          readCompletion:options.executorCreationCompletion,
          assertSelected:async()=>{if((await getSettings()).activeWorldId!==selectedWorld)throw Error('GODOT_BUILD_READ_WORLD_CHANGED');}});
        return decorateBuildRead(record);
      }
      if(definition.name==='godot_project_patch') {
        const source=await core.call('godotProject.index',{context,worldId:workspace.worldId,
          revision:args.revision,manifestHash:args.manifestHash,limit:1});
        assertActive();
        if(source.worldId!==workspace.worldId||source.revision!==args.revision||source.manifestHash!==args.manifestHash)throw Error('GODOT_PROJECT_IDENTITY_MISMATCH');
        if(source.content) {
          const {repoId,branchId,contentOid}=source.content;
          if(typeof repoId!=='string'||!repoId||branchId!=='main'||typeof contentOid!=='string'||!/^[a-f0-9]{40,64}$/.test(contentOid))throw Error('GODOT_PROJECT_CONTENT_IDENTITY_INVALID');
          // Authority comes from the Rust revision index and host invocation.
          // Source edits do not apply content or change saves. Null is intentional
          // for those expectations and keeps the original receipt replay stable.
          params.operation={operationId:'patch-'+createHash('sha256').update(JSON.stringify([context,invocation.toolCallId])).digest('hex'),
            worldId:workspace.worldId,repoId,branchId,expectedHeadOid:contentOid,
            expectedAppliedOid:null,expectedProgressRevision:null};
        }
      }
      let result;
      try { result=await core.call(method,params); }
      catch(error) {
        if(!godotWrites[definition.name]||error?.errorCode)throw error;
        // Recover the exact durable result without replaying an uncertain write.
        // A recovered queued job still needs the same executor handoff below.
        try {
          await core.start();
          result=await core.call(godotReceipts[method],{binding:workspace.task.binding,
            worldId:workspace.worldId,toolCallId:params.toolCallId,method,request:params});
        } catch {/* Preserve the original uncertain outcome if lookup is unavailable. */}
        if(!result)throw error;
      }
        // A queued build/check job must reach the live executor in the same
        // turn; otherwise the model reports a build that never runs.
        if(definition.name==='godot_build_start'&&result&&typeof result==='object'){
          const execution=isEnded(context)
            ? {enqueued:false,reason:'TURN_ENDED',owner:'S2',skipped:true}
            : result.executionAvailable===false
            ? {enqueued:false,reason:result.blockedReason||'GODOT_EXECUTION_UNAVAILABLE',owner:'S2',skipped:true}
            : await handOffJob(result,context);
          return {...result,execution};
        }
        if(definition.name==='godot_build_cancel'&&typeof options.executorCancel==='function'){
          const cancelled=await options.executorCancel(args.jobId).catch(error=>({cancelled:false,reason:error?.errorCode||error?.message}));
          return {...result,execution:{cancelled:cancelled?.cancelled===true,reason:cancelled?.reason??null,owner:'S2'}};
        }
        return definition.name==='godot_build_read'?decorateBuildRead(result):result;
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
    if(definition.name==='project_inspect'||definition.name==='capabilities_read'){
      const record=await core.call('world.read',{id:workspace.worldId});assertActive();
      const {isGodotWorkspace,readGodotGeneric}=require('./godot-generic-read.cjs');
      if(isGodotWorkspace(workspace,record))return readGodotGeneric({name:definition.name,args,core,context,workspace,record,assertActive,services,capture:options.creationTarget});
      if(definition.name==='project_inspect')return inspectDraft(workspace,args);
      return readCapabilities(args,draftPackages(workspace.task.draft,record.world).extensions,workspace.task.draft.scene);
    }
    if(definition.name==='resource_read') {
      const result=readDraftResource(workspace,args);
      await core.call('workspace.recordRead',{context,revision:result.workspaceRevision,key:args.kind+':'+args.id,hash:result.hash});
      return result;
    }
    const record=await core.call('world.read',{id:workspace.worldId});
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

module.exports={createWorldTools,GODOT_METHODS,LOCAL_TOOLS,WRITE_TOOLS,CONDITIONAL_WRITE_TOOLS};
