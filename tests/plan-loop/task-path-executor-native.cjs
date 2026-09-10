'use strict';
// Real pinned broker discovery + real core job failure/restart; no browser/model.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
const {createGodotExecutor}=require('../../plugins/craftmine-world/godot-executor.cjs');
const args={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];assert(['--core','--broker','--runtime','--out'].includes(k)&&!args[k]&&path.isAbsolute(v));args[k]=v;}
for(const key of ['--core','--broker','--runtime','--out'])assert(args[key]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=args['--out'],runtime=args['--runtime'],broker=args['--broker'];fs.mkdirSync(out);
const suffix='/godot/tasks/im-000000000000000000000000/work/Packages/craftmine.godot.task.im-000000000000000000000000/AC/Godot';
const base=path.join(out,'data-');const padding=266-base.length-suffix.length;assert(padding>0);
const dataPath=base+'p'.repeat(padding);fs.mkdirSync(dataPath);
const coreDirectory=path.join(out,'core');fs.mkdirSync(coreDirectory);
const identity=path.join(out,'host-selected-broker-identity.json');
fs.writeFileSync(identity,JSON.stringify({format:'craftmine.godot-broker-identity/1',sha256:sha(fs.readFileSync(broker)),bytes:fs.statSync(broker).size,sourceCommit:'local-fixed-probe',protocolVersion:1}));
const report={format:'craftmine.task-path-executor-native/1',passed:false,cacheUtf16Units:dataPath.length+suffix.length,
 coreSha256:sha(fs.readFileSync(args['--core'])),brokerSha256:sha(fs.readFileSync(broker)),out,dataPath};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
let core=new CoreClient(args['--core'],coreDirectory),executor,checks=0;
const files=[{path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Fixed rejected import"\n'}];
const context={projectId:'path-budget',sessionId:'path-budget',turnId:'path-budget'};
(async()=>{
 try {
  await core.start();
  executor=createGodotExecutor(core,{dataPath,verifier:{godotCheck:async()=>{checks++;throw Error('Unexpected runtime check');}},
   logger:{log:(...v)=>fs.appendFileSync(path.join(out,'executor.log'),JSON.stringify(v)+'\n'),warn:(...v)=>fs.appendFileSync(path.join(out,'executor.log'),JSON.stringify(v)+'\n')},
   toolchain:{broker,brokerIdentity:identity,engineRoot:path.join(runtime,'engine/4.7.2-stable'),toolchainLock:path.join(runtime,'toolchain.lock.json'),bridgePath:path.join(runtime,'web/bridge.js')}});
  report.discovery=await executor.start();save();
  assert.equal(report.discovery.available,true);assert.equal(report.discovery.preflight.processVerified,true);
  assert.equal(report.discovery.preflight.networkVerified,true);assert.equal(report.discovery.preflight.cleanupVerified,true);
  const worldId='world-path-budget';
  await core.call('godotWorld.initialize',{worldId,title:'Fixed path failure',baseId:'first-person',baseBuild:'base-a',
   snapshot:{format:'craftmine.godot-progress/1',worldId,baseId:'first-person',baseVersion:'0.1.0',stateVersion:1,body:{worldId,player:{position:[0,0,0]},inventory:{}}}});
  await core.call('workspace.open',{context,selectedWorld:worldId});
  const project=await core.call('godotProject.create',{context,worldId,toolCallId:'create',baseBuild:'base-a',baseId:'first-person',files});
  const job=await core.call('godotBuild.start',{context,worldId,toolCallId:'check',revision:project.revision,manifestHash:project.manifestHash,mode:'check'});
  assert.equal(executor.enqueue(job).enqueued,true);
  const deadline=Date.now()+90000;let current;
  do {current=await core.call('godotBuild.read',{worldId,jobId:job.jobId});if(['failed','passed','cancelled','interrupted','blocked'].includes(current.status))break;assert(Date.now()<deadline,'job deadline');await new Promise(r=>setTimeout(r,100));}while(true);
  report.job=current;report.ledger=executor.ledger;save();
  assert.equal(current.status,'failed');assert.deepEqual(current.output.compile.errors,['GODOT_TASK_PATH_TOO_LONG']);assert.equal(checks,0);
  report.candidate=await core.call('godotCandidate.read',{worldId,candidateId:current.candidateId});
  assert.notEqual(report.candidate.candidate.status,'ready');assert.deepEqual(current.output.artifacts,[]);
  const attempt=executor.ledger.jobs[job.jobId].attempts[0];assert.equal(attempt.operation,'import');assert.match(attempt.failure.error,/^GODOT_TASK_PATH_TOO_LONG:/);
  assert.equal(fs.existsSync(path.join(dataPath,'godot/tasks',attempt.requestId)),false);
  report.before=await core.call('godotWorld.initStatus',{worldId});assert.equal(report.before.reason,'GODOT_TASK_PATH_TOO_LONG');assert.equal(report.before.playable,false);
  const original=await core.call('godotProject.read',{context,worldId,revision:project.revision,manifestHash:project.manifestHash,path:'project.godot'});assert.equal(original.text,files[0].text);
  await executor.stop();executor=null;await core.stop();core=new CoreClient(args['--core'],coreDirectory);await core.start();
  report.after=await core.call('godotWorld.initStatus',{worldId});assert.equal(report.after.reason,report.before.reason);assert.equal(report.after.status,'failed');assert.equal(report.after.playable,false);
  report.passed=true;
 }catch(error){report.error=String(error.stack??error);process.exitCode=1;}
 finally{try{await executor?.stop();await core.stop();}catch(error){report.shutdownError=String(error);report.passed=false;process.exitCode=1;}report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
})();
