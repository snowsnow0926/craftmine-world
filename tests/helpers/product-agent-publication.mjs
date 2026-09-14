import assert from 'node:assert/strict';

// Test-side orchestration only. All mutations are supplied ordinary UI handlers.
export async function publishOperatorTemplate(ui,input,worldId){
  assert(input.includeSavedProgress===undefined||typeof input.includeSavedProgress==='boolean','PUBLICATION_CHECKPOINT_BOOLEAN_REQUIRED');
  const includeSavedProgress=input.includeSavedProgress??true;
  await ui.assets('world');
  const previous=await ui.read();
  assert.equal(previous.worldId,worldId,'PUBLICATION_WORLD_MISMATCH');
  if(previous.id)await ui.continuePublication();
  await ui.until(async()=>{const value=await ui.read();assert.equal(value.worldId,worldId,'PUBLICATION_WORLD_MISMATCH');return !value.id&&value.formReady;},Boolean);
  // Every command creates a new asset, not a version of a prior form selection.
  await ui.field('[data-publication-version-target]','');
  for(const [selector,key]of [['[data-publication-name]','name'],['[data-publication-description]','description'],['[data-publication-tags]','tags'],['[data-publication-aliases]','aliases']])await ui.field(selector,input[key]??'');
  await ui.field('[data-publication-checkpoint]',includeSavedProgress);
  await ui.until(async()=>{const value=await ui.read();assert.equal(value.worldId,worldId,'PUBLICATION_WORLD_MISMATCH');return !value.id&&value.formReady&&value.checkpoint===includeSavedProgress;},Boolean);
  await ui.submit('[data-library-publish-form]');
  return ui.until(async()=>{
    const value=await ui.read();assert.equal(value.worldId,worldId,'PUBLICATION_WORLD_MISMATCH');
    if(value.error)throw Error(value.error);
    if(!value.id)return null;
    assert.notEqual(value.id,previous.id,'PUBLICATION_STALE_RESULT');
    assert.equal(value.hasForm,false,'PUBLICATION_RESULT_NOT_FINISHED');
    assert.match(value.id,/^player\.world\.[a-z0-9_-]+$/);
    return {assetId:value.id,includeSavedProgress,worldId};
  },Boolean);
}
