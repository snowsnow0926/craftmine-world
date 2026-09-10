// Finite assertions over a real runtime observe-envelope. This helper never
// reads managed source or evaluates arbitrary game scripts. Obtaining the
// actual observation from the running client is the caller's responsibility.
import assert from 'node:assert/strict';
import {validateTargetFeedbackObservation} from '../../desktop/godot/shared/observation.mjs';

export function assertTargetFeedbackObservation(observation,expected){
 const {worldId,buildId,targetId,hitFlashMilliseconds}=expected;
 assert.equal(observation?.format,'craftmine.godot-observation/1');
 assert.equal(observation.worldId,worldId);
 assert.equal(observation.buildId,buildId);
 assert.equal(observation.baseId,'first-person');
 assert.equal(observation.baseVersion,'0.1.0');
 assert.equal(typeof observation.instanceId,'string');assert.ok(observation.instanceId.length>0);
 assert.equal(typeof observation.sampledAt,'string');assert.ok(Number.isFinite(Date.parse(observation.sampledAt)));
 const feedback=observation.payload?.targetFeedback;
 assert.equal(validateTargetFeedbackObservation(feedback).ok,true);assert.equal(feedback.error,undefined);
 assert.equal(feedback?.format,'craftmine.target-feedback-observation/1');
 assert.ok(Array.isArray(feedback.targets));assert.ok(feedback.targets.length<=256);
 const ids=new Set();
 for(const target of feedback.targets){
  assert.deepEqual(Object.keys(target).sort(),['hitFlashMilliseconds','targetId']);
  assert.match(target.targetId,/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  assert.ok(!ids.has(target.targetId),'ambiguous runtime target');ids.add(target.targetId);
  assert.equal(typeof target.hitFlashMilliseconds,'number');assert.ok(Number.isFinite(target.hitFlashMilliseconds));
  assert.ok(target.hitFlashMilliseconds>=1&&target.hitFlashMilliseconds<=1000);
 }
 const target=feedback.targets.find(item=>item.targetId===targetId);assert.ok(target,'target absent from runtime observation');
 assert.ok(Number.isInteger(hitFlashMilliseconds)&&hitFlashMilliseconds>=1&&hitFlashMilliseconds<=1000);
 assert.ok(Math.abs(target.hitFlashMilliseconds-hitFlashMilliseconds)<=1e-6,'runtime parameter differs from expected authored milliseconds');
 return {worldId:observation.worldId,buildId:observation.buildId,instanceId:observation.instanceId,
  sampledAt:observation.sampledAt,targetId:target.targetId,hitFlashMilliseconds:target.hitFlashMilliseconds};
}

export function candidateFromTargetFeedbackStatus(status,read){
 assert.equal(status?.status,'passed');assert.equal(status.job?.status,'passed');
 assert.equal(typeof status.job.candidateId,'string');assert.ok(status.job.candidateId.length>0);
 const candidate=read?.candidate;
 assert.equal(candidate?.candidateId,status.job.candidateId);assert.equal(candidate.worldId,status.worldId);
 assert.equal(candidate.buildId,status.job.buildId);assert.equal(read.buildId,status.job.buildId);
 assert.equal(candidate.checkJobId,status.job.jobId);assert.equal(read.checkStatus,'passed');assert.equal(read.check?.passed,true);
 return {worldId:candidate.worldId,candidateId:candidate.candidateId,buildId:candidate.buildId,checkJobId:candidate.checkJobId};
}
