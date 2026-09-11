import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validControllerEvidence,validControllerWalk} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-controller-evidence.ts';
import {doorPassageMatches} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-door-passage.ts';
import {creationRequirementsHash,validCreationRequirement} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/creation-controller-binding-real-evidence.json',import.meta.url)));
const required=fixture.descriptor.checkRequirements.creation;
const actual=fixture.evidence.observations[1].doorTrace.at(-1).passage;
test('real Web binding evidence preserves identity and passes host validators',()=>{
 assert.equal(validCreationRequirement(required),true);
 assert.equal(creationRequirementsHash(required),fixture.descriptor.checkRequirementsHash);
 assert.equal(doorPassageMatches(required,actual,fixture.evidence.instanceId),true);
 for(const motion of [actual.closed,actual.opened]){
  const c=motion.controller;assert.equal(validControllerEvidence(c.before),true);
  assert.equal(validControllerWalk(c.walk,c.before,c.after),true);
 }
});
test('actual fixed facts reject substituted objects, scripts, cameras, parameters and shapes',()=>{
 for(const change of [v=>v.playerScriptId='123',v=>v.rootPlayerId='123',v=>v.rigScriptId='123',v=>v.activeCameraId='123',v=>v.rigParentId='123',v=>v.playerRigId='123',v=>v.parameters[0]=9,v=>v.body.mask=0,v=>v.body.physicsProcessing=false,v=>v.shape.radius=.4,v=>v.shape.bodyResourceId='123',v=>v.shape.ownerCount=2,v=>v.cameraTransform.rigPosition[1]=.8,v=>v.cameraTransform.cameraRotation[0]=.1,v=>v.playerId='001',v=>delete v.shape,v=>v.status='unsupported']){
  const value=structuredClone(actual.closed.controller.before);change(value);assert.equal(validControllerEvidence(value),false);
 }
});
test('physics trace rejects missing ticks and changes during the actual walk',()=>{
 const c=actual.closed.controller;
 for(const change of [w=>delete w.bindingTrace,w=>w.bindingTrace[100][1]='123',w=>w.bindingTrace[100][6]='123',w=>w.bindingTrace[100][8]='123',w=>w.checkedTicks.splice(100,1),w=>w.completedFrames=239,w=>w.after.playerScriptId='123',w=>w.before.shape.radius=.4]){
  const w=structuredClone(c.walk);change(w);assert.equal(validControllerWalk(w,c.before,c.after),false);
 }
});
test('profile and locked interaction are bound, and cannot downgrade to the legacy proof',()=>{
 for(const change of [p=>delete p.controllerProfile,p=>delete p.closed.controller,p=>delete p.closed.lockedInteraction,p=>p.closed.lockedInteraction.doorOpen=true,p=>p.closed.lockedInteraction.targetId='other',p=>p.closed.controller.before.rootPlayerId='123',p=>p.opened.controller.walk.bindingTrace[120][2]='123']){
  const p=structuredClone(actual);change(p);assert.equal(doorPassageMatches(required,p,fixture.evidence.instanceId),false);
 }
 const old=structuredClone(required);delete old.doorSequence.controllerProfile;
 assert.notEqual(creationRequirementsHash(old),creationRequirementsHash(required));
 assert.equal(doorPassageMatches(old,actual,fixture.evidence.instanceId),false);
});
