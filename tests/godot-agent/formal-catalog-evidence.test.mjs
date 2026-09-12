import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {assertCatalogSourceBinding} from './formal-catalog-contract.mjs';
import {assertFormalPackageCheck,assertFormalAdoption,assertFormalCold} from './formal-package-contract.mjs';
const directory=new URL('../../docs/evidence/gu6-catalog-adoption-20260912/',import.meta.url);
const bytes=fs.readFileSync(new URL('formal-client-report.json',directory)),report=JSON.parse(bytes);

function assertTrial(r){
 assert.equal(r.sourceMode,'catalog');assert.equal(r.passed,true);assert.equal(r.steps.length,25);assert.ok(r.steps.every(s=>s.passed));
 assert.equal(r.packages.length,2);assert.equal(r.catalogFixture.records.length,2);
 for(const entry of r.packages){
  const catalog=r.catalogFixture.records.find(c=>c.kind===entry.kind);assert.equal(catalog.sourceDownloadRemoved,true);
  assertCatalogSourceBinding(catalog,entry.imported);assert.equal(entry.operationId,entry.imported.operationId);
  assertFormalPackageCheck(r.worldId,entry.imported,entry.checked);
  const applied=r.steps.find(s=>s.name===entry.kind+' ordinary candidateApply').result;
  const observed=r.steps.find(s=>s.name===entry.kind+' formal runtime pixels').result.viewportObservation;
  assertFormalAdoption(r.worldId,entry.checked,entry.preview,applied,observed);
  const restored=r.steps.find(s=>s.name===entry.kind+' same catalog operation survives service restart').result;
  assert.deepEqual(restored.replay,entry.imported);assert.deepEqual(restored.sources,r.afterCold.sources);
 }
 assertFormalCold(r.beforeCold,r.afterCold);
 const installs=r.calls.filter(c=>c.method==='worldPanel'&&c.payload.channel==='package.request'&&c.payload.payload.method==='importCatalogSource');
 assert.equal(installs.length,4);
 assert.equal(r.calls.some(c=>c.payload?.payload?.method==='importSource'),false);
 assert.equal(r.launches.length,2);for(const launch of r.launches){assert.equal(launch.exit.code,0);assert.equal(launch.forcedStop,undefined);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.exitAudit[key],[]);}
}

test('sealed catalog adoption binds exact stored ZIPs, actual jobs, formal runtime and cold idempotent receipts',()=>{
 const summary=JSON.parse(fs.readFileSync(new URL('summary.json',directory)));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),summary.reportSha256);
 assert.equal(report.commit,summary.commit);assert.equal(report.commit,'a9b4c0e299c7a40f88c4e004f02a9fe658016159');assertTrial(report);
 const auditBytes=fs.readFileSync(new URL('post-shutdown-jobs.json',directory)),audit=JSON.parse(auditBytes);
 assert.equal(createHash('sha256').update(auditBytes).digest('hex'),summary.jobAuditSha256);
 assert.equal(audit.worldId,report.worldId);assert.equal(audit.jobs.length,3);assert.ok(audit.jobs.every(j=>j.worldId===report.worldId&&j.kind==='check'&&j.status==='passed'));
 assert.deepEqual(audit.jobs.map(j=>j.buildId).sort(),[report.initialObservation.buildId,...report.packages.map(p=>p.checked.buildId)].sort());
 for(const entry of report.packages){const job=audit.jobs.find(j=>j.id===entry.checked.jobId);assert.equal(job.manifestHash,entry.checked.manifestHash);assert.equal(job.sourceRevision,entry.checked.sourceRevision);}
});

test('catalog proof rejects a different ref, an extra replay install or mismatched source/job identity',()=>{
 for(const mutate of [r=>r.packages[0].imported.catalogRef.contentHash='0'.repeat(64),r=>r.packages[0].checked.jobId=r.packages[1].checked.jobId,r=>r.steps.find(s=>s.name==='building same catalog operation survives service restart').result.replay.operationId='new-operation',r=>r.catalogFixture.records[0].sourceDownloadRemoved=false]){
  const copy=structuredClone(report);mutate(copy);assert.throws(()=>assertTrial(copy));
 }
});
