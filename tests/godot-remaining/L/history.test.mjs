// Version-history and change-intent contract tests.
// No engine, no Rust binary, no git, no shell, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {validateFileRef,validateContentRef,validateOperationContext,validateChangeIntent,
  createHistoryService,DEFAULT_METHODS,CHANGE_INTENTS,OPERATION_CONTEXT_FIELDS}=
  require(path.join(root,'plugins/craftmine-world/godot-history.cjs'));

const HASH='a'.repeat(64);
const CONTEXT={projectId:'p',sessionId:'s',turnId:'t'};
const FULL={operationId:'op-1',worldId:'alpha',repoId:'world-alpha',branchId:'plan-7',
  expectedHeadOid:'abc1234',expectedAppliedOid:'def5678',expectedProgressRevision:12};

test('file and content references reject host paths and assume no fixed OID length',()=>{
  assert.equal(validateFileRef({path:'scenes/world.tscn',sha256:HASH,bytes:10,mediaType:'text/plain'}).bytes,10);
  assert.throws(()=>validateFileRef({path:'../escape.gd',sha256:HASH,bytes:1,mediaType:'text/plain'}),/INVALID_FILE_REF_PATH/);
  assert.throws(()=>validateFileRef({path:'C:/escape.gd',sha256:HASH,bytes:1,mediaType:'text/plain'}),/INVALID_FILE_REF_PATH/);
  const short=validateContentRef({repoId:'world-alpha',commitOid:'abc1234',assetLockHash:HASH});
  assert.equal(short.commitOid,'abc1234');
  assert.throws(()=>validateContentRef({repoId:'w',commitOid:'z'.repeat(40),assetLockHash:HASH}),/INVALID_COMMIT_OID/);
});

test('the operation context is host-bound and every field must be present',()=>{
  const bound=validateOperationContext(FULL,{worldId:'alpha'});
  assert.equal(bound.worldId,'alpha');
  assert.equal(bound.expectedProgressRevision,12);
  // The expected* keys may be null, but the host must supply the key.
  const nulls=validateOperationContext({...FULL,expectedHeadOid:null,expectedAppliedOid:null,expectedProgressRevision:null},{worldId:'alpha'});
  assert.equal(nulls.expectedHeadOid,null);
  for(const field of OPERATION_CONTEXT_FIELDS){
    const missing={...FULL};
    delete missing[field];
    assert.throws(()=>validateOperationContext(missing,{worldId:'alpha'}),new RegExp('OPERATION_CONTEXT_REQUIRES:'+field));
  }
  assert.throws(()=>validateOperationContext({...FULL,worldId:'beta'},{worldId:'alpha'}),/OPERATION_CONTEXT_WORLD_MISMATCH/);
  assert.throws(()=>validateOperationContext({...FULL,branchId:'bad\u0001'}),/INVALID_OPERATION_CONTEXT_FIELD:branchId/);
});

test('natural language maps to five distinct change scopes',()=>{
  const one=validateChangeIntent({intent:'instance-only',selection:['alpha']});
  assert.equal(one.scope,'one-instance');
  assert.equal(one.createsVariant,false);
  assert.equal(one.appliesToSelected,false);
  assert.equal(one.applies,false);
  assert.throws(()=>validateChangeIntent({intent:'instance-only',selection:['alpha','beta']}),/INSTANCE_ONLY_REQUIRES_EXACTLY_ONE_INSTANCE/);
  const variant=validateChangeIntent({intent:'variant',selection:['alpha'],target:{name:'alpha-hard-mode'}});
  assert.equal(variant.createsVariant,true);
  assert.equal(variant.appliesToSelected,false);
  assert.throws(()=>validateChangeIntent({intent:'variant',selection:['alpha']}),/VARIANT_REQUIRES_NAME/);
  const all=validateChangeIntent({intent:'upgrade-selected',selection:['alpha','beta']});
  assert.equal(all.appliesToSelected,true);
  assert.equal(all.requiresPlayerAction,true);
  assert.throws(()=>validateChangeIntent({intent:'upgrade-selected',selection:[]}),/UPGRADE_SELECTED_REQUIRES_SELECTION/);
  const content=validateChangeIntent({intent:'restore-content',selection:['ins-1']});
  assert.equal(content.scope,'restore-instance');
  assert.throws(()=>validateChangeIntent({intent:'restore-content',selection:['a','b']}),/RESTORE_CONTENT_REQUIRES_EXACTLY_ONE_INSTANCE/);
  const save=validateChangeIntent({intent:'restore-save'});
  assert.equal(save.scope,'restore-progress');
  assert.equal(save.requiresPlayerAction,true);
  assert.throws(()=>validateChangeIntent({intent:'whatever'}),/INVALID_CHANGE_INTENT/);
  assert.deepEqual(CHANGE_INTENTS,['instance-only','variant','upgrade-selected','restore-content','restore-save']);
});

