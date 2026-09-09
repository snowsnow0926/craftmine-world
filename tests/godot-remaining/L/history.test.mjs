// Version-history and asset-reference contract tests.
// No engine, no Rust binary, no git, no shell, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
const {validateAssetRef,validateFileRef,validateContentRef,validateOperationContext,validateChangeIntent,
  createHistoryService,DEFAULT_METHODS,OPERATION_CONTEXT_FIELDS}=
  require(path.join(root,'plugins/craftmine-world/godot-history.cjs'));

const HASH='a'.repeat(64);
const CONTEXT={projectId:'p',sessionId:'s',turnId:'t'};

test('an asset reference must name an exact immutable version',()=>{
  assert.deepEqual(validateAssetRef({assetId:'shop-kit',version:3,contentHash:HASH}),
    {assetId:'shop-kit',version:3,contentHash:HASH});
  assert.throws(()=>validateAssetRef({assetId:'shop-kit',version:3,contentHash:HASH,extra:1}),/INVALID_ASSET_REF_FIELDS/);
  assert.throws(()=>validateAssetRef({assetId:'latest',version:1,contentHash:HASH}),/ASSET_REF_MUST_NOT_BE_LATEST/);
  assert.throws(()=>validateAssetRef({assetId:'x',version:0,contentHash:HASH}),/INVALID_ASSET_VERSION/);
  assert.throws(()=>validateAssetRef({assetId:'x',version:1,contentHash:'nope'}),/INVALID_ASSET_CONTENT_HASH/);
});

test('file and content references reject host paths and assume no fixed OID length',()=>{
  assert.equal(validateFileRef({path:'scenes/world.tscn',sha256:HASH,bytes:10,mediaType:'text/plain'}).bytes,10);
  assert.throws(()=>validateFileRef({path:'../escape.gd',sha256:HASH,bytes:1,mediaType:'text/plain'}),/INVALID_FILE_REF_PATH/);
  assert.throws(()=>validateFileRef({path:'C:/escape.gd',sha256:HASH,bytes:1,mediaType:'text/plain'}),/INVALID_FILE_REF_PATH/);
  const short=validateContentRef({repoId:'world-alpha',commitOid:'abc1234',assetLockHash:HASH});
  assert.equal(short.commitOid,'abc1234');
  assert.throws(()=>validateContentRef({repoId:'w',commitOid:'z'.repeat(40),assetLockHash:HASH}),/INVALID_COMMIT_OID/);
});

test('the operation context is host-bound and must carry identity',()=>{
  const bound=validateOperationContext({operationId:'op-1',worldId:'alpha',branchId:'plan-7',
    expectedHeadOid:'abc1234',expectedProgressRevision:12},{worldId:'alpha'});
  assert.equal(bound.worldId,'alpha');
  assert.equal(bound.expectedProgressRevision,12);
  assert.throws(()=>validateOperationContext({worldId:'alpha'}),/OPERATION_CONTEXT_REQUIRES:operationId/);
  assert.throws(()=>validateOperationContext({operationId:'op-1'}),/OPERATION_CONTEXT_REQUIRES:worldId/);
  assert.throws(()=>validateOperationContext({operationId:'op-1',worldId:'beta'},{worldId:'alpha'}),/OPERATION_CONTEXT_WORLD_MISMATCH/);
  assert.throws(()=>validateOperationContext({operationId:'op-1',worldId:'alpha',branchId:'bad\u0001'}),/INVALID_OPERATION_CONTEXT_FIELD:branchId/);
  assert.ok(OPERATION_CONTEXT_FIELDS.includes('expectedAppliedOid'));
});

test('natural language maps to three distinct change scopes',()=>{
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
  assert.throws(()=>validateChangeIntent({intent:'whatever'}),/INVALID_CHANGE_INTENT/);
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
  assert.equal(history.owner,'M');
  assert.equal(history.proposedName,true);
  assert.match(history.nextStep,/must register/);
  const assets=await service.assetSearch({query:'shop'});
  assert.equal(assets.owner,'N');
  assert.equal(assets.requiredHostMethod,DEFAULT_METHODS.assetSearch);
});

test('a registered adapter is used directly and the context is host-bound',async()=>{
  const calls=[];
  const core={call:async(method,params)=>{calls.push({method,params});
    return {items:[{commitOid:'abc1234',summary:'add shop'}]};}};
  const service=createHistoryService({core,context:CONTEXT,workspace:workspace()});
  const result=await service.history({limit:5});
  assert.equal(result.available,true);
  assert.equal(result.method,'version.history');
  assert.equal(calls[0].method,'version.history');
  assert.equal(calls[0].params.worldId,'alpha');
  assert.equal(calls[0].params.operationContext.worldId,'alpha');
  assert.equal(calls[0].params.operationContext.branchId,'plan-7');
  assert.equal(calls[0].params.operationContext.expectedProgressRevision,12);
});

test('a proposal is never an application and never performs git',()=>{
  const calls=[];
  const core={call:async(method,params)=>{calls.push({method,params});return {};}};
  const service=createHistoryService({core,context:CONTEXT,workspace:workspace()});
  const proposal=service.assetInstallProposal({ref:{assetId:'shop-kit',version:2,contentHash:HASH}});
  assert.equal(proposal.applies,false);
  assert.equal(proposal.requiresPlayerAction,true);
  assert.equal(proposal.gitWriteOwner,'N');
  assert.equal(proposal.operationContext.worldId,'alpha');
  assert.equal(proposal.operationContext.operationId,'proposal-assetInstallProposal');
  assert.deepEqual(calls,[],'a proposal must not call the host at all');
  for(const method of calls.map(call=>call.method))assert.ok(!/^(git|shell|exec)/.test(method));
});

test('an invalid reference is rejected before any host call',async()=>{
  const calls=[];
  const core={call:async(method,params)=>{calls.push(method);return {};}};
  const service=createHistoryService({core,context:CONTEXT,workspace:workspace()});
  await assert.rejects(async()=>service.assetRead({ref:{assetId:'latest',version:1,contentHash:HASH}}),/ASSET_REF_MUST_NOT_BE_LATEST/);
  assert.deepEqual(calls,[]);
});
