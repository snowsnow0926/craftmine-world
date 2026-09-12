import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {assertLegacyCheck} from './legacy-bases-contract.mjs';
const dir=new URL('../../docs/evidence/gu7-original-ruins-recovery-20260912/',import.meta.url),read=name=>JSON.parse(fs.readFileSync(new URL(name,dir)));
const r=read('report.json'),summary=read('summary.json');
function validate(r){
 assert.equal(r.passed,true);assert.equal(r.packageUnchanged,true);assert.equal(r.steps.length,12);assert.ok(r.steps.every(s=>s.passed));assert.equal(r.originalWorldId,'world-fd55cf940cd2');
 assert.equal(r.calls.some(c=>c.payload?.channel==='world.create'),false);
 assert.equal(r.calls.filter(c=>c.payload?.channel==='world.creationRetry').length,1);
 const checked=r.steps.find(s=>s.name==='recovery binds unchanged source and real LPAC check').result;
 assertLegacyCheck('side-view',r.originalWorldId,r.cases[0].initialObservation,checked.candidate,checked.job);
 assert.equal(checked.job.manifestHash,r.originalFailedJob.manifestHash);assert.equal(checked.job.sourceRevision,r.originalFailedJob.sourceRevision);assert.equal(checked.job.buildId,r.originalFailedJob.buildId);assert.notEqual(checked.job.jobId,r.originalFailedJob.jobId);
 assert.equal(r.originalJobAfter.status,'failed');assert.equal(r.originalJobAfter.outputHash,r.originalFailedJob.outputHash);
 const play=r.steps.find(s=>s.name==='recovered original ruins gameplay').result;assert.equal(play.ok,true);assert.equal(play.actions.length,12);assert.equal(play.checks.length,20);assert.ok(play.checks.every(c=>c.passed));
 assert.deepEqual(r.beforeCold.state,r.afterCold.state);assert.notEqual(r.beforeColdObservation.instanceId,r.afterColdObservation.instanceId);assert.equal(r.beforeColdObservation.buildId,r.afterColdObservation.buildId);
 assert.equal(r.launches.length,2);for(const l of r.launches){assert.equal(l.exit.code,0);for(const k of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(l.exitAudit[k],[]);}
}
test('new sealed normal retry recovers the original world and preserves the original failed output',()=>{validate(r);for(const [name,pin]of Object.entries(summary.records)){const b=fs.readFileSync(new URL(name,dir));assert.equal(b.length,pin.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),pin.sha256);}});
test('replacement worlds, rewritten original failures or missing cold progress cannot pass recovery',()=>{
 for(const mutate of [x=>x.originalWorldId='replacement',x=>x.originalJobAfter.status='passed',x=>x.afterCold.state.body.counters.coins=0]){const copy=structuredClone(r);mutate(copy);assert.throws(()=>validate(copy));}
});
