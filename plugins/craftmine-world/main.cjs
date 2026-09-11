// Trusted product glue. Authored gameplay never runs in this Node process.
const {CoreClient} = require('./core-client.cjs');
const {createPortableRestoreService} = require('./portable-restore-service.cjs');
const {createPackageTurnLifecycle,createPackageInstallBinding} = require('./package-turn-lifecycle.cjs');
const {randomUUID} = require('node:crypto');
const {createWorldTools} = require('./world-tools.cjs');
const {createVerificationJobs} = require('./verification-jobs.cjs');
const {createReviewJobs} = require('./review-jobs.cjs');
const {createApplications} = require('./applications.cjs');
const {createHostRequests} = require('./host-requests.cjs');
const {createWorkbenchService} = require('./workbench-service.cjs');
const {createGodotExecutor} = require('./godot-executor.cjs');
const {createAssetService} = require('./asset-service.mjs');
const {createReuseService,createManagedPackageInstaller,createManagedPackageSourceService} = require('./reuse-service.mjs');
const {createTargetFeedbackService} = require('./target-feedback-service.mjs');
const {emptyWorld, validateSnapshot, prepareLegacyWorld,readVerification,verificationSummary,createLibraryService,createMemoryService} = require('./domain.cjs');
const {createHostProviders,createCoreBudgetProvider} = require('./tool-services.cjs');
const {createSourceLibraryService}=require('./source-library-service.cjs');
let core,verifications,reviews,applications,hostRequests,workbench,godotExecutor,assetService,reuseService;
const endedTurns=new Set();
const turnKey=context=>JSON.stringify([context.sessionId,context.turnId]);
const importErrors={
  LEGACY_PROJECT_NOT_FOUND:'所选文件夹里没有旧世界，请选择原项目目录或其中的 .craftmine 文件夹。',
  LEGACY_PROJECT_FORMAT:'所选文件夹的存档格式不兼容，原文件未更改。',
  LEGACY_SOURCE_CHANGED_RETRY:'旧世界仍在更新，未完成导入。请先暂停旧版创作，再重试。',
  LEGACY_ARCHIVE_TOO_LARGE:'旧项目超过 256 MB 的导入上限，原文件未更改。',
  LEGACY_FILE_TOO_LARGE:'旧项目包含超过 64 MB 的单个文件，原文件未更改。',
  LEGACY_TOO_MANY_ENTRIES:'旧项目超过 10,000 个文件及文件夹的导入上限，原文件未更改。',
  LEGACY_LINK_REFUSED:'旧项目包含链接，暂不支持导入。请选择实际存档目录。',
  LEGACY_REPARSE_POINT_REFUSED:'旧项目包含链接目录，暂不支持导入。请选择实际存档目录。',
  CORRUPT_LEGACY_FILE:'旧世界备份的文件校验失败，未导入。原项目仍然保留。',
  CORRUPT_LEGACY_ARCHIVE:'旧世界备份的完整性校验失败，未导入。原项目仍然保留。',
};
async function onLoad() {
  core = new CoreClient(process.env.CRAFTMINE_CORE_BIN, await pi.plugin.getDataPath());
  reviews=createReviewJobs(core,pi.craftmine);
  verifications=createVerificationJobs(core,pi.craftmine,id=>reviews.start(id));
  applications=createApplications(core,pi.craftmine);
  const call=(method,params)=>core.call(method,params);
  workbench=createWorkbenchService(core,{library:createLibraryService({call}),memory:createMemoryService({call}),verifications,reviews,getSettings:()=>pi.plugin.getSettings()});
  // S5 asset service. Decoding is a host capability (pi.craftmine.assetPreview)
  // and asset bytes come from the host file bridge, so the plugin never holds a
  // decoder and never fabricates a preview: a missing host runner rejects the
  // call with its own reason.
  assetService=createAssetService({call,
    runPreview:input=>typeof pi.craftmine?.assetPreview==='function'
      ?pi.craftmine.assetPreview(input)
      :Promise.reject(Error('ASSET_PREVIEW_HOST_UNAVAILABLE')),
    cancelPreview:input=>typeof pi.craftmine?.cancelAssetPreview==='function'
      ?pi.craftmine.cancelAssetPreview(input)
      :Promise.reject(Error('ASSET_PREVIEW_HOST_UNAVAILABLE'))});
  // S3 works/package service: domain validation over the core's package routes.
  const packageTurns=createPackageTurnLifecycle({call});
  const targetFeedback=createTargetFeedbackService({call,selected:async()=>(await pi.plugin.getSettings()).activeWorldId,
    begin:params=>hostRequests('turn.begin',params),enqueue:(job,context)=>godotExecutor.enqueue(job,context),turns:packageTurns,
    stagingRoot:require('node:path').join(await pi.plugin.getDataPath(),'target-feedback-operations')});
  const installSource=createManagedPackageInstaller({call,
    turns:packageTurns,
    stagingRoot:require('node:path').join(await pi.plugin.getDataPath(),'package-source-installs'),
    enqueue:(job,context)=>godotExecutor.enqueue(job,context),
    bind:createPackageInstallBinding({call,begin:params=>hostRequests('turn.begin',params),
      selected:async()=>(await pi.plugin.getSettings()).activeWorldId,finish:packageTurns.finish})});
  const packageSource=createManagedPackageSourceService({call,bind:async worldId=>{
    if((await pi.plugin.getSettings()).activeWorldId!==worldId)throw Error('GODOT_WORLD_CHANGED');
    const worldRecord=await call('world.read',{id:worldId});
    if(worldRecord.runtimeKind!=='godot')throw Error('GODOT_WORLD_REQUIRED');
    // Source reads use the stable private project scope; the service reads
    // the index without creating a draft, operation, or task lease.
    const {context}=await call('godotProject.sourceContext',{worldId});
    return {worldRecord,context};
  }});
  reuseService=createReuseService({call,installSource,
    sourceList:args=>packageSource.listSource(args),exportSource:args=>packageSource.exportSource(args)});
  const sourceLibrary=createSourceLibraryService({call,installSource,directory:require('node:path').join(await pi.plugin.getDataPath(),'source-library-proposals')});
  reuseService.sourceProposals=args=>sourceLibrary.proposals(args);
  reuseService.installSourceProposal=args=>sourceLibrary.installProposal(args);
  // The managed executor owns the pinned engine. It registers only after a real
  // broker preflight, so the reported capability always comes from live state.
  const toolchain=typeof pi.craftmine?.getGodotToolchain==='function'?await pi.craftmine.getGodotToolchain():null;
  godotExecutor=createGodotExecutor(core,{dataPath:await pi.plugin.getDataPath(),verifier:pi.craftmine,logger:console,toolchain});
  const restoreService=createPortableRestoreService({core,rootDirectory:await pi.plugin.getDataPath()});
  const portableRestore={restore:async params=>{await targetFeedback.drain();await installSource.drain();await packageTurns.stop();try{return await restoreService.restore(params);}finally{packageTurns.start();}}};
  hostRequests=createHostRequests(core,{verifications,reviews,getSettings:()=>pi.plugin.getSettings(),workbench,godotExecutor,assetService,reuseService,portableRestore,packageTurns,targetFeedback});
  pi.services.register({id:'world-core',start:()=>{packageTurns.start();return core.start();},stop:async()=>{await targetFeedback.drain();await installSource.drain();await godotExecutor?.stop();await packageTurns.stop();await core.stop();}});
  pi.services.register({id:'godot-executor',start:()=>godotExecutor.start(),stop:()=>godotExecutor.stop()});
  await pi.agent.registerTool({
    name: 'runtime_info',
    description: 'Inspect the connected Craftmine runtime and available integration capabilities.',
    risk: 'low', schema: {type:'object',properties:{},additionalProperties:false},
    execute: async (_args, context) => {
      const info=await core.start();
      const executor=godotExecutor?.status()??{state:'unavailable',available:false,reason:'GODOT_EXECUTOR_UNAVAILABLE'};
      return {
      format: 'craftmine.desktop-runtime/1',
      view: 'world',
      worldWritesAvailable: false,
      draftToolsAvailable: info.sessionDrafts===true,
      godotSourceToolsAvailable: info.godotProjects===true,
      godotBuildJobsAvailable: info.godotBuildJobs===true,
      godotExecutorGate: info.godotExecutorGate===true,
      // Live state of the managed executor, never a constant: a missing broker,
      // engine, template or failed preflight reports its own reason.
      godotBuildAvailable: executor.available===true,
      godotCheckAvailable: executor.checkAvailable===true,
      godotExecutor: {state:executor.state,reason:executor.reason,engineVersion:executor.engineVersion,
        isolation:executor.isolation,evidenceHash:executor.evidenceHash?executor.evidenceHash.slice(0,16):null,
        brokerSha256:executor.broker?.sha256??null,bridgeSha256:executor.bridge?.sha256??null,
        preflight:executor.preflight??null,jobs:executor.jobs??[]},
      godotExecutionInCore: info.godotExecution===true,
      verificationJobsAvailable: info.verificationJobs===true,
      playerApplicationsAvailable: info.playerApplications===true,
      core: info,
      invocation: {sessionId:context?.sessionId,turnId:context?.turnId,toolCallId:context?.toolCallId},
      };
    },
  });
  // Model-tool service wiring (task S6). Each provider is optional at the
  // contract level, but production must supply every one of them: an unwired
  // provider makes the tool report an explicit gap with its owner instead of
  // substituting a task-start snapshot, a saved value or a zero counter.
  const hostProviders=createHostProviders((method,params)=>{
    if(method==='creationTarget'&&typeof pi.craftmine?.creationTarget==='function')return pi.craftmine.creationTarget(params);
    if(method==='godotLiveState'&&typeof pi.craftmine?.godotLiveState==='function')return pi.craftmine.godotLiveState(params);
    throw Object.assign(Error('HOST_PROVIDER_NOT_WIRED'),{errorCode:'HOST_PROVIDER_NOT_WIRED'});
  });
  const toolServices={
    ...hostProviders,
    sourceLibrary:(args,context,worldId,toolCallId)=>sourceLibrary.tool(args,context,worldId,toolCallId),
    buildReadWaitMs:30000,
    // The seven-kind limit ledger is read through this process's core client.
    budget:createCoreBudgetProvider(core),
    // The managed executor lives in this process: its own status is the gate,
    // and it is the service that actually runs a queued build or check job.
    executorStatus:()=>godotExecutor.status(),
    executorCreationCompletion:binding=>godotExecutor.creationCompletion(binding),
    executorEnqueue:(job,context)=>godotExecutor.enqueue(job,context),
    executorCancel:jobId=>godotExecutor.cancel(jobId),
  };
  for(const tool of createWorldTools(core,()=>pi.plugin.getSettings(),context=>endedTurns.has(turnKey(context)),verifications,reviews,toolServices))await pi.agent.registerTool(tool);
}

