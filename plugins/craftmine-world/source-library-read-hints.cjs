'use strict';
const {assessRequirements}=require('./world-composition.cjs');
const {configurationHint}=require('./source-configuration.cjs');
const {enrichCompanionSourceFiles}=require('./companion-root-binding.mjs');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw Error(code);};
const code=error=>error?.errorCode??error?.code??(/^[A-Z][A-Z0-9_]+$/.test(error?.message??'')?error.message:'SOURCE_LIBRARY_PREFLIGHT_UNAVAILABLE');

const referenceRoles={archiveRef:'Exact catalog AssetRef for source-library read/install/install-group/propose. contentHash identifies the catalog archive record.',installRef:'Use this unchanged as ref or items[].ref. It is the same catalog identity as archiveRef, not installation authority.',rootRef:'Inner package resource identity; never substitute its sha256 into catalog ref.contentHash.',resourceRefs:'resources[].ref identifies inner resource content, not the installable catalog archive.'};
function referenceHints(ref){return {archiveRef:{...ref},installRef:{...ref},readRequest:{mode:'read',ref:{...ref}},referenceRoles:{...referenceRoles}};}

function archiveInstallation(archive){
  const resources=archive.resources.map(({manifest})=>{
    const content=manifest.content,entry=content.entry??{},spec=entry.sceneInstall;
    if(!spec)return {resourceId:content.assetId,status:['object','scene','module'].includes(content.kind)?'missing-declaration':'not-instantiated'};
    const entities=entry.entities??[],supported=Array.isArray(entities)&&entities.length===1;
    return {resourceId:content.assetId,version:content.version,status:supported?'single-instance-declared':'blocked-declaration',declaredEntities:entities,
      automaticInstance:supported?{entity:entities[0],...spec}:null,
      ...(entry.installationGuide?{behaviorSetup:entry.installationGuide}:{}),
      ...(!supported?{reason:'PACKAGE_SINGLE_ENTITY_DECLARATION_REQUIRED',parameterChangeCanFix:false,
        recovery:{searchRequest:{mode:'search',query:content.assetId},instructions:'This archive does not declare exactly one entity identity for its sceneInstall, which the installer cannot materialize. Changing position, grouping copies, or inventing entity/request parameters cannot fix this archive. Read a corrected immutable version whose declaration matches its actual automatic instance. After installing that version, use returned source paths with godot_project_index/godot_file_read and ordinary godot_project_patch for any explicitly required helper nodes, then check and adopt. No nodes or source files were installed by this declaration refusal.'}}:{})};
  });
  return {scope:'archive-scene-install-declarations',status:resources.some(r=>['blocked-declaration','missing-declaration'].includes(r.status))?'blocked-declaration':'declared',resources,installValidationRequired:true,runtimeVerified:false};
}

async function readSourceSnapshot(call,context,worldId,assertActive){
  try{
    const files=new Map();let identity,offset=0;
    do{
      assertActive();const page=await call('godotProject.index',{context,worldId,offset,limit:32,...(identity?{revision:identity.revision,manifestHash:identity.manifestHash}:{})});assertActive();
      if(page.worldId!==worldId||!Number.isSafeInteger(page.revision)||!hash(page.manifestHash)||!Array.isArray(page.files))fail('SOURCE_LIBRARY_SOURCE_IDENTITY_REQUIRED');
      identity??=page;if(page.revision!==identity.revision||page.manifestHash!==identity.manifestHash)fail('SOURCE_LIBRARY_PREFLIGHT_SOURCE_CHANGED');
      for(const file of page.files){if(typeof file.path!=='string'||!hash(file.sha256)||files.has(file.path))fail('SOURCE_LIBRARY_PREFLIGHT_INDEX_INVALID');files.set(file.path,file);}
      if(files.size>8192)fail('SOURCE_LIBRARY_PREFLIGHT_INDEX_TOO_LARGE');
      if(page.nextOffset!=null&&(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset))fail('SOURCE_LIBRARY_PREFLIGHT_INDEX_INVALID');offset=page.nextOffset;
    }while(offset!=null);
    await enrichCompanionSourceFiles(call,context,worldId,identity,files,assertActive);
    return {available:true,files,source:{worldId,revision:identity.revision,manifestHash:identity.manifestHash,baseId:identity.baseId??null,engineVersion:identity.engineVersion??null}};
  }catch(error){assertActive();return {available:false,reason:code(error),source:null};}
}

function assessArchiveForSource(archive,snapshot){
  const common={scope:'declared-source-prerequisites-only',installValidationRequired:true,runtimeVerified:false,source:snapshot.source??null,automaticInstallation:archiveInstallation(archive)};
  if(!snapshot.available)return {...common,status:common.automaticInstallation.status==='blocked-declaration'?'installation-declaration-blocked':'unknown',sourcePrerequisitesStatus:'unknown',reason:snapshot.reason};
  try{
    const resources=archive.resources.map(({manifest})=>{
      const content=manifest.content,declared=content.compatibility??{},requirements=assessRequirements(content.entry??{},snapshot.files);
      const base=typeof declared.base==='string'&&snapshot.source.baseId?declared.base===snapshot.source.baseId?'matched':'different':'unknown';
      const engine=typeof declared.engine==='string'&&snapshot.source.engineVersion?declared.engine===snapshot.source.engineVersion?'matched':'different':'unknown';
      const configuration=configurationHint(content,snapshot.files,snapshot.source);
      return {resourceId:content.assetId,base,engine,declaredBaseVersion:declared.baseVersion??null,baseVersionCheck:'not-assessed',requirements,...(configuration?{configuration}:{})};
    });
    const mismatch=resources.some(row=>row.base==='different'||row.engine==='different'||row.requirements.status!=='source-requirements-matched');
    const known=resources.length>0&&resources.every(row=>row.base==='matched'&&row.engine==='matched');
    const sourcePrerequisitesStatus=mismatch?'adaptation-required':known?'source-prerequisites-matched':'unknown';
    const unconfigured=resources.some(row=>row.configuration&&row.configuration.kind!=='legacy-companion-range'&&row.configuration.status!=='configuration-planned');
    return {...common,status:common.automaticInstallation.status==='blocked-declaration'?'installation-declaration-blocked':sourcePrerequisitesStatus==='source-prerequisites-matched'&&unconfigured?'configuration-required':sourcePrerequisitesStatus,sourcePrerequisitesStatus,resources,
      note:'Pinned source prerequisite comparison only. Base version, package dependencies, installation conflicts, placement, runtime behavior and adoption still require ordinary installer/check validation. Prefer matched prerequisites among actual search results; do not bypass mismatches or guess an unlisted version.'};
  }catch(error){return {...common,status:'unknown',reason:code(error)};}
}
module.exports={referenceRoles,referenceHints,archiveInstallation,readSourceSnapshot,assessArchiveForSource,preflightErrorCode:code};
