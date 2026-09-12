// Real Rust + private host router + copied retained-world Git storage. No
// production profile writes. This test stops at the real executor availability
// gate; it does not claim a successful executor/application receipt.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {createCreationGroundMaintenance} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-ground-maintenance.ts';
const root=path.resolve(import.meta.dirname,'..'),source=path.resolve(process.env.CRAFTMINE_GROUND_DOMAIN_COPY??'');
assert.ok(source.startsWith(path.join(root,'test-results')+path.sep),'Only an already isolated test-results domain may be copied');
const out=fs.mkdtempSync(path.join(root,'test-results/creation-ground-core-')),directory=path.join(out,'domain');
fs.cpSync(source,directory,{recursive:true,filter:entry=>!entry.endsWith('.lock')});
const require=createRequire(import.meta.url),{CoreClient}=require('../desktop/build/craftmine.world/core-client.cjs'),{createHostRequests}=require('../desktop/build/craftmine.world/host-requests.cjs');
const core=new CoreClient(process.env.CRAFTMINE_CORE_BINARY??path.join(root,'vendor/pi-desktop/target/release/craftmine-core.exe'),directory);
const worldId='world-e2b39ed23ff7',report={out,calls:[],errors:[]};
let service;
try{
 await core.start();const host=createHostRequests(core,{getSettings:async()=>({activeWorldId:worldId})});
 const before=await host('content.status',{worldId}),world=await host('world.read',{id:worldId}),formal=await host('godotRuntime.exportSource',{worldId});
 report.before={content:before,world,formal};
 service=createCreationGroundMaintenance({resourcesRoot:path.join(root,'desktop/godot'),selection:async()=>worldId,instance:()=>({worldId,buildId:formal.buildId,instanceId:'isolated-core-test'}),deadlineMs:1000,
  domain:async(method,args)=>{report.calls.push({method,args});return host(method,args);},
  applyVerified:async()=>{throw Error('TEST_MUST_NOT_APPLY_WITHOUT_EXECUTOR');}});
 await assert.rejects(service.start(worldId),/GROUND_UPGRADE_CHECK_TIMEOUT|GROUND_UPGRADE_CHECK_FAILED|GODOT_EXECUTOR|CHECK_|EXECUTOR_|unavailable|UNAVAILABLE/);
 const status=service.status(worldId),after=await host('content.status',{worldId});report.after={content:after,status};
 assert.equal(after.headOid,before.headOid,'main draft head preserved');assert.equal(after.appliedOid,before.appliedOid,'formal content untouched without check');
 assert.deepEqual((await host('world.read',{id:worldId})).world,world.world,'all world content and progress retained');
 assert.ok(report.calls.some(c=>c.method==='godotProject.patch'),'real core patch accepted');
 assert.ok(report.calls.some(c=>c.method==='godotBuild.start'),'real core candidate check submitted');
 const buildCall=report.calls.find(c=>c.method==='godotBuild.start');
 const latest=await core.call('godotBuild.latest',{worldId});report.checkGate=latest;
 assert.match(status.reason,/EXECUTION_UNAVAILABLE|CHECK_TIMEOUT|CHECK_FAILED/);
 // Also exercise the exact private cancellation schema against this terminal
 // job. Terminal cancellation is harmless and must remain idempotent.
 const job=latest.job??latest;
 if(job.jobId)report.cancel=await host('godotBuild.cancel',{worldId,jobId:job.jobId});
 assert.equal(report.calls.at(-1).method,'workspace.endTurn');
}catch(error){report.errors.push(String(error.stack));process.exitCode=1;}
finally{await service?.stopAll();await core.stop();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,errors:report.errors,methods:report.calls.map(c=>c.method)}));}
