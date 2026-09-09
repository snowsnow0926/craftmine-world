import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createReviewJobs}=require('../desktop/build/craftmine.world/review-jobs.cjs');

test('a failed cancellation receipt still aborts PI completion and discards its late reply',{timeout:5000},async()=>{
  let began,reply,finishes=0,completeCancels=0,nativeCancels=0;
  const started=new Promise(resolve=>{began=resolve;}),pending=new Promise(resolve=>{reply=resolve;});
  const binding={sessionId:'session',turnId:'turn'};
  const core={call:async method=>{
    if(method==='verification.read')return {input:{binding,origin:{modelKey:'fixture/model',request:{messageId:'request',text:'Add a tree'}},world:{build:{scene:{objects:[]}}}},output:{artifact:{build:{scene:{objects:[{id:'tree'}]}},diff:{}},evidence:{}}};
    if(method==='review.list')return [];
    if(method==='review.start')return {inputHash:'fixture'};
    if(method==='review.cancel')throw Error('INJECTED_STORAGE_TRANSPORT_FAILURE');
    if(method==='review.finish')finishes++;
    throw Error('Unexpected fixture call: '+method);
  }};
  const jobs=createReviewJobs(core,{complete:async()=>{began();return pending;},cancelComplete:async()=>{completeCancels++;},cancelVerification:async()=>{nativeCancels++;}});
  await jobs.start('fixture-check');await started;
  await jobs.cancelTurn(binding);
  reply({text:'late response',modelKey:'fixture/model'});
  await jobs.stop();
  assert.ok(completeCancels>=1);assert.ok(nativeCancels>=1);assert.equal(finishes,0);
});
