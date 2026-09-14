import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),sha=value=>createHash('sha256').update(value).digest('hex');
const {classifyLog}=require('../plugins/craftmine-world/godot-executor.cjs');
const {diagnoseGodotBuildRead:diagnose,projectNativeIsolationEvidence:project}=require('../plugins/craftmine-world/godot-diagnostics.cjs');
const {compactGodotBuildRead}=require('../plugins/craftmine-world/godot-tool-output.cjs');
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/native-isolation/provenance.json')));
function specimen(name='tree'){
  const log=fs.readFileSync(path.join(root,'tests/fixtures/native-isolation',name+'.log'),'utf8'),pin=fixtures.rows.find(row=>row.file===name+'.log');assert.equal(sha(log),pin.fixtureSha256);
  const record={jobId:'gjob-'+sha(name),worldId:'isolated-fixture-world',taskId:'task-'+name,buildId:'gbd-'+sha('build-'+name),sourceRevision:3,manifestHash:sha('source-'+name),assetManifestHash:sha('assets'),baseId:'creation-sandbox',baseBuild:'base',executorId:'craftmine-windows-broker-v1',kind:'check',status:'passed',sourceStale:false,
    output:{format:'craftmine.godot-job-result/1',inputHash:sha('input'),passed:true,import:{passed:true,log},compile:{passed:true,errors:[],warnings:[]},check:{passed:true,assertions:[{id:'runtime.no-errors',passed:true}]},engine:{version:'4.7.2-stable',isolation:'craftmine.windows.lpac-registry.v1',evidenceHash:sha('engine-evidence')}}};
  record.outputHash=sha(JSON.stringify(record.output));
  const entry={jobId:record.jobId,worldId:record.worldId,mode:'check',state:'finished',outcome:'passed',attempts:[{operation:'import',transport:'succeeded',outcome:'succeeded',journalRetired:true,failure:null}]};
  const manifest={format:'craftmine.godot-build-manifest/1',...Object.fromEntries(['worldId','buildId','sourceRevision','manifestHash','assetManifestHash','baseId','baseBuild'].map(key=>[key,record[key]])),files:[{path:'project.godot',bytes:1,sha256:sha('p')}]};
  return {record,entry,manifest};
}
const proof=f=>project(f.record,{entry:f.entry,manifest:f.manifest,classified:classifyLog(f.record.output.import.log)});
const known=report=>report.diagnostics.filter(item=>item.category==='native-isolation');
for(const name of ['tree','meadow'])test(name+' real sanitized log reuses executor classification, retains all evidence and stops requesting source/environment repair',()=>{
  const f=specimen(name),before=JSON.stringify(f),classified=classifyLog(f.record.output.import.log);assert.equal(classified.native.length,11);assert.deepEqual(classified.errors,[]);
  assert.equal(known(diagnose(f.record)).length,0,'a model-facing record cannot self-attest');
  const nativeIsolation=proof(f);assert.equal(nativeIsolation.status,'verified');assert.deepEqual(nativeIsolation.native,classified.native);
  const report=diagnose(f.record,{status:'unknown',nativeIsolation});assert.equal(known(report).length,11);assert.equal(report.nativeIsolationEvidenceBinding,'matched');assert.equal(report.reportedStatus,'passed');assert.equal(report.acceptance,'not-assessed');assert.match(report.playerSummary,/检查已通过/);
  for(const item of known(report)){assert.equal(item.unknown,false);assert.equal(item.attribution,'known-check-environment');assert.equal(item.file,null);assert.equal(item.nextStep.id,'retain-known-check-environment-observation');assert.match(item.nextStep.message,/不必在完成回复重复/);assert.equal(item.evidenceRefs[0].sha256,sha(f.record.output.import.log));}
  const compact=compactGodotBuildRead({...f.record,diagnostics:report});assert.equal(compact.diagnostics.diagnostics.length,5);assert.equal(compact.diagnostics.diagnostics.reduce((n,row)=>n+row.occurrences,0),11);assert.equal(compact.output.import.log.sha256,nativeIsolation.logSha256);assert.equal(JSON.stringify(f),before);
});
const invalid={
  'different engine':f=>{f.record.output.engine.version='other';},
  'different isolation':f=>{f.record.output.engine.isolation='none';},
  'different executor':f=>{f.record.executorId='other';},
  'wrong ledger world':f=>{f.entry.worldId='other';},
  'wrong build':f=>{f.manifest.buildId='other';},
  'wrong source':f=>{f.manifest.manifestHash=sha('changed');},
  'unverified import':f=>{f.entry.attempts[0].transport='failed';},
  'unretired import':f=>{f.entry.attempts[0].journalRetired=false;},
  'same message at wrong exact frame':f=>{f.record.output.import.log=f.record.output.import.log.replace('get_local_interfaces (drivers/windows/ip_windows.cpp:117)','elsewhere (core/other.cpp:1)');},
  'new unknown ERROR alongside known noise':f=>{f.record.output.import.log+='\nERROR: New condition from a different subsystem\n   at: other (core/new.cpp:99)\n';},
  'script error alongside known noise':f=>{f.record.output.import.log+='\nSCRIPT ERROR: Parse Error: Unexpected identifier\n   at: GDScript::reload (res://world.gd:4)\n';},
};
for(const [name,mutate] of Object.entries(invalid))test(name+' cannot be downgraded by a passed status or a partial match',()=>{
  const f=specimen();mutate(f);const nativeIsolation=proof(f);assert.equal(nativeIsolation.status,'unknown');const report=diagnose(f.record,{status:'unknown',nativeIsolation});assert.equal(known(report).length,0);assert.equal(report.playerSummary,undefined);
  if(name.startsWith('script'))assert(report.diagnostics.some(item=>item.category==='parse'));
});
test('failed runtime assertion remains failed even when its import observations are known environment diagnostics',()=>{
  const f=specimen();f.record.status='failed';f.entry.outcome='failed';f.record.output.passed=false;f.record.output.check={passed:false,assertions:[{id:'runtime.collision',passed:false,detail:'Player falls through authored ground'}]};f.record.outputHash=sha(JSON.stringify(f.record.output));
  const report=diagnose(f.record,{status:'unknown',nativeIsolation:proof(f)});assert.equal(known(report).length,11);assert.equal(report.reportedStatus,'failed');assert.equal(report.reportedCheckPassed,false);assert.equal(report.playerSummary,undefined);assert(report.diagnostics.some(item=>item.category==='runtime'&&item.assertionRef.id==='runtime.collision'));
});
test('proof binding, log hash and full frame cannot be forged through the record or reused after changes',()=>{
  for(const field of ['outputHash','jobId','manifestHash']){const f=specimen(),p=proof(f);p.binding[field]='changed';assert.equal(known(diagnose(f.record,{nativeIsolation:p})).length,0);}
  const f=specimen(),p=proof(f);f.record.nativeIsolation=p;assert.equal(known(diagnose(f.record)).length,0);
  p.logSha256=sha('other');assert.equal(known(diagnose(f.record,{nativeIsolation:p})).length,0);
});

