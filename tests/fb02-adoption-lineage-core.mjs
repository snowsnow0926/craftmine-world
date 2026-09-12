// Read actual persisted adoption and Git ancestry from a copied successful
// native lifecycle run, rather than manufacturing application receipts.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {DatabaseSync} from 'node:sqlite';
const repo=path.resolve(import.meta.dirname,'..'),input=path.resolve(process.argv[2]??'');
assert.ok(input.startsWith(path.join(repo,'test-results')+path.sep),'requires an isolated native lifecycle report');
const native=JSON.parse(fs.readFileSync(input,'utf8'));
assert.ok(native.passed&&native.settled?.maintenance?.status==='applied','requires a successful actual native adoption + maintenance successor');
const directory=fs.mkdtempSync(path.join(repo,'test-results/adoption-lineage-core-')),domain=path.join(directory,'domain');
fs.cpSync(path.join(native.profile,'plugins/data/craftmine.world'),domain,{recursive:true,filter:file=>!file.endsWith('.lock')});
const require=createRequire(import.meta.url),{CoreClient}=require('../desktop/build/craftmine.world/core-client.cjs');
const buildRequire=createRequire(path.join(repo,'vendor/pi-desktop/apps/desktop/package.json'));
const routerFile=path.join(directory,'host-requests.cjs');
await buildRequire('esbuild').build({entryPoints:[path.join(repo,'plugins/craftmine-world/host-requests.cjs')],outfile:routerFile,
  bundle:true,platform:'node',format:'cjs',plugins:[{name:'actual-domain-adapter',setup(build){
    build.onResolve({filter:/^\.\/domain\.cjs$/},()=>({path:path.join(repo,'plugins/craftmine-world/domain-adapter.mjs')}));
  }}]});
const {createHostRequests}=require(routerFile);
const core=new CoreClient(process.env.CRAFTMINE_CORE_BINARY??path.join(repo,'vendor/pi-desktop/target/debug/craftmine-core.exe'),domain);
const report={directory,input,checks:[]};
try{
  await core.start();
  const host=createHostRequests(core,{getSettings:async()=>({activeWorldId:native.worldId})});
  const latest=await host('godotBuild.latest',{worldId:native.worldId});
  const db=new DatabaseSync(path.join(domain,'tasks.sqlite'),{readOnly:true});
  const {sessionId}=JSON.parse(db.prepare('SELECT binding FROM craftmine_tasks WHERE id=?').get(latest.taskId).binding);db.close();
  const sessionOnly=await host('godotBuild.latest',{sessionId});
  assert.equal(sessionOnly.jobId,latest.jobId);assert.equal(sessionOnly.worldId,native.worldId);
  assert.equal((await host('godotBuild.latest',{worldId:native.worldId,sessionId})).jobId,latest.jobId);
  assert.equal(await host('godotBuild.latest',{sessionId:'missing-native-session'}),null);
  for(const invalid of [{},{sessionId:''},{sessionId:null},{worldId:null},{sessionId,context:{}},{worldId:native.worldId,script:'forged'}])await assert.rejects(host('godotBuild.latest',invalid));
  report.router={sessionId,jobId:sessionOnly.jobId,sessionOnlyAccepted:true,bothAccepted:true,foreignSessionReturnsNull:true,invalidRejected:6};
  report.checks.push('actual JS host router reaches Rust for session-only latest, with scope and strict field boundaries');
  const read=candidateId=>host('godotCandidate.read',{worldId:native.worldId,candidateId});
  report.successor=await read(native.candidate.candidateId);
  assert.equal(report.successor.adoption.wasApplied,true);assert.equal(report.successor.adoption.inCurrentLineage,true);
  assert.equal(report.successor.adoption.currentBuildId,native.settled.formal.world.build.id);
  assert.notEqual(report.successor.adoption.buildId,report.successor.adoption.currentBuildId);
  report.checks.push('real maintenance successor preserves original candidate adoption');
  const sibling=native.originalCandidates.items.find(c=>c.buildId===native.before.formal.world.build.id);
  assert.ok(sibling,'original pre-adoption maintenance candidate remains in history');
  report.sibling=await read(sibling.candidateId);
  assert.equal(report.sibling.adoption.wasApplied,true);assert.equal(report.sibling.adoption.inCurrentLineage,false);
  report.checks.push('a previously applied sibling branch is historical, not falsely current');
  report.current=await read(native.settled.maintenance.candidateId);
  assert.equal(report.current.adoption.wasApplied,true);assert.equal(report.current.adoption.inCurrentLineage,true);
  assert.equal(report.current.adoption.buildId,report.current.adoption.currentBuildId);
  report.checks.push('the actual formal candidate is current');
  report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await core.stop();fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,passed:report.passed,error:report.error,checks:report.checks}));}
