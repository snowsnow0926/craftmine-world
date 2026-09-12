import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {assertFormalPackageCheck,assertFormalCold} from './formal-package-contract.mjs';
import {assertCatalogSourceBinding} from './formal-catalog-contract.mjs';
import {assertModuleBootstrapPackages} from './module-player-bootstrap-contract.mjs';
const directory=new URL('../../docs/evidence/gu7-sealed-2a584796-20260912/',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,directory)));
const summary=read('summary.json');
test('new sealed catalog trial binds exact source jobs, cold state and three durable jobs',()=>{
 for(const [name,pin]of Object.entries(summary.records)){const bytes=fs.readFileSync(new URL(name,directory));assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);}
 const r=read('catalog-pass.json'),audit=read('post-shutdown-jobs.json');
 assert.equal(r.commit,summary.commit);assert.equal(r.passed,true);assert.equal(r.steps.length,25);assert.ok(r.steps.every(s=>s.passed));
 assert.equal(r.sourceMode,'catalog');assert.equal(r.packages.length,2);assertFormalCold(r.beforeCold,r.afterCold);
 for(const item of r.packages){assertFormalPackageCheck(r.worldId,item.imported,item.checked);assertCatalogSourceBinding(r.catalogFixture.records.find(c=>c.kind===item.kind),item.imported);assert.deepEqual(r.steps.find(s=>s.name===item.kind+' same catalog operation survives service restart').result.replay,item.imported);}
 assert.equal(audit.jobs.length,3);assert.ok(audit.jobs.every(j=>j.kind==='check'&&j.status==='passed'));assert.deepEqual(audit.jobs.map(j=>j.buildId).sort(),[r.initialObservation.buildId,...r.packages.map(p=>p.checked.buildId)].sort());
 for(const launch of r.launches){assert.equal(launch.exit.code,0);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.exitAudit[key],[]);}
});
test('two-instance bootstrap is real adoption but the ordinary model entry remains failed with zero calls',()=>{
 const boot=read('module-bootstrap.json'),player=read('player-entry-failure.json'),config=read('player-config.json');
 assert.equal(assertModuleBootstrapPackages(boot).length,2);assert.equal(boot.passed,true);assert.equal(boot.stateIntegrityVerified,true);
 assert.equal(player.worldId,boot.worldId);assert.equal(player.sessionId,boot.sessionId);assert.equal(player.status,'RUN_FAILED');assert.match(player.error,/CREATION_MIGRATION_NEEDED/);
 assert.equal(player.latest.metrics.calls.observed,0);assert.equal(player.latest.metrics.calls.reported,0);assert.deepEqual(player.latest.metrics.models,[]);assert.equal(player.stateIntegrityVerified,true);
 assert.equal(config.modelId,'deepseek-v4.1-flash-expires-on-0910');assert.equal(config.thinkingLevel,'max');assert.equal(player.setup.modelId,config.modelId);assert.equal(player.setup.thinkingLevel,config.thinkingLevel);
 for(const entry of [boot,player]){assert.equal(entry.exit.code,0);for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(entry.exitReport[key],[]);}
});
test('earlier navigation attempts retain their failed verdict and successful prior adoption stages',()=>{
 for(const [name,reason]of [['catalog-busy.json','WORLD_BUSY'],['catalog-view-pending.json','World view is not ready']]){
  const r=read(name);assert.equal(r.passed,false);assert.ok(r.steps.some(s=>s.passed===false&&s.error.includes(reason)));assert.equal(r.packages.length,2);for(const item of r.packages)assertFormalPackageCheck(r.worldId,item.imported,item.checked);
 }
});
