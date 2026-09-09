// Version-history and asset-reference interfaces for the model tool surface.
//
// These tools are the model-facing half of the version-management (V01-V16) and
// asset-library (AL-A01-AL-A17) contracts. They own no storage and perform no
// git operation: every call is host-bound through an OperationContext, and a
// write is only ever a proposal that a player action must confirm.
//
// The Rust adapters that back them are owned by M and N and are not registered
// yet. When a method is missing, the tool reports the exact dependency instead
// of returning invented history. Method names below are this task's proposal
// and can be overridden by the host when M/N register theirs.
'use strict';

const HISTORY_FORMAT='craftmine.godot-history/1';
const OPERATION_CONTEXT_FIELDS=['operationId','worldId','repoId','branchId','expectedHeadOid','expectedAppliedOid','expectedProgressRevision'];
const CHANGE_INTENTS=['instance-only','variant','upgrade-selected'];

// Proposed host methods. `owner` is the single write-responsible subsystem.
const DEFAULT_METHODS={
  history:'version.history',version:'version.read',diff:'version.diff',checkpoint:'version.checkpoint',
  mergeCandidate:'version.mergeCandidate',operationResult:'version.operationResult',
  assetSearch:'asset.search',assetRead:'asset.read',assetInstallProposal:'asset.installProposal',
  assetUpgradeProposal:'asset.upgradeProposal'
};
const METHOD_OWNERS={version:'M',asset:'N'};

const HASH=/^[a-f0-9]{64}$/;

function fail(code){ throw Object.assign(Error(code),{errorCode:code}); }
function isPlain(value){ return value!==null&&typeof value==='object'&&!Array.isArray(value); }

// ---- contract validation (pure) -----------------------------------------

function validateAssetRef(ref){
  if(!isPlain(ref))fail('INVALID_ASSET_REF');
  const keys=Object.keys(ref).sort();
  if(keys.join(',')!=='assetId,contentHash,version')fail('INVALID_ASSET_REF_FIELDS');
  if(typeof ref.assetId!=='string'||!ref.assetId.trim()||ref.assetId.length>120)fail('INVALID_ASSET_ID');
  if(!Number.isSafeInteger(ref.version)||ref.version<1)fail('INVALID_ASSET_VERSION');
  if(ref.assetId==='latest'||ref.assetId==='*'||ref.contentHash==='latest')fail('ASSET_REF_MUST_NOT_BE_LATEST');
  if(typeof ref.contentHash!=='string'||!HASH.test(ref.contentHash))fail('INVALID_ASSET_CONTENT_HASH');
  return {assetId:ref.assetId,version:ref.version,contentHash:ref.contentHash};
}

function validateFileRef(ref){
  if(!isPlain(ref))fail('INVALID_FILE_REF');
  if(typeof ref.path!=='string'||!ref.path||ref.path.length>240||ref.path.startsWith('/')||ref.path.includes('..')
    ||ref.path.includes('\\')||ref.path.includes(':')||ref.path.split('/').some(part=>!part||part==='.'))fail('INVALID_FILE_REF_PATH');
  if(typeof ref.sha256!=='string'||!HASH.test(ref.sha256))fail('INVALID_FILE_REF_HASH');
  if(!Number.isSafeInteger(ref.bytes)||ref.bytes<0)fail('INVALID_FILE_REF_BYTES');
  if(typeof ref.mediaType!=='string'||!ref.mediaType||ref.mediaType.length>120)fail('INVALID_FILE_REF_MEDIA_TYPE');
  return {path:ref.path,sha256:ref.sha256,bytes:ref.bytes,mediaType:ref.mediaType};
}

function validateContentRef(ref){
  if(!isPlain(ref))fail('INVALID_CONTENT_REF');
  // A git object id is not assumed to be 40 characters.
  if(typeof ref.repoId!=='string'||!ref.repoId||ref.repoId.length>120)fail('INVALID_REPO_ID');
  if(typeof ref.commitOid!=='string'||!/^[a-f0-9]{7,64}$/.test(ref.commitOid))fail('INVALID_COMMIT_OID');
  if(typeof ref.assetLockHash!=='string'||!HASH.test(ref.assetLockHash))fail('INVALID_ASSET_LOCK_HASH');
  return {repoId:ref.repoId,commitOid:ref.commitOid,assetLockHash:ref.assetLockHash};
}

function validateOperationContext(context,hostBinding){
  if(!isPlain(context))fail('INVALID_OPERATION_CONTEXT');
  const bound={};
  for(const field of OPERATION_CONTEXT_FIELDS){
    const value=context[field];
    if(value===undefined||value===null)continue;
    if(typeof value!=='string'&&typeof value!=='number')fail('INVALID_OPERATION_CONTEXT_FIELD:'+field);
    if(typeof value==='string'&&(!value.trim()||value.length>240||/[\x00-\x1f]/.test(value)))fail('INVALID_OPERATION_CONTEXT_FIELD:'+field);
    bound[field]=value;
  }
  for(const field of ['operationId','worldId'])if(!bound[field])fail('OPERATION_CONTEXT_REQUIRES:'+field);
  if(hostBinding&&hostBinding.worldId&&bound.worldId!==hostBinding.worldId)fail('OPERATION_CONTEXT_WORLD_MISMATCH');
  return bound;
}

