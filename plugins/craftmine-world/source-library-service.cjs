// Modern asset-catalog ZIPs are not legacy craftmine_library packages.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {validateAssetRef}=require('./godot-library.cjs');
const {referenceRoles,referenceHints,readSourceSnapshot,assessArchiveForSource,preflightErrorCode}=require('./source-library-read-hints.cjs');
const {validatePositionBounds,configurationHint}=require('./source-configuration.cjs');
const boundsFields=value=>value===undefined?{}:{positionBounds:validatePositionBounds(value)};
const hash=value=>createHash('sha256').update(value).digest('hex');
const MAX_ZIP=5*1024*1024;
const check=(yes,code)=>{if(!yes)throw Error(code);};
const exact=(value,keys)=>check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key)),'SOURCE_LIBRARY_INVALID_PARAMS');
const id=value=>check(typeof value==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(value),'SOURCE_LIBRARY_INVALID_PROPOSAL');
async function atomic(file,value){const temporary=file+'.tmp';await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,file);}

function createSourceLibraryService({call,directory,installSource,installSourceGroup,installAuthorSource,ensureBuiltin=async()=>{}}){
  check(typeof call==='function'&&path.isAbsolute(directory)&&typeof installSource==='function','SOURCE_LIBRARY_HOST_REQUIRED');
  const pending=new Map(),authorPending=new Map();
  const placement=value=>{exact(value,['x','y','z']);check(['x','y','z'].every(key=>Number.isFinite(value[key])&&Math.abs(value[key])<=80),'SOURCE_LIBRARY_INVALID_POSITION');return {x:value.x,y:value.y,z:value.z};};
  async function readArchive(ref){
    await ensureBuiltin();
    ref=validateAssetRef(ref);
    const record=await call('asset.read',{assetId:ref.assetId,version:ref.version});
    const version=record.version_;
    check(version?.assetId===ref.assetId&&version.version===ref.version&&version.contentHash===ref.contentHash,'SOURCE_LIBRARY_ASSET_CHANGED');
    check(version.mediaKind==='package'&&version.files?.length===1,'SOURCE_LIBRARY_NOT_SOURCE_PACKAGE');
    const file=version.files[0];const worldTemplate=version.kind==='world'&&file.mediaType==='application/zip';
    check(worldTemplate?file.bytes<=64*1024*1024:file.mediaType==='application/x-godot-package'&&file.bytes<=MAX_ZIP,'SOURCE_LIBRARY_NOT_SOURCE_PACKAGE');
    const body=await call('asset.bodyPath',{assetId:ref.assetId,version:ref.version,path:file.path});
    check(body.sha256===file.sha256&&body.bytes===file.bytes&&body.mediaType===file.mediaType&&path.isAbsolute(body.blobPath),'SOURCE_LIBRARY_BODY_MISMATCH');
    const stat=await fs.lstat(body.blobPath);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===file.bytes,'SOURCE_LIBRARY_BODY_MISMATCH');
    const bytes=await fs.readFile(body.blobPath);check(bytes.length===file.bytes&&hash(bytes)===file.sha256,'SOURCE_LIBRARY_BODY_MISMATCH');
    if(worldTemplate){const {validateArchive,worldTemplateSummary}=require('./player-world-library.cjs');const archive=await validateArchive(bytes);check(archive.manifest.assetId===ref.assetId&&archive.manifest.version===ref.version,'SOURCE_LIBRARY_ASSET_CHANGED');return {bytes,worldTemplate:worldTemplateSummary(archive,ref),record};}
    const {unpackStaticPackage}=await import('./package-zip.mjs');
    const archive=unpackStaticPackage(bytes,{maxEntryBytes:4*1024*1024,maxTotalBytes:6*1024*1024,maxCompressedBytes:6*1024*1024,maxEntries:1024});
    return {bytes,archive,record};
  }
  function describe(ref,{archive,record,worldTemplate}){
    if(worldTemplate){const {preview,...metadata}=worldTemplate;return {...metadata,note:'Whole-world template. Create a new independent world through the player world picker. It cannot be proposed or installed as a component in the current world. Starting state contains the author-selected saved progress; no target compatibility or first-load success is implied.'};}
    return {format:'craftmine.source-library/1',...referenceHints(ref),archiveSha256:archive.archiveSha256,
      rootRef:archive.packageJson.root,displayName:record.version_.displayName,source:record.version_.source,
      placement:{status:'template-default',capturedPlayerTargetUsed:false,note:'Installation uses the component template placement. This proposal does not implement a player request to place here. Use actual installed instance identities and normal source editing for later placement.'},
      resources:archive.resources.map(({manifest})=>({ref:{assetId:manifest.content.assetId,version:manifest.content.version,contentHash:manifest.contentHash},
        kind:manifest.content.kind,entry:manifest.content.entry,interfaces:manifest.content.interfaces,compatibility:manifest.content.compatibility,state:manifest.content.state,licenses:manifest.content.licenses,
        files:manifest.content.files})),verifiedScope:'archive-integrity-only',applied:false,
      note:'Archive validity is not target compatibility, runtime success or visual verification. Reading does not install anything. With current full-auto authorization, use install or install-group to add source in the active author turn and start checks; otherwise use propose for player confirmation. Both paths still require actual source checks and candidate adoption.'};
  }
  const projection=p=>({proposalId:p.proposalId,worldId:p.worldId,...(p.items?{kind:'group',items:p.items.map(item=>({archiveRef:item.ref,archiveSha256:item.archiveSha256,displayName:item.displayName,...(item.position?{position:item.position}:{}),...boundsFields(item.positionBounds)}))}:{archiveRef:p.ref,archiveSha256:p.archiveSha256}),displayName:p.displayName,source:p.source,...(p.position?{position:p.position}:{}),...boundsFields(p.positionBounds),applied:false,requiresPlayerAction:!p.result&&p.execution!=='author',...(p.execution?{execution:p.execution}:{}),method:'installSourceProposal',status:p.result?.status??(p.execution==='author'?'interrupted':'proposed'),
    ...(p.result?{installation:{source:p.result.source,instanceIds:p.result.instanceIds??[],
      ...(p.result.job?{job:{jobId:p.result.job.jobId,status:p.result.job.status}}:{}),...(p.result.sourceConfigurations?{sourceConfigurations:p.result.sourceConfigurations}:{})}}:{})});
  async function load(proposalId){id(proposalId);return JSON.parse(await fs.readFile(path.join(directory,proposalId+'.json'),'utf8'));}
  const composition=require('./world-composition.cjs').createWorldComposition({call,ensureBuiltin,readArchive});
  return {
    async compositionCatalog(args){exact(args,['worldId']);return {...composition.catalog(),worldId:args.worldId};},
    async compositionPlan(args){exact(args,['worldId','request']);return composition.plan(args.request,{worldId:args.worldId});},
    async directInspect(args){
      exact(args,['worldId','ref']);const ref=validateAssetRef(args.ref);
      const record=await call('world.read',{id:args.worldId});check(record.runtimeKind==='godot','GODOT_WORLD_REQUIRED');
      const archive=await readArchive(ref);
      if(archive.worldTemplate)return {eligible:false,reason:'WORLD_TEMPLATE_REQUIRES_NEW_WORLD',positionSupported:false,compatibility:'unchecked'};
      const roots=archive.archive.resources.filter(r=>r.manifest.content.entry?.sceneInstall);
      const root=roots[0],eligible=roots.length===1&&root.manifest.content.assetId===archive.archive.packageJson.root.id;
      let positionSupported=false;
      if(eligible){
        const spec=root.manifest.content.entry.sceneInstall;
        let nodeType=spec.mode==='script-node'?spec.nodeType:undefined,sceneFile=spec.sceneFile;
        const {parseScene}=await import('../../desktop/godot/shared/scene_materializer.mjs'),seen=new Set();
        while(spec.mode==='instance'&&sceneFile&&!nodeType&&!seen.has(sceneFile)&&seen.size<16){
          seen.add(sceneFile);const parsed=parseScene(root.files.get(sceneFile)?.toString('utf8')??''),sceneRoot=parsed.nodes.find(n=>n.parent===null);
          nodeType=/(?:^|\s)type="([^"]+)"(?:\s|$)/.exec(sceneRoot?.attributes??'')?.[1];
          const inherited=/instance=ExtResource\("([^"]+)"\)/.exec(sceneRoot?.header??'')?.[1],entry=parsed.extResources.find(item=>item.id===inherited),prefix='res://addons/'+root.manifest.content.assetId+'/';
          sceneFile=entry?.path?.startsWith(prefix)?entry.path.slice(prefix.length):null;
        }
        positionSupported=typeof nodeType==='string'&&nodeType.endsWith('3D');
      }
      const {context}=await call('godotProject.sourceContext',{worldId:args.worldId});
      const source=await call('godotProject.index',{context,worldId:args.worldId,offset:0,limit:1});
      check(source.worldId===args.worldId&&Number.isSafeInteger(source.revision)&&/^[a-f0-9]{64}$/.test(source.manifestHash),'SOURCE_LIBRARY_SOURCE_IDENTITY_REQUIRED');
      let configuration;
      if(eligible&&(root.manifest.content.entry.positionValidation||['cw.module.approved-pomeranian','cw.module.pet-companion'].includes(root.manifest.content.assetId))){
        const snapshot=await readSourceSnapshot(call,context,args.worldId,()=>{});
        const sameSource=snapshot.available&&snapshot.source.revision===source.revision&&snapshot.source.manifestHash===source.manifestHash;
        if(root.manifest.content.entry.positionValidation){
          check(snapshot.available,'SOURCE_LIBRARY_CONFIGURATION_UNCONFIRMED');
          check(sameSource,'SOURCE_LIBRARY_PREFLIGHT_SOURCE_CHANGED');
        }
        configuration=configurationHint(root.manifest.content,sameSource?snapshot.files:new Map(),sameSource?snapshot.source:source);
      }
      const legacy=configuration?.kind==='legacy-companion-range';
      const configured=!configuration||legacy||configuration.status==='configuration-planned';
      return {eligible:eligible&&configured,...(!eligible?{reason:'DIRECT_LIBRARY_SINGLE_SCENE_REQUIRED'}:!configured?{reason:'DIRECT_LIBRARY_WORLD_CONFIGURATION_REQUIRED'}:{}),...(legacy?{warning:'LEGACY_COMPANION_SAVE_BOUNDS'}:{}),...(configuration?{configuration}:{}),positionSupported,compatibility:'unchecked',displayName:archive.record.version_.displayName,
        source:{revision:source.revision,manifestHash:source.manifestHash}};
    },
    async directInstall(args){
      exact(args,['worldId','operationId','ref','expectedSource','position','positionBounds']);id(args.operationId);
      const ref=validateAssetRef(args.ref),archive=await readArchive(ref);check(!archive.worldTemplate,'WORLD_TEMPLATE_REQUIRES_NEW_WORLD');
      const roots=archive.archive.resources.filter(r=>r.manifest.content.entry?.sceneInstall);
      check(roots.length===1&&roots[0].manifest.content.assetId===archive.archive.packageJson.root.id,'DIRECT_LIBRARY_SINGLE_SCENE_REQUIRED');
      return installSource({worldId:args.worldId,operationId:args.operationId,expectedSource:args.expectedSource,archiveBase64:archive.bytes.toString('base64'),...(args.position?{position:placement(args.position)}:{}),...boundsFields(args.positionBounds)});
    },
    async directStatus(args){
      exact(args,['worldId','operationId']);id(args.operationId);
      const intent=await installSource.readOperation(args);
      if(!intent)return {status:'unknown',draftRetained:false};
      check(intent.worldId===args.worldId,'SOURCE_LIBRARY_WORLD_MISMATCH');
      const output={status:intent.job?'checking':'interrupted',draftRetained:!!intent.receipt,source:intent.receipt,instanceIds:intent.instanceIds??[],jobId:intent.job?.id??intent.job?.jobId};
      if(!output.jobId)return output;
      const job=await call('godotBuild.read',{worldId:args.worldId,jobId:output.jobId});
      check(job.worldId===args.worldId&&(job.jobId??job.id)===output.jobId,'DIRECT_LIBRARY_JOB_MISMATCH');
      output.status=job.status;output.candidateId=job.candidateId;output.buildId=job.buildId;
      if(['claimed','import','export','reuse-export','stage-artifacts','check'].includes(job.stage)&&Number.isInteger(job.progress)&&job.progress>=0&&job.progress<=100)output.checkProgress={stage:job.stage,percent:job.progress};
      if(job.status==='passed'&&Number.isSafeInteger(job.updatedAt)&&job.updatedAt>0)output.checkFinishedAt=job.updatedAt;
      if(job.status!=='passed')return output;
      const result=await call('godotCandidate.read',{worldId:args.worldId,candidateId:job.candidateId}),candidate=result.candidate;
      check(result.checkStatus==='passed'&&candidate?.worldId===args.worldId&&candidate.checkJobId===output.jobId&&candidate.buildId===job.buildId&&candidate.sourceRevision===job.sourceRevision&&candidate.manifestHash===job.manifestHash&&candidate.checkOutputHash===job.outputHash,'DIRECT_LIBRARY_CANDIDATE_UNVERIFIED');
      // A reply can be lost after formal adoption. Reconcile through Core's
      // adoption record before inspecting the now completed draft context.
      if(result.adoption?.wasApplied===true&&result.adoption.candidateId===job.candidateId&&result.adoption.buildId===job.buildId&&result.adoption.worldId===args.worldId){
        output.status=result.adoption.inCurrentLineage===true?'applied':'historical';return output;
      }
      const source=await call('godotProject.index',{context:intent.context,worldId:args.worldId,branchId:job.branchId??intent.applyRequest.operation?.branchId??'main',offset:0,limit:1});
      check(candidate.status==='ready'&&source.currentTaskId===job.taskId&&source.worldId===args.worldId&&source.revision===job.sourceRevision&&source.manifestHash===job.manifestHash,'DIRECT_LIBRARY_SOURCE_CHANGED');
      if(candidate.content)check(source.content?.repoId===candidate.content.repoId&&source.content?.contentOid===candidate.content.contentOid&&source.content?.branchId===candidate.content.branchId,'DIRECT_LIBRARY_SOURCE_CHANGED');
      return {...output,status:'ready'};
    },
    async tool(args,context,worldId,toolCallId,assertActive=()=>{}){
      assertActive();
      const persistNew=async proposal=>{
        assertActive();
        const filename=path.join(directory,proposal.proposalId+'.json');
        await atomic(filename,proposal);
        try{assertActive();}catch(error){
          // Only this invocation's newly created proposal is rolled back. An
          // existing retry result is never passed through this helper.
          const current=await load(proposal.proposalId);
          if(!current.result&&JSON.stringify(current)===JSON.stringify(proposal))await fs.unlink(filename);
          throw error;
        }
      };
      if(args.mode==='recipes'){exact(args,['mode']);return composition.catalog();}
      if(args.mode==='compose'){exact(args,['mode','request']);return composition.plan(args.request,{context,worldId,assertActive});}
      exact(args,['mode','query','offset','limit','ref','position','positionBounds','items']);
      if(args.mode==='install'||args.mode==='install-group'){
        check(typeof installAuthorSource==='function','SOURCE_LIBRARY_AUTOMATIC_INSTALL_UNAVAILABLE');
        const group=args.mode==='install-group';exact(args,group?['mode','items']:['mode','ref','position','positionBounds']);
        const input=group?args.items:[{ref:args.ref,...(args.position?{position:args.position}:{}),...boundsFields(args.positionBounds)}];
        check(Array.isArray(input)&&input.length>=(group?2:1)&&input.length<=(group?8:1),'SOURCE_LIBRARY_INVALID_GROUP');
        check(typeof toolCallId==='string'&&toolCallId.length>0,'SOURCE_LIBRARY_INVOCATION_REQUIRED');
        const proposalId='source-'+hash(JSON.stringify([context,toolCallId])).slice(0,48),requestHash=hash(JSON.stringify(args));
        const inFlight=authorPending.get(proposalId);if(inFlight){check(inFlight.requestHash===requestHash,'SOURCE_LIBRARY_PROPOSAL_CONFLICT');return inFlight.promise;}
        const promise=(async()=>{
        let proposal;try{proposal=await load(proposalId);check(proposal.execution==='author'&&proposal.requestHash===requestHash&&proposal.worldId===worldId&&JSON.stringify(proposal.context)===JSON.stringify(context),'SOURCE_LIBRARY_PROPOSAL_CONFLICT');}catch(error){if(error.code!=='ENOENT')throw error;}
        const items=[],archives=[],summaries=[];let totalBytes=0,totalPayload=0;
        for(const item of input){
          exact(item,['ref','position','positionBounds']);const ref=validateAssetRef(item.ref),placed=item.position===undefined?undefined:placement(item.position),archive=await readArchive(ref);
          check(!archive.worldTemplate,'WORLD_TEMPLATE_REQUIRES_NEW_WORLD');
          if(placed)check(archive.archive.resources.filter(r=>r.manifest.content.entry?.sceneInstall).length===1,'SOURCE_LIBRARY_POSITION_REQUIRES_SINGLE_INSTANCE');
          totalBytes+=archive.bytes.length;totalPayload+=archive.archive.packageJson.files.reduce((sum,file)=>sum+file.bytes,0);
          if(group)check(totalBytes<=6*1024*1024&&totalPayload<=6*1024*1024,'SOURCE_LIBRARY_GROUP_TOO_LARGE_INSTALL_SEPARATELY');
          items.push({ref,archiveSha256:archive.archive.archiveSha256,displayName:archive.record.version_.displayName,...(placed?{position:placed}:{}),...boundsFields(item.positionBounds)});
          archives.push({archiveBase64:archive.bytes.toString('base64'),...(placed?{position:placed}:{}),...boundsFields(item.positionBounds)});summaries.push(describe(ref,archive));
        }
        if(!proposal){
          const source=await call('godotProject.index',{context,worldId,offset:0,limit:1});
          check(source.worldId===worldId&&Number.isSafeInteger(source.revision)&&/^[a-f0-9]{64}$/.test(source.manifestHash),'SOURCE_LIBRARY_SOURCE_IDENTITY_REQUIRED');
          proposal={format:group?'craftmine.source-group-proposal/1':'craftmine.source-proposal/1',proposalId,context,worldId,execution:'author',requestHash,
            ...(group?{items}:items[0]),displayName:items.map(item=>item.displayName).join(' + '),source:{revision:source.revision,manifestHash:source.manifestHash}};
          await fs.mkdir(directory,{recursive:true});await persistNew(proposal);
        }
        if(!proposal.result){
          const request={worldId,operationId:proposalId,expectedSource:proposal.source,...(group?{items:archives}:archives[0])};
          const result=await installAuthorSource(request,context,assertActive,group);assertActive();
          check(result.worldId===worldId&&result.applied===false&&/^gjob-[a-f0-9]{64}$/.test(result.job?.jobId)&&Array.isArray(result.instanceIds)&&['check-queued','source-saved-check-blocked'].includes(result.status)&&Number.isSafeInteger(result.source?.revision)&&/^[a-f0-9]{64}$/.test(result.source?.manifestHash),'SOURCE_LIBRARY_INSTALL_RECEIPT_INVALID');
          if(group)check(result.archives?.length===items.length&&result.archives.every((item,index)=>item.archiveSha256===items[index].archiveSha256),'SOURCE_LIBRARY_INSTALL_RECEIPT_INVALID');
          else check(result.archiveSha256===items[0].archiveSha256,'SOURCE_LIBRARY_INSTALL_RECEIPT_INVALID');
          proposal.result=result;await atomic(path.join(directory,proposalId+'.json'),proposal);
        }
        return {format:'craftmine.source-library/1',proposal:projection(proposal),jobId:proposal.result.job.jobId,instanceIds:proposal.result.instanceIds,applied:false,
          source:proposal.result.source,note:'Source installation has started in this author turn. Read this exact job with godot_build_read until settled. Full-auto adoption uses the existing checked-candidate workflow after the turn ends. A queued or passed check is not proof the world is updated; report actual adoption and verify the requested new instance.'};
        })();
        authorPending.set(proposalId,{requestHash,promise});try{return await promise;}finally{authorPending.delete(proposalId);}
      }
      if(args.mode==='propose-group'){
        exact(args,['mode','items']);check(typeof installSourceGroup==='function','SOURCE_LIBRARY_GROUP_UNAVAILABLE');
        check(Array.isArray(args.items)&&args.items.length>=2&&args.items.length<=8,'SOURCE_LIBRARY_INVALID_GROUP');
        const cache=new Map(),items=[],summaries=[];let archiveBytes=0,payloadBytes=0;
        for(const item of args.items){
          exact(item,['ref','position','positionBounds']);const ref=validateAssetRef(item.ref),position=item.position===undefined?undefined:placement(item.position);
          const key=JSON.stringify(ref);if(!cache.has(key))cache.set(key,await readArchive(ref));
          const archive=cache.get(key);check(!archive.worldTemplate,'WORLD_TEMPLATE_REQUIRES_NEW_WORLD');if(position)check(archive.archive.resources.filter(r=>r.manifest.content.entry?.sceneInstall).length===1,'SOURCE_LIBRARY_POSITION_REQUIRES_SINGLE_INSTANCE');
          archiveBytes+=archive.bytes.length;payloadBytes+=archive.archive.packageJson.files.reduce((sum,file)=>sum+file.bytes,0);
          check(archiveBytes<=6*1024*1024&&payloadBytes<=6*1024*1024,'SOURCE_LIBRARY_GROUP_TOO_LARGE_INSTALL_SEPARATELY');
          const summary=describe(ref,archive);if(position)summary.placement={status:'explicit-position',position,capturedPlayerTargetUsed:false};
          summaries.push(summary);items.push({ref,archiveSha256:archive.archive.archiveSha256,displayName:summary.displayName,...(position?{position}:{}),...boundsFields(item.positionBounds)});
        }
        check(typeof toolCallId==='string'&&toolCallId.length>0,'SOURCE_LIBRARY_INVOCATION_REQUIRED');
        const source=await call('godotProject.index',{context,worldId,offset:0,limit:1});
        check(source.worldId===worldId&&Number.isSafeInteger(source.revision)&&/^[a-f0-9]{64}$/.test(source.manifestHash),'SOURCE_LIBRARY_SOURCE_IDENTITY_REQUIRED');
        const proposalId='source-'+hash(JSON.stringify([context,toolCallId])).slice(0,48);
        const proposal={format:'craftmine.source-group-proposal/1',proposalId,context,worldId,items,displayName:items.map(i=>i.displayName).join(' + '),source:{revision:source.revision,manifestHash:source.manifestHash}};
        await fs.mkdir(directory,{recursive:true});
        try{const prior=await load(proposalId);check(JSON.stringify({...prior,result:undefined})===JSON.stringify(proposal),'SOURCE_LIBRARY_PROPOSAL_CONFLICT');return {format:'craftmine.source-library-group/1',items:summaries,proposal:projection(prior),applied:false};}catch(error){if(error.code!=='ENOENT')throw error;}
        await persistNew(proposal);
        return {format:'craftmine.source-library-group/1',items:summaries,proposal:projection(proposal),applied:false};
      }
      check(args.items===undefined,'SOURCE_LIBRARY_INVALID_PARAMS');
      if(args.positionBounds!==undefined){check(args.mode==='propose','SOURCE_LIBRARY_INVALID_PARAMS');validatePositionBounds(args.positionBounds);}
      if(args.position!==undefined){exact(args.position,['x','y','z']);check(args.mode==='propose'&&['x','y','z'].every(key=>Number.isFinite(args.position[key])&&Math.abs(args.position[key])<=80),'SOURCE_LIBRARY_INVALID_POSITION');}
      if(args.mode==='search'){
        await ensureBuiltin();
        check(args.query===undefined||typeof args.query==='string'&&args.query.length<=120,'SOURCE_LIBRARY_INVALID_PARAMS');
        const offset=args.offset??0,limit=args.limit??20;check(Number.isSafeInteger(offset)&&offset>=0&&offset<=4096&&Number.isSafeInteger(limit)&&limit>=1&&limit<=24,'SOURCE_LIBRARY_INVALID_PARAMS');
        const result=await call('asset.search',{scope:'local-library',mediaKind:'package',query:args.query??'',offset,limit});assertActive();
        const snapshot=(result.items??[]).some(item=>item.kind!=='world')?await readSourceSnapshot(call,context,worldId,assertActive):{available:false,reason:'NO_COMPONENT_RESULTS',source:null},items=[];
        for(const item of result.items??[]){
          const ref={assetId:item.assetId,version:item.version,contentHash:item.contentHash};
          if(item.kind==='world'){items.push({...item,archiveRef:ref,readRequest:{mode:'read',ref},action:'create-new-world',targetCompatibility:{status:'not-a-component',installValidationRequired:true}});continue;}
          let targetCompatibility;
          try{if(!snapshot.available)targetCompatibility={status:'unknown',reason:snapshot.reason,source:null,installValidationRequired:true};else{const candidate=await readArchive(ref);assertActive();targetCompatibility=candidate.worldTemplate?{status:'not-a-component',installValidationRequired:true}:assessArchiveForSource(candidate.archive,snapshot);}}
          catch(error){assertActive();targetCompatibility={status:'unknown',reason:preflightErrorCode(error),source:snapshot.source??null,installValidationRequired:true};}
          const {referenceRoles:roles,...refs}=referenceHints(ref);void roles;
          items.push({...item,...refs,targetCompatibility});
        }
        return {format:'craftmine.source-library/1',namespace:'asset-catalog-source-zip',result:{...result,items},referenceRoles:{...referenceRoles},note:'Use readRequest and exact installRef/archiveRef. Root/resource hashes are not catalog installation refs. Source prerequisite hints share one pinned source snapshot; unknown is not compatible. Original search ordering and pagination are preserved; installation revalidates everything.'};
      }
      check(['read','propose'].includes(args.mode),'SOURCE_LIBRARY_INVALID_MODE');
      const ref=validateAssetRef(args.ref),archive=await readArchive(ref),summary=describe(ref,archive);
      if(args.mode==='read'){
        if(archive.worldTemplate)return summary;
        const snapshot=await readSourceSnapshot(call,context,worldId,assertActive);assertActive();
        return {...summary,targetCompatibility:assessArchiveForSource(archive.archive,snapshot)};
      }
      check(!archive.worldTemplate,'WORLD_TEMPLATE_REQUIRES_NEW_WORLD');
      if(args.position)check(archive.archive.resources.filter(r=>r.manifest.content.entry?.sceneInstall).length===1,'SOURCE_LIBRARY_POSITION_REQUIRES_SINGLE_INSTANCE');
      if(args.position)summary.placement={status:'explicit-position',position:{...args.position},capturedPlayerTargetUsed:false};
      check(typeof toolCallId==='string'&&toolCallId.length>0,'SOURCE_LIBRARY_INVOCATION_REQUIRED');
      const source=await call('godotProject.index',{context,worldId,offset:0,limit:1});
      check(source.worldId===worldId&&Number.isSafeInteger(source.revision)&&/^[a-f0-9]{64}$/.test(source.manifestHash),'SOURCE_LIBRARY_SOURCE_IDENTITY_REQUIRED');
      const proposalId='source-'+hash(JSON.stringify([context,toolCallId])).slice(0,48);
      await fs.mkdir(directory,{recursive:true});
      const proposal={format:'craftmine.source-proposal/1',proposalId,context,worldId,ref,archiveSha256:archive.archive.archiveSha256,displayName:summary.displayName,
        source:{revision:source.revision,manifestHash:source.manifestHash},...(args.position?{position:{x:args.position.x,y:args.position.y,z:args.position.z}}:{}),...boundsFields(args.positionBounds)};
      try{const prior=await load(proposalId);check(JSON.stringify({...prior,result:undefined})===JSON.stringify(proposal),'SOURCE_LIBRARY_PROPOSAL_CONFLICT');return {...summary,proposal:projection(prior)};}
      catch(error){if(error.code!=='ENOENT')throw error;}
      await persistNew(proposal);
      return {...summary,proposal:projection(proposal)};
    },
    async proposals(args){exact(args,['worldId']);check(typeof args.worldId==='string','SOURCE_LIBRARY_INVALID_PARAMS');await fs.mkdir(directory,{recursive:true});const names=await fs.readdir(directory),items=[];
      for(const name of names.filter(n=>/^source-[a-f0-9]{48}\.json$/.test(n)).slice(-256)){const p=await load(name.slice(0,-5));if(p.worldId===args.worldId)items.push(projection(p));}
      return {worldId:args.worldId,items,format:'craftmine.source-proposals/1'};
    },
    async installProposal(args){
      exact(args,['worldId','proposalId']);id(args.proposalId);
      const proposal=await load(args.proposalId);check(proposal.worldId===args.worldId,'SOURCE_LIBRARY_WORLD_MISMATCH');
      if(proposal.result)return proposal.result;
      check(proposal.execution!=='author','SOURCE_LIBRARY_AUTHOR_RETRY_REQUIRED');
      if(pending.has(args.proposalId))return pending.get(args.proposalId);
      const run=(async()=>{
        if(proposal.format==='craftmine.source-group-proposal/1'){
          check(typeof installSourceGroup==='function','SOURCE_LIBRARY_GROUP_UNAVAILABLE');
          check(Array.isArray(proposal.items)&&proposal.items.length>=2&&proposal.items.length<=8,'SOURCE_LIBRARY_INVALID_GROUP');
          const items=[],cache=new Map();
          for(const item of proposal.items){
            const key=JSON.stringify(item.ref);if(!cache.has(key))cache.set(key,await readArchive(item.ref));
            const archive=cache.get(key);check(archive.archive.archiveSha256===item.archiveSha256,'SOURCE_LIBRARY_ASSET_CHANGED');
            items.push({archiveBase64:archive.bytes.toString('base64'),...(item.position?{position:placement(item.position)}:{}),...boundsFields(item.positionBounds)});
          }
          const result=await installSourceGroup({worldId:proposal.worldId,operationId:proposal.proposalId,items,expectedSource:proposal.source});
          check(result.worldId===proposal.worldId&&result.applied===false&&Array.isArray(result.archives)&&result.archives.length===proposal.items.length&&result.archives.every((item,index)=>item.archiveSha256===proposal.items[index].archiveSha256),'SOURCE_LIBRARY_INSTALL_RECEIPT_INVALID');
          proposal.result=result;await atomic(path.join(directory,proposal.proposalId+'.json'),proposal);return result;
        }
        const archive=await readArchive(proposal.ref);check(archive.archive.archiveSha256===proposal.archiveSha256,'SOURCE_LIBRARY_ASSET_CHANGED');
        const result=await installSource({worldId:proposal.worldId,operationId:proposal.proposalId,archiveBase64:archive.bytes.toString('base64'),expectedSource:proposal.source,...(proposal.position?{position:proposal.position}:{}),...boundsFields(proposal.positionBounds)});
        check(result.worldId===proposal.worldId&&result.applied===false&&result.archiveSha256===proposal.archiveSha256,'SOURCE_LIBRARY_INSTALL_RECEIPT_INVALID');
        proposal.result=result;await atomic(path.join(directory,proposal.proposalId+'.json'),proposal);return result;
      })().finally(()=>pending.delete(args.proposalId));pending.set(args.proposalId,run);return run;
    },
  };
}
module.exports={createSourceLibraryService};
