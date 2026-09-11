import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {invokeCraftmineNavigation}=await import('../electron/main/craftmine-navigation-host.ts');
const {assertPreviewControl}=await import('../../../../../plugins/craftmine-world/preview-control.mjs');
const identity={worldId:'world-1',candidateId:'candidate-1',buildId:'build-1',previewId:'instance-1'};
const ready={...identity,applyDisabled:false,closeDisabled:false};

test('preview controls stay on retained product page; no raw candidate application channel opens',async()=>{
  const calls=[];
  const deps={invoke:async()=>{throw Error('raw invocation');},navigate:async()=>{throw Error('navigation');},previewControl:async request=>{calls.push(request);return ready;}};
  const invoke=(payload,pluginId='craftmine.world')=>invokeCraftmineNavigation({pluginId,channel:'world.previewControl',payload},deps);
  assert.deepEqual(await invoke({action:'state'}),ready);
  await invoke({action:'apply',...identity});await invoke({action:'close',...identity});
  assert.equal(calls.length,3);
  for(const payload of [{action:'apply'}, {action:'apply',...identity,snapshot:{}}, {action:'state',worldId:'world-2'}, {action:'script',...identity}, {action:'close',...identity,previewId:''}])await assert.rejects(invoke(payload),/INVALID_PREVIEW_CONTROL/);
  await assert.rejects(invoke({action:'state'},'other.plugin'),/PERMISSION_DENIED/);
  await assert.rejects(invokeCraftmineNavigation({pluginId:'craftmine.world',channel:'godot.candidateApply',payload:identity},deps),/PERMISSION_DENIED/);
  assert.equal(calls.length,3);
});

test('every identity field including reopened same candidate must still match',()=>{
  assert.doesNotThrow(()=>assertPreviewControl({action:'state'},null));
  for(const action of ['apply','close']) {
    assert.doesNotThrow(()=>assertPreviewControl({action,...identity},ready));
    for(const key of Object.keys(identity))assert.throws(()=>assertPreviewControl({action,...identity,[key]:'changed'},ready),/PREVIEW_CHANGED/);
    assert.throws(()=>assertPreviewControl({action,...identity},null),/PREVIEW_CHANGED/);
  }
});

test('in-flight apply cannot be duplicated or closed; reconciliation can only repeat apply path',()=>{
  for(const action of ['apply','close'])assert.throws(()=>assertPreviewControl({action,...identity},{...ready,applyDisabled:true,closeDisabled:true}),/PREVIEW_BUSY/);
  const uncertain={...ready,closeDisabled:true};
  assert.doesNotThrow(()=>assertPreviewControl({action:'apply',...identity},uncertain));
  assert.throws(()=>assertPreviewControl({action:'close',...identity},uncertain),/PREVIEW_BUSY/);
});
