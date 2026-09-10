import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTargetFeedbackObservation,candidateFromTargetFeedbackStatus} from './target-feedback-observation.mjs';
import {validateObservationEnvelope,validateTargetFeedbackObservation} from '../../desktop/godot/shared/observation.mjs';
const expected={worldId:'alpha',buildId:'build',targetId:'target_a',hitFlashMilliseconds:500};
const observation=()=>({format:'craftmine.godot-observation/1',worldId:'alpha',buildId:'build',instanceId:'live',baseId:'first-person',baseVersion:'0.1.0',sampledAt:'2026-09-10T00:00:00Z',payload:{targetFeedback:{format:'craftmine.target-feedback-observation/1',targets:[{targetId:'target_a',hitFlashMilliseconds:500}]}}});
test('finite runtime assertion binds actual envelope identity and rejects missing, stale or ambiguous observations',()=>{
 assert.equal(assertTargetFeedbackObservation(observation(),expected).instanceId,'live');
 for(const modify of [value=>delete value.payload.targetFeedback,value=>value.buildId='old',value=>value.payload.targetFeedback.targets[0].hitFlashMilliseconds=120,value=>value.payload.targetFeedback.targets.push({...value.payload.targetFeedback.targets[0]}),value=>value.payload.targetFeedback.targets[0].hitFlashMilliseconds=NaN]){
  const value=observation();modify(value);assert.throws(()=>assertTargetFeedbackObservation(value,expected));
 }
 assert.throws(()=>assertTargetFeedbackObservation({worldId:'alpha',files:[{text:'hit_flash_seconds = 0.5'}]},expected));
});
test('optional field keeps old envelopes compatible and validates unavailable and bounded integer results',()=>{
 const old=observation();delete old.payload.targetFeedback;assert.equal(validateObservationEnvelope(old).ok,true);
 const error={format:'craftmine.target-feedback-observation/1',targets:[],error:'TARGET_FEEDBACK_DUPLICATE_ID'};
 assert.equal(validateTargetFeedbackObservation(error).ok,true);
 assert.equal(validateTargetFeedbackObservation({...error,targets:[{targetId:'target_a',hitFlashMilliseconds:500}]}).ok,false);
 assert.equal(validateTargetFeedbackObservation({...error,error:'arbitrary path'}).ok,false);
 assert.equal(validateTargetFeedbackObservation({format:error.format,targets:[{targetId:'target_a\n',hitFlashMilliseconds:500}]}).ok,false);
 for(const value of [0,-1,1001,1.5,NaN,Infinity])assert.equal(validateTargetFeedbackObservation({format:error.format,targets:[{targetId:'target_a',hitFlashMilliseconds:value}]}).ok,false);
 const tooMany={format:error.format,targets:Array.from({length:257},(_,index)=>({targetId:'target_'+index,hitFlashMilliseconds:500}))};
 assert.equal(validateTargetFeedbackObservation(tooMany).ok,false);
 const wrongBase=observation();wrongBase.baseId='top-down';assert.equal(validateObservationEnvelope(wrongBase).ok,false);
});
test('candidate selection uses the completed owned check identity, never list order',()=>{
 const status={worldId:'alpha',status:'passed',job:{status:'passed',candidateId:'candidate',jobId:'job',buildId:'build'}};
 const read={candidate:{candidateId:'candidate',worldId:'alpha',buildId:'build',checkJobId:'job'},checkStatus:'passed',buildId:'build',check:{passed:true},job:{check:{passed:true}}};
 assert.equal(candidateFromTargetFeedbackStatus(status,read).candidateId,'candidate');
 assert.throws(()=>candidateFromTargetFeedbackStatus(status,{...read,candidate:{...read.candidate,checkJobId:'other'}}));
 assert.throws(()=>candidateFromTargetFeedbackStatus({...status,status:'check-queued'},read));
});
