import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {assertLegacyCheck,assertLegacyCold,validateLegacyCall,isWorldBusyPreflight} from './legacy-bases-contract.mjs';
import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
const directory=new URL('../../docs/evidence/ga27-legacy-bases-20260912/',import.meta.url),read=name=>JSON.parse(fs.readFileSync(new URL(name,directory)));
const report=read('report.json');
test('same sealed four-base run retains three passes and the side-view failure',()=>{
 assert.equal(report.commit,'2a584796a9da32f6c8c5e597804d03fdefff638a');assert.equal(report.passed,false);assert.equal(report.packageUnchanged,true);
 assert.deepEqual(report.cases.map(c=>[c.baseId,c.passed]),[['first-person',true],['top-down',true],['side-view',false],['mining-sandbox',true]]);
 for(const entry of report.cases.filter(c=>c.passed)){assertLegacyCheck(entry.baseId,entry.worldId,entry.initialObservation,entry.candidate,entry.job);assertLegacyCold(entry.beforeCold,entry.afterCold);}
 const failed=report.cases.find(c=>c.baseId==='side-view');assert.equal(failed.afterCold,undefined);assert.match(failed.failure,/GODOT_JOB_FAILED/);
 assert.equal(report.launches.length,7);for(const launch of report.launches)assertCleanHeadlessShutdown({...launch,audit:launch.exitAudit});
});
test('original semantic routes contain measured motion and persisted gameplay changes',()=>{
 const first=report.cases[0].gameplay,a=first.before.payload.player.position,b=first.after.payload.player.position;assert.ok(Math.hypot(...a.map((v,i)=>b[i]-v))>2);
 for(const id of ['top-down','mining-sandbox']){const game=report.cases.find(c=>c.baseId===id).gameplay;assert.equal(game.ok,true);assert.ok(game.checks.every(c=>c.passed));}
 const town=report.cases.find(c=>c.baseId==='top-down').beforeCold.snapshot.state.body;assert.equal(town.coins,64);assert.equal(town.inventory.bread,1);assert.equal(town.quests['herb-delivery'].rewarded,true);
});
test('wrong source/job/output identity and failed checks cannot be accepted',()=>{
 const entry=report.cases[0];
 for(const [key,value]of [['jobId','other'],['sourceRevision',999],['manifestHash','a'.repeat(64)],['outputHash','f'.repeat(64)],['status','failed']]){const job=structuredClone(entry.job);job[key]=value;assert.throws(()=>assertLegacyCheck(entry.baseId,entry.worldId,entry.initialObservation,entry.candidate,job));}
 const job=structuredClone(entry.job);job.output.check.assertions[0].passed=false;assert.throws(()=>assertLegacyCheck(entry.baseId,entry.worldId,entry.initialObservation,entry.candidate,job));
 const after=structuredClone(entry.afterCold);after.observation.instanceId=entry.beforeCold.observation.instanceId;assert.throws(()=>assertLegacyCold(entry.beforeCold,after));
});
test('side-view native crash and its single automatic retry remain failed, never runtime success',()=>{
 const jobs=read('side-view-failed-jobs.json').jobs;assert.equal(jobs.length,1);const job=jobs[0];assert.equal(job.status,'failed');assert.equal(job.base_id,'side-view');assert.equal(job.output.passed,false);assert.equal(job.output.check.assertions[0].id,'runtime.not-run');
 const ledger=read('side-view/executor-ledger.json').jobs[job.id];assert.equal(ledger.importCrashRetries,1);assert.equal(ledger.attempts.length,2);
 for(const attempt of ledger.attempts){assert.equal(attempt.failure.engineExitCode,3221225477);assert.equal(attempt.failure.cleanup.verified,true);assert.equal(attempt.failure.cleanup.workRemoved,true);}
});
test('archive bytes and sealed inventory retain exact hashes',()=>{
 for(const file of read('archive.json').files){const bytes=fs.readFileSync(new URL(file.path,directory));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 assert.equal(createHash('sha256').update(JSON.stringify(read('package-inventory.json'))).digest('hex'),report.inventorySha256);
});
test('only existing navigation/semantic routes are used and uncertain opens are not retried',()=>{
 for(const call of report.calls)validateLegacyCall(call.method,call.payload);
 for(const method of ['evaluate','playerSubmit','godotEval','modelRequest'])assert.throws(()=>validateLegacyCall(method,{}));
 assert.equal(isWorldBusyPreflight(Error('WORLD_BUSY')),true);
 assert.equal(isWorldBusyPreflight(Error("Error invoking remote method 'pi-plugin-panel-invoke': Error: WORLD_BUSY")),true);
 for(const message of ['Timed out: worldNavigation','Unknown outcome','unrelated WORLD_BUSY'])assert.equal(isWorldBusyPreflight(Error(message)),false);
});