function workspace(){
  return {worldId:'alpha',task:{binding:{repoId:'world-alpha',branchId:'plan-7',expectedHeadOid:'abc1234',
    expectedAppliedOid:'def5678',expectedProgressRevision:12}}};
}

test('a missing adapter is reported with its exact method and owner',async()=>{
  const core={call:async()=>{throw Object.assign(Error('UNKNOWN_METHOD'),{errorCode:'UNKNOWN_METHOD'});}};
  const service=createHistoryService({core,context:CONTEXT,workspace:workspace()});
  const history=await service.history({});
  assert.equal(history.available,false);
  assert.equal(history.reason,'DEPENDENCY_NOT_WIRED');
  assert.equal(history.requiredHostMethod,DEFAULT_METHODS.history);
  assert.equal(history.requiredHostMethod,'content.history');
  assert.equal(history.owner,'M');
  assert.match(history.nextStep,/must register/);
});

test('a registered adapter is used directly and the context is host-bound',async()=>{
  const calls=[];
  const core={call:async(method,params)=>{calls.push({method,params});
    return {items:[{commitOid:'abc1234',summary:'add shop'}]};}};
  const service=createHistoryService({core,context:CONTEXT,workspace:workspace()});
  const result=await service.history({limit:5});
  assert.equal(result.available,true);
  assert.equal(result.method,'content.history');
  assert.equal(calls[0].method,'content.history');
  assert.equal(calls[0].params.operationContext.worldId,'alpha');
  assert.equal(calls[0].params.operationContext.branchId,'plan-7');
  assert.equal(calls[0].params.operationContext.expectedProgressRevision,12);
  assert.ok(!('worldId' in calls[0].params),'no extra worldId beside the OperationContext');
});

test('a checkpoint or merge proposal is never an application and never performs git',()=>{
  const calls=[];
  const core={call:async(method,params)=>{calls.push({method,params});return {};}};
  const service=createHistoryService({core,context:CONTEXT,workspace:workspace()});
  const proposal=service.checkpoint({contentRef:{repoId:'world-alpha',commitOid:'abc1234',assetLockHash:HASH},label:'before shop'});
  assert.equal(proposal.applies,false);
  assert.equal(proposal.requiresPlayerAction,true);
  assert.equal(proposal.gitWriteOwner,'M');
  assert.equal(proposal.operationContext.worldId,'alpha');
  assert.deepEqual(calls,[],'a proposal must not call the host at all');
});

test('an invalid reference is rejected before any host call',async()=>{
  const calls=[];
  const core={call:async(method)=>{calls.push(method);return {};}};
  const service=createHistoryService({core,context:CONTEXT,workspace:workspace()});
  await assert.rejects(async()=>service.version({contentRef:{repoId:'w',commitOid:'zz',assetLockHash:HASH}}),/INVALID_COMMIT_OID/);
  assert.deepEqual(calls,[]);
});
