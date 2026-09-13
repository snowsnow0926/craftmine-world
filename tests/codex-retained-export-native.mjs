// Real Core/broker/checker continuation in a NEW profile. The first failure is
// intentionally missing verifier wiring, never a model/authoring failure.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {main} from '../scripts/codex-world-author.mjs';
import {readState,acquireLock} from '../scripts/lib/codex-world-session.mjs';
import {CodexWorldHost} from '../scripts/lib/codex-world-host.mjs';
import {startCodexLiveService} from '../scripts/lib/codex-live-service.mjs';

const [runtime,plugin,coreBinary,data]=process.argv.slice(2);
for(const value of [runtime,plugin,coreBinary,data])assert(value&&path.isAbsolute(value),'Pass absolute component runtime, staged plugin, rebuilt Core and NEW profile');
await main(['init','--data',data,'--runtime',runtime,'--plugin',plugin,'--world','reuse-'+randomUUID()]);
const state=readState(data),unlock=acquireLock(data),{CoreClient}=createRequire(import.meta.url)(path.join(plugin,'core-client.cjs'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const nativePath=value=>path.resolve(value.startsWith(String.fromCharCode(92,92,63,92))?value.slice(4):value);
const claims=new Map(),descriptors=new Map(),checks=[];
const report={format:'craftmine.retained-export-native-test/1',passed:false,data,worldId:state.worldId,modelCalls:0,
  originFailure:'controlled missing host verifier, not a model failure',checks};
let host,live,context;
async function start(verify) {
  const core=new CoreClient(coreBinary,state.coreData),call=core.call.bind(core);
  core.call=async(method,args,...rest)=>{
    const result=await call(method,args,...rest);
    if(method==='godotJob.claim')claims.set(args.jobId,result);
    if(method==='godotJob.checkDescriptor')descriptors.set(args.jobId,result);
    return result;
  };
  live=await startCodexLiveService({core,state,data});
  const verifier=verify?{godotCheck:async descriptor=>{
    const evidence=await live.verifier.godotCheck(descriptor);
    checks.push({jobId:descriptor.jobId,inputHash:descriptor.inputHash,snapshot:descriptor.snapshot,evidence});return evidence;
  }}:{};
  host=new CodexWorldHost({state,data,core,services:{verifier}});
  // Godot only. No Blender or model request is involved in this component test.
  await host.start({engines:false});assert.equal((await host.executor.start()).available,true);
}
async function stop() {
  if(!host)return;
  await host.stop({beforeCoreStop:()=>live.stop()});
  const guard=JSON.parse(await fs.readFile(path.join(live.directory,'guards.json'),'utf8'));
  assert.deepEqual(guard.violations,[]);assert.deepEqual(guard.pageErrors,[]);assert.deepEqual(guard.shutdownFailures,[]);
  host=null;live=null;
}
async function begin(text){context={projectId:state.projectId,sessionId:state.sessionId,turnId:randomUUID()};await host.begin(context,text);}
const tool=(name,args={})=>host.tools.find(t=>t.name===name).execute(args,{...context,toolCallId:randomUUID(),executionId:'retained-export-native-test'});
async function terminal(jobId){for(;;){const job=await tool('godot_build_read',{jobId});if(['passed','failed','cancelled','interrupted','blocked'].includes(job.status))return job;}}
async function fingerprints(root,artifacts){
  assert(nativePath(root).startsWith(path.resolve(data)+path.sep),'faults and reads stay in this NEW fixture');
  const result=[];
  for(const artifact of artifacts){const file=path.join(nativePath(root),artifact.path),stat=await fs.stat(file),bytes=await fs.readFile(file);
    result.push({path:artifact.path,sha256:sha(bytes),bytes:bytes.length,mtimeMs:stat.mtimeMs,ino:stat.ino});}
  return result;
}
try {
  await start(false);await begin('Component fixture: run native export with intentionally missing verifier wiring.');
  const index=await tool('godot_project_index');
  const initial=await tool('godot_build_start',{mode:'check',revision:index.revision,manifestHash:index.manifestHash});
  const origin=await terminal(initial.jobId);assert.equal(origin.status,'failed');
  assert.equal(origin.output.import.passed,true);assert.equal(origin.output.compile.passed,true);assert(origin.output.artifacts.length);
  assert.equal(host.executor.ledger.jobs[origin.jobId].reason,'GODOT_VERIFIER_UNAVAILABLE');
  assert.equal(checks.length,0);const originalOutputHash=origin.outputHash;
  const root=claims.get(origin.jobId).artifactsRoot,artifacts=origin.output.artifacts;
  const before=await fingerprints(root,artifacts);
  report.origin={jobId:origin.jobId,buildId:origin.buildId,outputHash:originalOutputHash,artifacts,
    brokerOperations:host.executor.ledger.jobs[origin.jobId].attempts.map(a=>a.operation)};
  assert(report.origin.brokerOperations.includes('exportWeb'));
  await host.end(context,'completed');await stop();

  await start(true);await begin('Component fixture: continue the same failed export after a real Core/executor restart.');
  const resumed=await tool('godot_jobs',{mode:'resume',originJobId:origin.jobId});
  const next=await terminal(resumed.result.jobId);assert.equal(next.status,'passed',JSON.stringify(next.output));
  assert.equal(next.buildId,origin.buildId);assert.notEqual(next.jobId,origin.jobId);assert(next.candidateId);
  assert.equal(checks.length,1);assert.equal(checks[0].evidence.passed,true);
  assert.deepEqual(next.output.artifacts,artifacts);assert.deepEqual(await fingerprints(root,artifacts),before);
  assert.deepEqual(host.executor.ledger.jobs[next.jobId].attempts.map(a=>a.operation),['import']);
  const reuse=JSON.parse(next.output.check.assertions.find(a=>a.id==='export.reused').detail);
  assert.equal(reuse.originOutputHash,originalOutputHash);assert.equal(reuse.exportExecuted,false);
  await host.end(context,'completed');
  report.firstContinuation={jobId:next.jobId,candidateId:next.candidateId,reuse,outputHash:next.outputHash};
  const applied=await live.call('apply',{candidateId:next.candidateId});assert.equal(applied.status,'applied');
  const previous=await live.call('snapshot');await live.call('walk',{forward:1,right:0,frames:15});await live.call('pause');
  const saved=await live.call('save');assert.equal(saved.status,'persisted');assert.notDeepEqual(saved.snapshot.body.player.position,previous.state.body.player.position);
  report.capture=await live.capture();report.save=saved.receipt;
  const graphics=await live.call('diagnostics');assert.equal(graphics.graphics.angle,'platform-default');assert.equal(graphics.graphics.hardwareAcceleration,true);

  await begin('Component fixture: recheck the retained export against current native saved progress.');
  const again=await tool('godot_jobs',{mode:'resume',originJobId:origin.jobId});
  const latest=await terminal(again.result.jobId);assert.equal(latest.status,'passed',JSON.stringify(latest.output));
  assert.deepEqual(checks[1].snapshot,saved.snapshot);assert.notDeepEqual(checks[1].snapshot,descriptors.get(origin.jobId).snapshot);
  assert.notEqual(checks[1].inputHash,checks[0].inputHash);assert.notEqual(checks[1].evidence.ready.instanceId,checks[0].evidence.ready.instanceId);
  assert.equal(latest.buildId,origin.buildId);assert.deepEqual(await fingerprints(root,artifacts),before);
  assert.deepEqual(host.executor.ledger.jobs[latest.jobId].attempts.map(a=>a.operation),['import']);
  assert.equal((await tool('godot_build_read',{jobId:origin.jobId})).outputHash,originalOutputHash);
  report.latestContinuation={jobId:latest.jobId,candidateId:latest.candidateId,outputHash:latest.outputHash};
  await host.end(context,'completed');await live.call('close');

  // Negative fault injection only in this disposable fixture, after normal
  // save/close. The product must leave these deliberately corrupted bytes alone.
  await begin('Component fixture: verify artifact corruption and moved source are refused.');
  const corruptedFile=path.join(nativePath(root),'web/index.html');await fs.appendFile(corruptedFile,'\n<!-- deliberate integrity fault -->');
  const corruptHash=sha(await fs.readFile(corruptedFile));
  await assert.rejects(tool('godot_jobs',{mode:'resume',originJobId:origin.jobId}),/CORRUPT_GODOT_ARTIFACT/);
  assert.equal(sha(await fs.readFile(corruptedFile)),corruptHash);
  const current=await tool('godot_project_index'),file=await tool('godot_file_read',{revision:current.revision,manifestHash:current.manifestHash,path:'project.godot'});
  const text=file.text??file.content;assert(text.includes('config/name='));
  await tool('godot_project_patch',{revision:current.revision,manifestHash:current.manifestHash,operations:[{op:'put',path:'project.godot',expectedHash:current.files.find(f=>f.path==='project.godot').sha256,
    text:text.replace(/config\/name="[^"]*"/,'config/name="Changed source refusal fixture"')}]});
  await assert.rejects(tool('godot_jobs',{mode:'resume',originJobId:origin.jobId}),/GODOT_CONTINUATION_STALE/);
  assert.equal(sha(await fs.readFile(corruptedFile)),corruptHash);
  assert.equal((await tool('godot_build_read',{jobId:origin.jobId})).outputHash,originalOutputHash);
  report.negative={tamperedArtifacts:'rejected without rewriting',staleSource:'rejected',fixtureLeftCorrupt:true};
  await host.end(context,'completed');await stop();report.passed=true;
} finally {
  try{await stop();}catch(error){report.passed=false;report.cleanupError=String(error);process.exitCode=1;await live?.abandon();await host?.core.stop();}
  await fs.writeFile(path.join(data,'retained-export-report.json'),JSON.stringify(report,null,2));unlock();
}
console.log(JSON.stringify({passed:report.passed,report:path.join(data,'retained-export-report.json'),origin:report.origin?.jobId,candidate:report.latestContinuation?.candidateId}));
