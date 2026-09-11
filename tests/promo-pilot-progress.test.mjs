import test from 'node:test';import assert from 'node:assert/strict';import {promoPilotProgress} from './helpers/promo-pilot-progress.mjs';
test('exhausting model requests never cancels the check the model already started',()=>{
  for(const status of ['queued','running','recovering'])assert.equal(promoPilotProgress({active:false,budget:{remaining:0},job:{status}}).settled,false);
  assert.deepEqual(promoPilotProgress({active:false,budget:{remaining:0},job:{status:'passed'}}),{settled:true,reason:'BUDGET_STOP'});
});
test('application and model lifecycle remain independent of terminal check status',()=>{
  assert.equal(promoPilotProgress({active:true,job:{status:'passed'}}).settled,false);
  assert.equal(promoPilotProgress({active:false,job:{status:'passed'},application:{phase:'applying'}}).settled,false);
  assert.deepEqual(promoPilotProgress({active:false,budget:{remaining:2},job:{status:'failed'}}),{settled:true,reason:'TASK_SETTLED_UNVERIFIED'});
});
