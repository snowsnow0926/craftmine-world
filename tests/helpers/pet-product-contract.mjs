import assert from 'node:assert/strict';

export const PET_PRODUCT_PLAN = Object.freeze([{assetId:'cw.module.pet-companion',version:1,position:{x:0,y:0,z:2}}]);
export function assertPetSaveReceipt(receipt, identity) {
  assert.equal(receipt.format, 'craftmine.godot-progress-receipt/1');
  for (const field of ['worldId', 'buildId', 'instanceId']) assert.equal(receipt[field], identity[field]);
  assert.match(receipt.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(receipt.revision) && receipt.revision > 0);
}
export function validatePetProductCall(method, fields, binding) {
  if (['status','godotObserve','godotSnapshot','godotCaptureBoundState','quit'].includes(method)) {assert.deepEqual(fields,{});return;}
  if (method==='primaryMode') {assert.ok(fields.payload===undefined||['play','entry'].includes(fields.payload.action));return;}
  if (method==='godotCaptureBoundView') {assert.deepEqual(fields,{payload:binding.captureIdentity});assert.equal(fields.payload.worldId,binding.worldId);return;}
  if (method==='godotExplore') {
    const {steps,...identity}=fields.payload;assert.deepEqual(identity,binding.formalIdentity);
    assert.ok(steps.length>0&&steps.length<=16);for(const step of steps){assert.equal(step.capture,false);assert.ok(['look','walk','wait','play-action'].includes(step.op));if(step.op==='play-action')assert.deepEqual(step.args,{action:'interact',frames:1});}return;
  }
  if (method==='worldNavigation') {
    assert.ok(['world.createOptions','world.create','world.list'].includes(fields.channel));
    if(fields.channel==='world.create'){assert.equal(fields.payload.baseId,'creation-sandbox');assert.equal(fields.payload.starterId,'blank');}return;
  }
  assert.equal(method,'worldPanel','PET_PRODUCT_METHOD_DENIED');assert.equal(fields.payload.worldId,binding.worldId);
  if (fields.channel==='package.request') {
    const {method:action,params}=fields.payload;assert.ok(['importSource','sourceJob','sourceList'].includes(action));assert.equal(params.worldId,binding.worldId);
    if(action==='importSource'){assert.deepEqual(params.position,PET_PRODUCT_PLAN[0].position);assert.equal(params.operationId,binding.operationId);}
    if(action==='sourceJob')assert.equal(params.jobId,binding.jobId);return;
  }
  assert.ok(['godot.candidateList','godot.candidateRead','godot.candidatePreview','godot.candidateApply','godot.runtimeSave','godot.runtimeResume'].includes(fields.channel));
  if(['godot.candidateRead','godot.candidatePreview','godot.candidateApply'].includes(fields.channel))assert.equal(fields.payload.candidateId,binding.candidateId);
  if(fields.channel==='godot.candidateApply')assert.equal(binding.activePreview,true,'CURRENT_PREVIEW_REQUIRED');
  if(fields.channel==='godot.runtimeSave')assert.equal(fields.payload.freeze,true);
}
export function assertPetProgress(state, worldId, entityId) {
  assert.equal(state.worldId,worldId);assert.equal(state.body.worldId,worldId);assert.deepEqual(Object.keys(state.body.components),[entityId]);
  const pet=state.body.components[entityId];assert.equal(pet.format,'craftmine.pet-companion-state/1');assert.equal(pet.entityId,entityId);
  assert.deepEqual(pet.settings,{name:'小伙伴',appearanceKey:'dog',following:true});assert.deepEqual(pet.sourceSettings,pet.settings);
  assert.ok(pet.position.length===3&&pet.position.every(Number.isFinite));assert.ok(Number.isFinite(pet.yaw));assert.ok(Number.isSafeInteger(pet.interactionCount));return pet;
}
