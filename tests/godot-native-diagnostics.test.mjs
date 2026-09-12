import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const {diagnoseGodotBuildRead:diagnose,projectNativeImportEvidence:project}=require('../plugins/craftmine-world/godot-diagnostics.cjs');
const archive=path.join(root,'docs/evidence/ga27-legacy-bases-20260912');
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const raw=(await json(path.join(archive,'side-view-failed-jobs.json'))).jobs[0];
const original={jobId:raw.id,worldId:raw.world_id,taskId:raw.task_id,kind:raw.kind,buildId:raw.build_id,
  sourceRevision:raw.source_revision,manifestHash:raw.manifest_hash,baseId:raw.base_id,status:raw.status,
  executorId:raw.executor_id,output:raw.output,outputHash:raw.output_hash};
const originalLedger=await json(path.join(archive,'side-view/executor-ledger.json'));
const originalManifest=await json(path.join(archive,'side-view/source-manifest.json'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const brokerSha256='36fafb48717429560d60b818d02e4d8bbea9e1ed26454206bb8733720ab7a12c';
const specimen=()=>({record:structuredClone(original),entry:structuredClone(originalLedger.jobs[original.jobId]),manifest:structuredClone(originalManifest),brokerSha256});
const crashes=report=>report.diagnostics.filter(item=>item.category==='native-crash');
const rehash=f=>{f.record.outputHash=sha(JSON.stringify(f.record.output));};

test('actual archived job alone reproduces generic failure; original validated attempt gives narrow native diagnostic',async()=>{
  const f=specimen(),before=JSON.stringify(f);
  assert.equal(crashes(diagnose(f.record)).length,0);
  const log=await fs.readFile(path.join(archive,'side-view/im-8da9c139ecd5472c9cfdb320/task.log'));
  assert.equal(log.toString('utf8'),f.record.output.import.log);
  assert.equal(sha(log),f.entry.attempts[0].retryDecision.logSha256);
  const proof=project(f.record,f),report=diagnose(f.record,proof);
  assert.equal(proof.status,'verified');assert.equal(report.nativeEvidenceBinding,'matched');
  assert.equal(crashes(report).length,1);const item=crashes(report)[0];
  assert.equal(item.nativeProcess.requestId,f.entry.attempts[0].requestId);
  assert.notEqual(item.nativeProcess.requestId,f.entry.attempts[1].requestId,'the second unvalidated exit is not promoted');
  assert.equal(item.nativeProcess.rootCause,'unknown');assert.equal(item.file,null);assert.equal(item.line,null);
  assert.equal(item.attribution,'not-determined');assert.equal(report.reportedStatus,'failed');assert.equal(report.reportedOutputPassed,false);
  assert.equal(report.acceptance,'not-assessed');assert.deepEqual(item.source.outputHash,original.outputHash);
  assert.equal(JSON.stringify(f),before);assert.ok(!JSON.stringify(report).includes('SessionDefault'));
});
const negatives={
  'raw exit without validation stamp':f=>{delete f.entry.attempts[0].retryDecision;},
  'wrong world':f=>{f.entry.worldId='other';},
  'wrong job':f=>{f.entry.jobId='gjob-'+'a'.repeat(64);},
  'wrong build':f=>{f.manifest.buildId='gbd-'+'a'.repeat(64);},
  'wrong source revision':f=>{f.manifest.sourceRevision++;},
  'wrong source manifest':f=>{f.manifest.manifestHash='a'.repeat(64);},
  'changed source digest':f=>{f.manifest.files[0].sha256='a'.repeat(64);},
  'malformed output hash':f=>{f.record.outputHash='unverified';},
  'missing input hash':f=>{delete f.record.output.inputHash;},
  'wrong broker pin':f=>{f.brokerSha256='a'.repeat(64);},
  'changed log':f=>{f.record.output.import.log+='\nChanged';rehash(f);},
  'ordinary nonzero exit':f=>{f.entry.attempts[0].failure.engineExitCode=1;},
  'unverified broker transport':f=>{f.entry.attempts[0].failure.exitCode=3221225477;},
  'native timeout':f=>{f.entry.attempts[0].timedOut=true;},
  'native cancellation':f=>{f.entry.attempts[0].failure.cancelled=true;},
  'cancelled job':f=>{f.record.status='cancelled';},
  'interrupted job':f=>{f.record.status='interrupted';},
  'resource enforcement':f=>{f.entry.attempts[0].failure.resources.enforced=true;},
  'cleanup unverified':f=>{f.entry.attempts[0].failure.cleanup.verified=false;},
  'parse log even with rewritten stamp':f=>{f.record.output.import.log+='\nSCRIPT ERROR: Parse Error: Unexpected identifier\n   at: GDScript::reload (res://world.gd:4)';f.entry.attempts[0].retryDecision.logSha256=sha(f.record.output.import.log);rehash(f);},
  'compile parse diagnostic absent from import log':f=>{f.record.output.compile.errors.push('Parse Error: Unexpected identifier');rehash(f);},
  'later same-source success':f=>{f.record.status='passed';f.record.output.passed=true;rehash(f);},
};
for(const [name,mutate] of Object.entries(negatives))test(name+' cannot be labelled native crash',()=>{
  const f=specimen();mutate(f);const proof=project(f.record,f);assert.equal(proof.status,'unknown');assert.equal(crashes(diagnose(f.record,proof)).length,0);
});
test('record-carried forged native proof is ignored and wrong projection binding rejected',()=>{
  const f=specimen(),proof=project(f.record,f);f.record.nativeEvidence=proof;
  assert.equal(crashes(diagnose(f.record)).length,0);
  proof.binding.outputHash='a'.repeat(64);assert.equal(diagnose(f.record,proof).nativeEvidenceBinding,'mismatch');
});
test('core JSON map ordering does not replace the verified stored output hash',()=>{
  const f=specimen(),sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;
  f.record.output=sort(f.record.output);assert.notEqual(sha(JSON.stringify(f.record.output)),f.record.outputHash);
  assert.equal(crashes(diagnose(f.record,project(f.record,f))).length,1);
});

// This suite deliberately requires a real build-world-plugin output. Core RPC
// returns the archived row as a fixture; no engine, model or user profile runs.
const packed=path.resolve(process.env.CRAFTMINE_DIAGNOSTIC_PLUGIN||path.join(root,'test-results/native-diagnostics-plugin'));
const {createWorldTools}=require(path.join(packed,'world-tools.cjs'));
const {createGodotExecutor}=require(path.join(packed,'godot-executor.cjs'));
async function installedFixture(t,{mutate=()=>{},wait=false,provider=true}={}){
  const temp=await fs.mkdtemp(path.join(tmpdir(),'cm-native-diagnostics-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const f=specimen();mutate(f);
  const ledger={...structuredClone(originalLedger),jobs:{[original.jobId]:f.entry}};
  await fs.mkdir(path.join(temp,'godot'),{recursive:true});
  const ledgerPath=path.join(temp,'godot/executor-ledger.json');await fs.writeFile(ledgerPath,JSON.stringify(ledger));
  const buildRoot=path.join(temp,'godot-builds',sha(original.worldId),original.buildId);await fs.mkdir(buildRoot,{recursive:true});
  await fs.writeFile(path.join(buildRoot,'manifest.json'),JSON.stringify(f.manifest));
  const pin=path.join(temp,'broker-identity.json');await fs.writeFile(pin,JSON.stringify({format:'craftmine.godot-broker-identity/1',sha256:f.brokerSha256,bytes:1}));
  const calls=[];let selected=original.worldId,ended=false;
  const core={start:async()=>({}),call:async(method,args)=>{calls.push(method);
    if(method==='workspace.open')return {worldId:original.worldId,task:{binding:{taskId:original.taskId}}};
    if(method==='godotBuild.read'){assert.equal(args.worldId,original.worldId);assert.equal(args.jobId,original.jobId);return structuredClone(f.record);}
    throw Error('Unexpected RPC '+method);
  }};
  const executor=createGodotExecutor(core,{dataPath:temp,toolchain:{brokerIdentity:pin},
    spawnBroker:()=>{throw Error('Must not spawn broker');},runRecovery:()=>{throw Error('Must not recover');}});
  let projectionHook=record=>executor.nativeDiagnosticEvidence(record),providerCalls=0;
  const options={...(wait?{buildReadWaitMs:1}:{}),...(provider?{executorNativeDiagnosticEvidence:async record=>{providerCalls++;return projectionHook(record);}}:{})};
  const tool=createWorldTools(core,async()=>({activeWorldId:selected}),()=>ended,undefined,undefined,options).find(tool=>tool.name==='godot_build_read');
  const invoke=args=>tool.execute(args??{jobId:original.jobId},{projectId:'fixture',sessionId:'fixture',turnId:'fixture',executionId:'fixture',toolCallId:'read'});
  return {f,temp,buildRoot,ledgerPath,calls,executor,invoke,setHook(fn){projectionHook=fn;},switchWorld(){selected='other';},end(){ended=true;},get providerCalls(){return providerCalls;}};
}
for(const wait of [false,true])test('actual packaged build_read '+(wait?'wait':'direct')+' projects archived host ledger without mutations',async t=>{
  const f=await installedFixture(t,{wait}),before=await fs.readFile(f.ledgerPath);
  const result=await f.invoke();assert.equal(crashes(result.diagnostics).length,1);
  assert.deepEqual(result.output,original.output);assert.equal(result.outputHash,original.outputHash);assert.equal(result.status,'failed');
  assert.deepEqual(await fs.readFile(f.ledgerPath),before);assert.equal(f.providerCalls,1);
  assert.deepEqual(f.calls,['workspace.open','godotBuild.read']);
  assert.ok(!JSON.stringify(result.diagnostics).includes(f.temp));assert.ok(!JSON.stringify(result.diagnostics).includes('stderr'));
});
for(const name of ['raw exit without validation stamp','wrong world','wrong source revision','changed source digest','parse log even with rewritten stamp','native timeout','cancelled job'])test('packaged model read: '+name+' remains unverified',async t=>{
  const f=await installedFixture(t,{mutate:negatives[name]});assert.equal(crashes((await f.invoke()).diagnostics).length,0);
});
test('missing private wiring and missing build files remain unknown; forged model arguments rejected',async t=>{
  const absent=await installedFixture(t,{provider:false});assert.equal((await absent.invoke()).diagnostics.nativeEvidenceBinding,'unknown');
  const f=await installedFixture(t);await fs.unlink(path.join(f.buildRoot,'manifest.json'));assert.equal(crashes((await f.invoke()).diagnostics).length,0);
  await assert.rejects(f.invoke({jobId:original.jobId,nativeEvidence:{status:'verified'}}),error=>error.code==='INVALID_ARGUMENTS');assert.equal(f.providerCalls,1);
});
test('private build directory junction is rejected without following an alternate manifest',async t=>{
  const f=await installedFixture(t),moved=path.join(f.temp,'relocated-build');
  await fs.rename(f.buildRoot,moved);await fs.symlink(moved,f.buildRoot,process.platform==='win32'?'junction':'dir');
  assert.equal(crashes((await f.invoke()).diagnostics).length,0);
});
test('a later successful ledger entry cannot overwrite or relabel this archived failed job',async t=>{
  const f=await installedFixture(t),ledger=await json(f.ledgerPath),laterId='gjob-'+'f'.repeat(64);
  ledger.jobs[laterId]={...structuredClone(f.f.entry),jobId:laterId,state:'finished',outcome:'passed'};
  await fs.writeFile(f.ledgerPath,JSON.stringify(ledger));
  const result=await f.invoke();assert.equal(result.status,'failed');assert.equal(crashes(result.diagnostics).length,1);
  assert.equal(crashes(result.diagnostics)[0].source.jobId,original.jobId);assert.equal(result.outputHash,original.outputHash);
});
test('private projection failure preserves the original failed result without private error leakage',async t=>{
  const f=await installedFixture(t);f.setHook(async()=>{throw Error(f.temp+' private failure');});
  const result=await f.invoke();assert.deepEqual(result.output,original.output);assert.equal(result.status,'failed');
  assert.equal(result.diagnostics.nativeEvidenceBinding,'unknown');assert.ok(!JSON.stringify(result).includes(f.temp));
});
for(const change of ['switchWorld','end'])test('private evidence await rechecks '+change,async t=>{
  const f=await installedFixture(t);f.setHook(async record=>{const proof=await f.executor.nativeDiagnosticEvidence(record);f[change]();return proof;});
  await assert.rejects(f.invoke(),change==='end'?/TURN_ENDED/:/GODOT_BUILD_READ_WORLD_CHANGED/);
});
test('production main wires the private provider and packaging preserves exact modules',async()=>{
  const main=await fs.readFile(path.join(packed,'main.cjs'),'utf8');assert.match(main,/executorNativeDiagnosticEvidence:record=>godotExecutor.nativeDiagnosticEvidence\(record\)/);
  for(const file of ['godot-diagnostics.cjs','godot-executor.cjs','world-tools.cjs','tool-services.cjs','main.cjs'])assert.deepEqual(await fs.readFile(path.join(packed,file)),await fs.readFile(path.join(root,'plugins/craftmine-world',file)));
});
