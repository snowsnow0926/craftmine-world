// Version-history interfaces for the model tool surface (task M's content
// history) plus the shared change-intent vocabulary.
//
// These tools own no storage and perform no git operation: every call is
// host-bound through an OperationContext, and a write is only ever a proposal a
// player action must confirm. Method names follow the delivered M interface
// (`content.history` / `content.version` / `content.apply.*`); they can be
// overridden by the host when M registers the real dispatch table.
'use strict';

const HISTORY_FORMAT='craftmine.godot-history/1';
const OPERATION_CONTEXT_FIELDS=['operationId','worldId','repoId','branchId','expectedHeadOid','expectedAppliedOid','expectedProgressRevision'];
const EXPECTED_FIELDS=['expectedHeadOid','expectedAppliedOid','expectedProgressRevision'];
// The five changes a player can express in natural language. They are not
// interchangeable: scope, identity and progress behaviour all differ.
const CHANGE_INTENTS=['instance-only','variant','upgrade-selected','restore-content','restore-save'];

const DEFAULT_METHODS={history:'content.history',version:'content.version',diff:'content.diff',
  checkpoint:'content.checkpoint',mergeCandidate:'content.mergeCandidate',operationResult:'content.operationResult'};
const METHOD_OWNERS={history:'M'};
const HASH=/^[a-f0-9]{64}$/;

function fail(code){ throw Object.assign(Error(code),{errorCode:code}); }
function isPlain(value){ return value!==null&&typeof value==='object'&&!Array.isArray(value); }

// ---- contract validation (pure) -----------------------------------------

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

// Every field must be present. The three expected* values may be null, but the
// host must supply the key so a missing expectation is never read as "no check".
function validateOperationContext(context,hostBinding){
  if(!isPlain(context))fail('INVALID_OPERATION_CONTEXT');
  const bound={};
  for(const field of OPERATION_CONTEXT_FIELDS){
    if(!Object.hasOwn(context,field))fail('OPERATION_CONTEXT_REQUIRES:'+field);
    const value=context[field];
    if(value===null&&EXPECTED_FIELDS.includes(field)){bound[field]=null;continue;}
    if(value===null||value===undefined)fail('OPERATION_CONTEXT_REQUIRES:'+field);
    if(typeof value!=='string'&&typeof value!=='number')fail('INVALID_OPERATION_CONTEXT_FIELD:'+field);
    if(typeof value==='string'&&(!value.trim()||value.length>240||/[\x00-\x1f]/.test(value)))fail('INVALID_OPERATION_CONTEXT_FIELD:'+field);
    bound[field]=value;
  }
  for(const field of ['operationId','worldId'])if(!bound[field])fail('OPERATION_CONTEXT_REQUIRES:'+field);
  if(hostBinding&&hostBinding.worldId&&bound.worldId!==hostBinding.worldId)fail('OPERATION_CONTEXT_WORLD_MISMATCH');
  return bound;
}

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
  if(intent==='upgrade-selected'){
    if(!selected.length)fail('UPGRADE_SELECTED_REQUIRES_SELECTION');
    return {intent,instances:selected,scope:'all-selected',createsVariant:false,appliesToSelected:true,
      requiresPlayerAction:true,applies:false,
      note:'Each selected instance must be checked for compatibility; a pass for one instance does not transfer to another.'};
  }
  if(intent==='restore-content'){
    if(selected.length!==1)fail('RESTORE_CONTENT_REQUIRES_EXACTLY_ONE_INSTANCE');
    return {intent,instances:selected,scope:'restore-instance',createsVariant:false,appliesToSelected:false,
      requiresPlayerAction:true,applies:false,
      note:'Restores one package instance; later history and world progress are kept.'};
  }
  return {intent,instances:selected,scope:'restore-progress',createsVariant:false,appliesToSelected:false,
    requiresPlayerAction:true,applies:false,
    note:'Restoring confirmed world progress is a player action over a verified backup.'};
}

// ---- host-bound service --------------------------------------------------

