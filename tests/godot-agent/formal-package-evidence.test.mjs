import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertFormalPackageCheck,assertFormalAdoption,assertFormalCold} from './formal-package-contract.mjs';
const report=JSON.parse(fs.readFileSync(new URL('../../docs/evidence/gu6-formal-packages-20260912/formal-client-report.json',import.meta.url)));
test('archived ordinary core jobs bind exact import source and adopted runtime, then cold reopen unchanged',()=>{
  for(const entry of report.packages){
    assertFormalPackageCheck(report.worldId,entry.imported,entry.checked);
    const applied=report.steps.find(s=>s.name===entry.kind+' ordinary candidateApply').result;
    const observed=report.steps.find(s=>s.name===entry.kind+' formal runtime pixels').result.viewportObservation;
    assertFormalAdoption(report.worldId,entry.checked,entry.preview,applied,observed);
  }
  assertFormalCold(report.beforeCold,report.afterCold);
});
test('an unrelated passed job or different source pin cannot pass formal attribution',()=>{
  const entry=report.packages[0];
  for(const [field,value] of [['worldId','other-world'],['jobId',report.packages[1].checked.jobId],['manifestHash','a'.repeat(64)],['sourceRevision',999],['kind','build'],['status','blocked']]){
    const job=structuredClone(entry.checked);job[field]=value;assert.throws(()=>assertFormalPackageCheck(report.worldId,entry.imported,job));
  }
});
test('failed runtime assertions and wrong adopted build are never accepted',()=>{
  const entry=report.packages[0],job=structuredClone(entry.checked);job.output.check.assertions[0].passed=false;
  assert.throws(()=>assertFormalPackageCheck(report.worldId,entry.imported,job));
  const applied=report.steps.find(s=>s.name===entry.kind+' ordinary candidateApply').result;
  assert.throws(()=>assertFormalAdoption(report.worldId,entry.checked,entry.preview,applied,{worldId:report.worldId,buildId:'different-build'}));
});
test('cold evidence rejects reused runtime identity and missing installed source identities',()=>{
  const after=structuredClone(report.afterCold);after.observed.instanceId=report.beforeCold.observation.instanceId;
  assert.throws(()=>assertFormalCold(report.beforeCold,after));
  const missing=structuredClone(report.afterCold);missing.sources.items.pop();assert.throws(()=>assertFormalCold(report.beforeCold,missing));
  const noSnapshot=structuredClone(report.beforeCold);delete noSnapshot.snapshot.state;assert.throws(()=>assertFormalCold(noSnapshot,report.afterCold));
});
test('actual cancel.request run exits normally with no input or owned-shutdown failures',()=>{
  const cancelled=JSON.parse(fs.readFileSync(new URL('../../docs/evidence/gu6-formal-packages-20260912/cancel-control-report.json',import.meta.url)));
  assert.equal(cancelled.cancelled.reason,'cancel.request');assert.equal(cancelled.passed,false);assert.equal(cancelled.launches.length,1);
  const launch=cancelled.launches[0];assert.equal(launch.exit.code,0);assert.equal(launch.forcedStop,undefined);
  for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.exitAudit[key],[]);
});

test('unified controller and ZIP catalog package passes the full formal two-module chain and cold reopen',()=>{
 const integrated=JSON.parse(fs.readFileSync(new URL('../../docs/evidence/gu6-integrated-package-20260912/formal-client-report.json',import.meta.url)));
 assert.equal(integrated.commit,'09f7443a1aeb59307cffe01623d6ff18975578ca');assert.equal(integrated.passed,true);
 assert.equal(integrated.steps.length,22);assert.ok(integrated.steps.every(s=>s.passed));
 for(const entry of integrated.packages){
  assertFormalPackageCheck(integrated.worldId,entry.imported,entry.checked);
  const applied=integrated.steps.find(s=>s.name===entry.kind+' ordinary candidateApply').result;
  const observed=integrated.steps.find(s=>s.name===entry.kind+' formal runtime pixels').result.viewportObservation;
  assertFormalAdoption(integrated.worldId,entry.checked,entry.preview,applied,observed);
  assert.equal(observed.payload.controllerEvidence.status,'supported');assert.ok(observed.payload.creation.physicsTick>0);
  assert.equal(observed.payload.creation.sceneObjectSelection.geometryBasis,'base-surface-arrays');
  assert.equal(observed.payload.creation.sceneObjectSelection.renderLodVerified,false);
 }
 assertFormalCold(integrated.beforeCold,integrated.afterCold);
 for(const launch of integrated.launches){assert.equal(launch.exit.code,0);assert.equal(launch.forcedStop,undefined);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.exitAudit[key],[]);}
});