// Private parent-process lifecycle. There is no panel channel for this method.
async function onHostTurnEnd(payload) {
  endedTurns.add(turnKey(payload));
  if(payload.status!=='completed'){await verifications.cancelTurn(payload);await reviews.cancelTurn(payload);}
  await core.start();
  await core.call('workspace.endTurn',payload);
  endedTurns.delete(turnKey(payload)); // Rust now owns the durable rejection.
}

async function onPanelInvoke(channel, payload={}) {
  await core.start();
  if(channel==='candidate.apply')return applications.apply(payload);
  if(channel==='candidate.applicationState')return applications.state(payload.operationId,payload.worldId);
  if(channel==='review.list')return core.call('review.list',{verificationId:payload.verificationId}).then(records=>records.map(record=>({id:record.id,status:record.status,current:record.current,
    summary:record.output?.summary,verdict:record.output?.verdict,suggestions:record.output?.suggestions||[],limitations:record.output?.limitations||[],
    error:record.output?.error,request:record.input.origin.request,acceptance:record.output?.acceptance?{passed:record.output.acceptance.passed,assertions:record.output.acceptance.assertions}:null,
    modelKey:record.input.origin.modelKey,usage:record.output?.usage||null,createdAt:record.createdAt})));
  if(channel==='review.start')return reviews.start(payload.verificationId,{retry:true}).then(record=>({id:record.id,status:record.status}));
  if(channel==='review.cancel')return reviews.cancel(payload.id).then(()=>({ok:true}));
  if(channel==='verification.list')return core.call('verification.list',{worldId:payload.worldId,offset:payload.offset??0,limit:payload.limit??16});
  if(channel==='verification.read')return readVerification(await core.call('verification.read',{id:payload.id}),payload);
  if(channel==='verification.preview') {
    const job=await core.call('verification.read',{id:payload.id});
    if(job.status!=='passed'||!job.output?.artifact)throw Error('这次检查还没有可预览的构建');
    return {job:verificationSummary(job),world:job.output.artifact};
  }
  if(channel==='verification.cancel') {
    const result=await core.call('verification.cancel',{id:payload.id});
    await verifications.cancel(payload.id);return result;
  }
  // Managed Godot build, candidate and application panel channels. They carry
  // only world/job identity; the player-facing apply flow stays host-driven.
  if(channel==='godot.buildRead')return core.call('godotBuild.read',{worldId:payload.worldId,jobId:payload.jobId});
  if(channel==='godot.buildCancel')return core.call('godotBuild.cancel',{worldId:payload.worldId,jobId:payload.jobId});
  if(channel==='godot.candidateList')return core.call('godotCandidate.list',{worldId:payload.worldId,offset:payload.offset??0,limit:payload.limit??16});
  if(channel==='godot.candidateRead')return core.call('godotCandidate.read',{worldId:payload.worldId,candidateId:payload.candidateId});
  if(channel==='godot.applicationRead')return core.call('godotApplication.read',{id:payload.id});
  if(channel==='godot.applicationAbort')return core.call('godotApplication.abort',{id:payload.id});
  // A page must never obtain a launch token and attest to its own candidate.
  // Reopen this flow only through a trusted runtime coordinator with durable
  // progress and an independently observed candidate instance.
  if(channel==='godot.applicationPrepare'||channel==='godot.applicationCommit') {
    throw Error('GODOT_APPLICATION_HOST_REQUIRED');
  }

  if(channel==='world.importLegacy') {
    // Electron replaces this payload with the native picker's granted root.
    // The untrusted page cannot supply or override the filesystem source.
    const deadline=Date.now()+90000;
    const call=(method,params)=>{
      const remaining=deadline-Date.now();
      if(remaining<=0)throw Error('旧世界导入超时，已保留原始文件');
      return core.call(method,params,Math.min(remaining,60000)).catch(error=>{throw Error(importErrors[error.message]||error.message);});
    };
    const archive=await call('legacy.capture',{id:randomUUID(),source:payload.source});
    const world=await prepareLegacyWorld(archive.project,async path=>JSON.parse(await call('legacy.readText',{id:archive.id,path})));
    const record=await call('legacy.commit',{id:archive.id,title:world.build.scene.title,world});
    await pi.plugin.setSettings({activeWorldId:record.id});
    return {record,archive:{id:archive.id,files:archive.files,bytes:archive.bytes,manifestHash:archive.manifestHash},preserved:{candidate:!!archive.project.candidate,modules:archive.project.library?.length||0,tasks:archive.project.tasks?.length||0}};
  }
  if(channel==='world.list') {
    const labels={'first-person':'Godot 第一人称','top-down':'Godot 俯视','side-view':'Godot 横版','mining-sandbox':'Godot 采矿沙盒'};
    const worlds=(await core.call('world.list')).map(record=>({
      ...record,
      ...(record.runtimeKind==='legacy'?{base:{id:'craftmine-web/5',label:'网页体素',delivered:true}}:
        record.runtimeKind==='godot'?{base:{id:record.baseId,label:labels[record.baseId]||'Godot',delivered:false}}:{}),
    }));
    return {worlds,activeWorldId:(await pi.plugin.getSettings()).activeWorldId};
  }
  if(channel==='world.createOptions')return {
    create:true,switch:true,
    bases:[{id:'craftmine-web/5',label:'网页体素',delivered:true}],
    starters:[{id:'blank',label:'空白世界',delivered:true}],
  };
  if(channel==='world.create') {
    if(payload.baseId && payload.baseId!=='craftmine-web/5')throw Error('WORLD_BASE_UNAVAILABLE');
    if(payload.starterId && payload.starterId!=='blank')throw Error('WORLD_STARTER_UNAVAILABLE');
    const title=String(payload.title??'').trim();
    const record=await core.call('world.create',{id:randomUUID(),title,world:emptyWorld(title)});
    if(payload.activate!==false)await pi.plugin.setSettings({activeWorldId:record.id});
    return record;
  }
  if(channel==='world.read')return core.call('world.read',{id:payload.id});
  if(channel==='world.open') {
    const record=await core.call('world.read',{id:payload.id});
    await pi.plugin.setSettings({activeWorldId:record.id});
    return record;
  }
  if(channel==='world.saveProgress') {
    return core.call('world.saveProgress',{id:payload.id,revision:payload.revision,baseBuild:payload.baseBuild,snapshot:validateSnapshot(payload.snapshot)});
  }
  throw Error('Unsupported Craftmine panel operation');
}

async function onUnload() {
  await godotExecutor?.stop();
  await verifications?.stop();
  await reviews?.stop();
  await core?.stop();
  for(const tool of require('./manifest.json').contributes.agentTools)await pi.agent.unregisterTool(tool.name);
}
const onHostRequest=(method,params)=>hostRequests(method,params);
module.exports = {onLoad, onUnload, onPanelInvoke, onHostTurnEnd, onHostRequest};