function createHistoryService({core,context,workspace,methods={}}){
  if(!core||typeof core.call!=='function')throw Error('CORE_REQUIRED');
  const table={...DEFAULT_METHODS,...methods};
  const worldId=workspace?.worldId;
  if(typeof worldId!=='string'||!worldId)throw Error('WORLD_ID_REQUIRED');
  const binding=workspace.task?.binding||{};

  function operationContext(operationId){
    const candidate={
      operationId,
      worldId,
      repoId:binding.repoId??workspace.repoId??null,
      branchId:binding.branchId??workspace.branchId??null,
      expectedHeadOid:binding.expectedHeadOid??workspace.expectedHeadOid??null,
      expectedAppliedOid:binding.expectedAppliedOid??workspace.expectedAppliedOid??null,
      expectedProgressRevision:binding.expectedProgressRevision??workspace.expectedProgressRevision??null
    };
    try { return {ok:true,context:validateOperationContext(candidate,{worldId})}; }
    catch(error){
      // A world with no content repository yet has no branch identity. Report
      // that gap instead of failing the whole tool or inventing a branch.
      return {ok:false,code:error?.errorCode||error?.message,
        missing:OPERATION_CONTEXT_FIELDS.filter(field=>candidate[field]===null||candidate[field]===undefined)};
    }
  }

  async function probe(key,params){
    const method=table[key];
    if(params.operationContext&&params.operationContext.ok===false){
      return {format:HISTORY_FORMAT,method,available:false,reason:'OPERATION_CONTEXT_INCOMPLETE',
        code:params.operationContext.code,missing:params.operationContext.missing,owner:METHOD_OWNERS.history,
        nextStep:'The host must bind repository and branch identity for this world before content history can be read.'};
    }
    const body={...params,...(params.operationContext?{operationContext:params.operationContext.context}:{})};
    // The OperationContext already carries the host-bound world identity; no
    // extra worldId is sent, so a future deny_unknown_fields RPC stays valid.
    try { return {format:HISTORY_FORMAT,method,available:true,result:await core.call(method,body)}; }
    catch(error){
      if(error?.errorCode==='UNKNOWN_METHOD')return {format:HISTORY_FORMAT,method,available:false,
        reason:'DEPENDENCY_NOT_WIRED',requiredHostMethod:method,owner:METHOD_OWNERS.history,proposedName:true,
        nextStep:'The '+METHOD_OWNERS.history+' adapter must register '+method+' before this capability is usable; the model must not invent history.'};
      throw error;
    }
  }

  function propose(key,params){
    const bound=operationContext(params.operationId||('proposal-'+key));
    return {format:HISTORY_FORMAT,proposal:key,method:table[key],
      operationContext:bound.ok?bound.context:null,
      ...(bound.ok?{}:{contextGap:{reason:'OPERATION_CONTEXT_INCOMPLETE',code:bound.code,missing:bound.missing}}),
      params,applies:false,requiresPlayerAction:true,gitWriteOwner:METHOD_OWNERS.history,
      note:'The model proposes; the host performs any git or file write under its own identity.'};
  }

  return {
    operationContext,
    history:({cursor,limit=20}={})=>probe('history',{operationContext:operationContext('history-query'),cursor:cursor??null,limit}),
    version:({contentRef}={})=>probe('version',{operationContext:operationContext('version-read'),contentRef:validateContentRef(contentRef)}),
    diff:({from,to}={})=>probe('diff',{operationContext:operationContext('version-diff'),
      from:validateContentRef(from),to:validateContentRef(to)}),
    checkpoint:({contentRef,label}={})=>propose('checkpoint',{contentRef:validateContentRef(contentRef),label}),
    mergeCandidate:({from,to}={})=>propose('mergeCandidate',{from:validateContentRef(from),to:validateContentRef(to)}),
    operationResult:({operationId}={})=>probe('operationResult',{operationContext:operationContext(operationId)})
  };
}

module.exports={HISTORY_FORMAT,OPERATION_CONTEXT_FIELDS,EXPECTED_FIELDS,CHANGE_INTENTS,DEFAULT_METHODS,METHOD_OWNERS,
  validateFileRef,validateContentRef,validateOperationContext,validateChangeIntent,createHistoryService};