// The three-way distinction the player expresses in natural language. The tool
// validates the choice; it never widens the selection on the model's behalf.
function validateChangeIntent({intent,selection,target}={}){
  if(!CHANGE_INTENTS.includes(intent))fail('INVALID_CHANGE_INTENT:'+CHANGE_INTENTS.join('|'));
  const selected=Array.isArray(selection)?selection:[];
  if(intent==='instance-only'){
    if(selected.length!==1)fail('INSTANCE_ONLY_REQUIRES_EXACTLY_ONE_INSTANCE');
    return {intent,instances:selected,scope:'one-instance',createsVariant:false,appliesToSelected:false,
      requiresPlayerAction:true,applies:false};
  }
  if(intent==='variant'){
    if(!target||typeof target.name!=='string'||!target.name.trim()||target.name.length>120)fail('VARIANT_REQUIRES_NAME');
    return {intent,instances:selected,scope:'new-variant',createsVariant:true,appliesToSelected:false,
      requiresPlayerAction:true,applies:false};
  }
  if(!selected.length)fail('UPGRADE_SELECTED_REQUIRES_SELECTION');
  return {intent,instances:selected,scope:'all-selected',createsVariant:false,appliesToSelected:true,
    requiresPlayerAction:true,applies:false,
    note:'Each selected instance must be checked for compatibility; a pass for one instance does not transfer to another.'};
}

// ---- host-bound service --------------------------------------------------

function createHistoryService({core,context,workspace,methods={}}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  const table={...DEFAULT_METHODS,...methods};
  const worldId=workspace?.worldId;
  if(typeof worldId!=='string'||!worldId)throw Error('WORLD_ID_REQUIRED');

  function operationContext(operationId){
    const binding=workspace.task?.binding||{};
    return validateOperationContext({
      operationId,
      worldId,
      repoId:binding.repoId??workspace.repoId,
      branchId:binding.branchId??workspace.branchId,
      expectedHeadOid:binding.expectedHeadOid??workspace.expectedHeadOid,
      expectedAppliedOid:binding.expectedAppliedOid??workspace.expectedAppliedOid,
      expectedProgressRevision:binding.expectedProgressRevision??workspace.expectedProgressRevision
    },{worldId});
  }

  async function probe(key,params){
    const method=table[key];
    const owner=METHOD_OWNERS[key.startsWith('asset')?'asset':'version'];
    try { return {available:true,method,result:await core.call(method,{...params,worldId})}; }
    catch(error){
      if(error?.errorCode==='UNKNOWN_METHOD')return {available:false,reason:'DEPENDENCY_NOT_WIRED',requiredHostMethod:method,
        owner,proposedName:true,
        nextStep:'The '+owner+' adapter must register '+method+' before this capability is usable; the model must not invent history or asset content.'};
      throw error;
    }
  }

  return {
    operationContext,
    history:({cursor,limit=20}={})=>probe('history',{operationContext:operationContext('history-query'),cursor:cursor??null,limit}),
    version:({contentRef}={})=>probe('version',{operationContext:operationContext('version-read'),contentRef:validateContentRef(contentRef)}),
    diff:({from,to}={})=>probe('diff',{operationContext:operationContext('version-diff'),
      from:validateContentRef(from),to:validateContentRef(to)}),
    checkpoint:({contentRef,label}={})=>propose('checkpoint',{contentRef:validateContentRef(contentRef),label}),
    mergeCandidate:({from,to}={})=>propose('mergeCandidate',{from:validateContentRef(from),to:validateContentRef(to)}),
    operationResult:({operationId}={})=>probe('operationResult',{operationContext:operationContext(operationId)}),
    assetSearch:({query,baseId,engineVersion,limit=10}={})=>probe('assetSearch',{query,baseId:baseId??null,
      engineVersion:engineVersion??null,limit}),
    assetRead:({ref}={})=>probe('assetRead',{ref:validateAssetRef(ref)}),
    assetInstallProposal:({ref,intent='instance-only',selection,target}={})=>propose('assetInstallProposal',
      {ref:validateAssetRef(ref),change:validateChangeIntent({intent,selection:selection??[],target})}),
    assetUpgradeProposal:({ref,selection,intent='upgrade-selected',target}={})=>propose('assetUpgradeProposal',
      {ref:validateAssetRef(ref),change:validateChangeIntent({intent,selection,target})})
  };

  // A write is a proposal carrying the host-bound operation identity. It is
  // idempotent by operationId and never applied by the model.
  function propose(key,params){
    const method=table[key];
    const operationContext=validateOperationContext({operationId:params.operationId||('proposal-'+key),
      worldId,repoId:workspace.task?.binding?.repoId??workspace.repoId,
      branchId:workspace.task?.binding?.branchId??workspace.branchId}, {worldId});
    return {format:HISTORY_FORMAT,proposal:key,method,operationContext,params,applies:false,requiresPlayerAction:true,
      gitWriteOwner:METHOD_OWNERS[key.startsWith('asset')?'asset':'version'],
      note:'The model proposes; the host performs any git or file write under its own identity.'};
  }
}

module.exports={HISTORY_FORMAT,OPERATION_CONTEXT_FIELDS,CHANGE_INTENTS,DEFAULT_METHODS,METHOD_OWNERS,
  validateAssetRef,validateFileRef,validateContentRef,validateOperationContext,validateChangeIntent,createHistoryService};
