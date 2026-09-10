// Actual production CoreClient/executor/verifier chain in an owned profile.
import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {createGodotExecutor} from '../../plugins/craftmine-world/godot-executor.cjs';
import {GodotBuildVerifier} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';
const out=process.env.CRAFTMINE_FEEDBACK_CHAIN_OUT;
const report={kind:'actual-core-executor-broker-godot-web-electron-finite-requirements',checks:[],cases:[],rpc:[],limits:['Authored source; no model or user input.','Checks candidate admission and rejection, not positive candidate adoption.']};
const write=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
let core,executor;
const finish=async(code)=>{await executor?.stop().catch(()=>{});await core?.stop().catch(()=>{});write();app.exit(code);};
const fatal=async error=>{report.passed=false;report.failure=String(error?.stack??error);await finish(1);};
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);app.on('window-all-closed',()=>{});
const check=(name,ok)=>{report.checks.push({name,passed:!!ok});write();assert.ok(ok,name);};
app.whenReady().then(async()=>{
 core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(out,'core-data'));
 report.hello=await core.start();
 const recorder={call:async(method,args={},timeout)=>{
  try{const result=await core.call(method,args,timeout);if(['godotJob.claim','godotJob.checkDescriptor','godotJob.finish'].includes(method)){report.rpc.push({method,args,result});write();}return result;}
  catch(error){report.rpc.push({method,args,error:String(error)});write();throw error;}
 }};
 const verifier=new GodotBuildVerifier({deadlineMs:180000});
 executor=createGodotExecutor(recorder,{dataPath:path.join(out,'core-data'),logger:console,verifier:{godotCheck:async descriptor=>{
  const item=report.cases.find(c=>c.job.jobId===descriptor.jobId);assert.ok(item,'descriptor uses actual started core job');
  item.descriptor=descriptor;write();const evidence=await verifier.check(descriptor);item.runtime=evidence;write();return evidence;
 },cancelGodotCheck:id=>verifier.cancel(String(id))}});
 report.preflight=await executor.start();write();check('actual executor preflight and check available',report.preflight.available===true&&report.preflight.checkAvailable===true);
 const fixtures=JSON.parse(fs.readFileSync(path.join(out,'fixtures.json'),'utf8'));
 for(const fixture of fixtures){
  const {worldId,name,snapshot,files}=fixture,context={projectId:'finite-chain',sessionId:name,turnId:'source'};
  await core.call('world.create',{id:worldId,title:name,world:{build:{id:'base-'+name,scene:{format:'craftmine.godot-scene/1',baseId:'first-person'},godot:{}},snapshot,extensions:[]}});
  await core.call('workspace.open',{context,selectedWorld:worldId});
  let project=await core.call('godotProject.create',{context,worldId,toolCallId:'create-'+name,baseBuild:'base-'+name,baseId:'first-person',files:[{path:'project.godot',text:Buffer.from(files.find(f=>f.path==='project.godot').bytesBase64,'base64').toString('utf8')}]});
  project=await core.call('godotProject.applyFiles',{context,worldId,toolCallId:'sources-'+name,revision:project.revision,manifestHash:project.manifestHash,files:files.filter(f=>f.path!=='project.godot').map(f=>({...f,expectedHash:null}))},30000);
  await core.call('content.migrate.apply',{worldId},30000);
  project=await core.call('godotProject.index',{context,worldId});
  const before=await core.call('world.read',{id:worldId});
  const job=await core.call('godotBuild.start',{context,worldId,toolCallId:'check-'+name,revision:project.revision,manifestHash:project.manifestHash,mode:'check',checkRequirements:{format:'craftmine.godot-check-requirements/1',targetFeedback:{targetId:'target_a',hitFlashMilliseconds:500}}},30000);
  const item={name,worldId,job,before};report.cases.push(item);write();
  check(name+' job queued',executor.enqueue({jobId:job.jobId,worldId,mode:'check'}).enqueued===true);
  const deadline=Date.now()+360000;
  for(;;){item.terminal=await core.call('godotBuild.read',{worldId,jobId:job.jobId});if(['passed','failed','cancelled','interrupted'].includes(item.terminal.status))break;if(Date.now()>deadline)throw Error('CHECK_JOB_TIMEOUT');await new Promise(r=>setTimeout(r,300));}
  item.candidate=await core.call('godotCandidate.read',{worldId,candidateId:item.terminal.candidateId});
  const evidence=item.runtime;check(name+' actual descriptor/evidence identity unchanged',evidence.jobId===job.jobId&&evidence.buildId===job.buildId&&evidence.worldId===worldId&&evidence.requirementsEvidence.instanceId===evidence.ready.instanceId);
  check(name+' finish preserved exact actual evidence',canonical(item.terminal.output.check.requirementsEvidence)===canonical(evidence.requirementsEvidence));
  if(name==='positive'){
   check('500 runtime passed',evidence.passed===true&&evidence.requirementsEvidence.observations.every(e=>e.hitFlashMilliseconds===500));
   check('500 job passed and candidate ready',item.terminal.status==='passed'&&item.candidate.candidate.status==='ready');
  }else{
   check('700 runtime actually failed',evidence.passed===false&&evidence.requirementsEvidence.observations[0].hitFlashMilliseconds===700&&evidence.assertions.find(a=>a.id==='runtime.target-feedback')?.passed===false);
   check('700 durable job failed and candidate rejected',item.terminal.status==='failed'&&item.candidate.candidate.status==='rejected');
   try{await core.call('godotApplication.prepare',{id:'rejected-apply',token:'rejected-token',candidateId:item.terminal.candidateId,worldId,revision:before.revision,snapshot:before.world.snapshot});throw Error('REJECTED_CANDIDATE_APPLIED');}catch(error){item.prepareError=String(error);check('700 prepare rejects not-ready candidate',String(error).includes('GODOT_CANDIDATE_NOT_READY'));}
  }
  item.after=await core.call('world.read',{id:worldId});check(name+' complete formal world unchanged',canonical(item.after)===canonical(before));write();
 }
 await executor.stop();executor=null;await core.stop();report.restarted=await core.start();
 for(const item of report.cases){item.afterRestart=await core.call('world.read',{id:item.worldId});item.candidateAfterRestart=await core.call('godotCandidate.read',{worldId:item.worldId,candidateId:item.terminal.candidateId});check(item.name+' formal world and candidate durable after core restart',canonical(item.afterRestart)===canonical(item.before)&&item.candidateAfterRestart.candidate.status===item.candidate.candidate.status);}
 report.passed=true;await finish(0);
}).catch(fatal);
function canonical(value){return Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);}
