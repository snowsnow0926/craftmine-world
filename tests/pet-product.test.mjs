import test from 'node:test';import assert from 'node:assert/strict';
import {validatePetProductCall as validate,PET_PRODUCT_PLAN} from './helpers/pet-product-contract.mjs';
const binding={worldId:'world',operationId:'install',jobId:'job',candidateId:'candidate',activePreview:false,formalIdentity:{worldId:'world',buildId:'build',instanceId:'instance'},captureIdentity:{worldId:'world',buildId:'build',instanceId:'instance'}};
test('final product controller refuses old captures, model calls and cross-instance input',()=>{
 for(const method of ['godotCaptureView','playerPrompt','rawCore'])assert.throws(()=>validate(method,{},binding));
 assert.throws(()=>validate('godotExplore',{payload:{...binding.formalIdentity,instanceId:'other',steps:[{op:'wait',args:{frames:1},capture:false}]}},binding));
 assert.throws(()=>validate('godotExplore',{payload:{...binding.formalIdentity,steps:[{op:'wait',args:{frames:1},capture:true}]}},binding));
 validate('godotExplore',{payload:{...binding.formalIdentity,steps:[{op:'play-action',args:{action:'interact',frames:1},capture:false}]}},binding);
 validate('godotCaptureBoundView',{payload:binding.captureIdentity},binding);
});
test('only the selected installed pet and current preview may be adopted',()=>{
 const fields={channel:'godot.candidateApply',payload:{worldId:'world',candidateId:'candidate'}};assert.throws(()=>validate('worldPanel',fields,binding),/CURRENT_PREVIEW_REQUIRED/);validate('worldPanel',fields,{...binding,activePreview:true});
 validate('worldPanel',{channel:'package.request',payload:{worldId:'world',method:'importSource',params:{worldId:'world',operationId:'install',position:PET_PRODUCT_PLAN[0].position}}},binding);
 assert.throws(()=>validate('worldPanel',{channel:'package.request',payload:{worldId:'world',method:'sourcePatch',params:{worldId:'world'}}},binding));
});
