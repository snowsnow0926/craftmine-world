import assert from 'node:assert/strict';
import test from 'node:test';
import {summarizeModelCases} from './helpers/creation-model-evaluation.mjs';

test('human-assisted real model cases remain in the autonomous denominator',()=>{
  const result=summarizeModelCases([
    {outcome:'first_attempt_pass',modelRequests:2,humanIntervention:false},
    {outcome:'human_assisted_pass',modelRequests:3,humanIntervention:true},
  ]);
  assert.equal(result.denominator,2);
  assert.equal(result.firstAttemptRate,.5);
  assert.equal(result.autonomousCompletionRate,.5);
  assert.equal(result.requestCount,5);
});
test('an all-human-assisted run has zero autonomous success, not null',()=>{
  const result=summarizeModelCases([{outcome:'human_assisted_pass',modelRequests:4,humanIntervention:true}]);
  assert.equal(result.denominator,1);
  assert.equal(result.firstAttemptRate,0);
  assert.equal(result.autonomousCompletionRate,0);
});
test('a contradictory pass label never overrides recorded human intervention',()=>{
  const result=summarizeModelCases([{outcome:'first_attempt_pass',modelRequests:1,humanIntervention:true}]);
  assert.equal(result.firstAttemptRate,0);
  assert.equal(result.autonomousCompletionRate,0);
  assert.equal(result.attemptAutonomousRate,0);
});
test('environment failures before and after a model request retain distinct denominators',()=>{
  const result=summarizeModelCases([
    {outcome:'first_attempt_pass',modelRequests:2},
    {outcome:'environment_blocked',modelRequests:1},
    {outcome:'environment_blocked',modelRequests:0},
    {outcome:'not_run',modelRequests:0},
  ]);
  assert.equal(result.attemptDenominator,3);
  assert.equal(result.denominator,2);
  assert.equal(result.attemptAutonomousRate,1/3);
  assert.equal(result.autonomousCompletionRate,1/2);
});
test('no observed model calls cannot count as autonomous success',()=>{
  const result=summarizeModelCases([{outcome:'first_attempt_pass',submitted:true,modelRequests:0}]);
  assert.equal(result.attemptAutonomousRate,0);
  assert.equal(result.firstAttemptRate,null);
  assert.equal(result.autonomousCompletionRate,null);
});
test('empty reports have no invented rate or price',()=>{
  const result=summarizeModelCases([]);
  assert.equal(result.denominator,0);
  assert.equal(result.attemptAutonomousRate,null);
  assert.equal(result.autonomousCompletionRate,null);
  assert.equal(result.cost,null);
});