const packed=path.resolve(process.env.CRAFTMINE_DIAGNOSTIC_PLUGIN??path.join(root,'test-results/native-diagnostics-plugin'));
const {createGodotExecutor}=require(path.join(packed,'godot-executor.cjs'));
const {createWorldTools}=require(path.join(packed,'world-tools.cjs'));
test('packaged private executor evidence reaches real build_read summary/full without spawning or writing receipts',async()=>{
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const data=fs.mkdtempSync(path.join(root,'test-results/isolation-evidence-')),f=specimen();
  fs.mkdirSync(path.join(data,'godot'));const ledgerFile=path.join(data,'godot/executor-ledger.json'),ledgerBytes=JSON.stringify({format:'craftmine.godot-executor-ledger/1',executorId:'craftmine-windows-broker-v1',jobs:{[f.record.jobId]:f.entry}});fs.writeFileSync(ledgerFile,ledgerBytes);
  const build=path.join(data,'godot-builds',sha(f.record.worldId),f.record.buildId);fs.mkdirSync(build,{recursive:true});fs.writeFileSync(path.join(build,'manifest.json'),JSON.stringify(f.manifest));
  const calls=[],core={start:async()=>({}),call:async(method,args)=>{calls.push(method);if(method==='workspace.open')return {worldId:f.record.worldId,task:{binding:{taskId:f.record.taskId}}};if(method==='godotBuild.read')return structuredClone(f.record);if(method==='godotRuntime.describe')throw Object.assign(Error('not yet initialized'),{errorCode:'GODOT_WORLD_NOT_INITIALIZED'});throw Error(method);}};
  const executor=createGodotExecutor(core,{dataPath:data,spawnBroker:()=>{throw Error('must not spawn');},runRecovery:()=>{throw Error('must not recover');}});
  const tools=createWorldTools(core,async()=>({activeWorldId:f.record.worldId}),()=>false,undefined,undefined,{executorNativeDiagnosticEvidence:record=>executor.nativeDiagnosticEvidence(record)}),tool=tools.find(tool=>tool.name==='godot_build_read');
  const context={projectId:'p',sessionId:'s',turnId:'t',executionId:'e',toolCallId:'read'};
  const result=await tool.execute({jobId:f.record.jobId},context);assert.equal(result.diagnostics.nativeIsolationEvidenceBinding,'matched');assert.equal(result.diagnostics.diagnostics.length,5);assert.match(result.diagnostics.playerSummary,/检查已通过/);
  const full=await tool.execute(result.summary.fullRead.args,context);assert.deepEqual(full.output,f.record.output);assert.equal(full.outputHash,f.record.outputHash);assert.equal(known(full.diagnostics).length,11);assert.equal(fs.readFileSync(ledgerFile,'utf8'),ledgerBytes);assert(calls.every(method=>['workspace.open','godotBuild.read','godotRuntime.describe'].includes(method)));
  await assert.rejects(tool.execute({jobId:f.record.jobId,nativeIsolation:proof(f)},context));
});
