// Diagnostic only. Replay the exact persisted failed check, never Core state.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {requirePackagedResources} from './helpers/template-import-expectations.mjs';

const [applicationRoot,resources,database,jobId]=process.argv.slice(2);
assert([applicationRoot,resources,database].every(v=>typeof v==='string'&&path.isAbsolute(v)),'ABSOLUTE_CHECKOUT_RESOURCES_DATABASE_REQUIRED');
assert.match(jobId??'',/^gjob-[a-f0-9]{64}$/);
const run=process.argv.includes('--run-replay');
assert(run!==process.argv.includes('--prepare-only'),'EXPLICIT_RUN_REPLAY_OR_PREPARE_ONLY_REQUIRED');
const results=path.resolve(process.env.CRAFTMINE_CHECK_REPLAY_OUTPUT_ROOT??path.join(import.meta.dirname,'../test-results'));
fs.mkdirSync(results,{recursive:true});const out=fs.mkdtempSync(path.join(results,'godot-check-replay-'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const report={format:'craftmine.godot-check-replay-diagnostic/1',diagnosticOnly:true,out,database,jobId,runRequested:run,coreJobWritten:false,candidateAdopted:false,artifactReads:[],limits:['Diagnostic replay does not finish the original failed Core job or adopt its candidate.','No model, source edit, import/export rebuild, real input, focus or Pointer Lock.','No deadline override: the packaged production verifier keeps its ordinary 30 second check limit.']};
const write=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
report.modelInvocationsByDriver=0;report.cancelFile=path.join(out,'cancel');
const readJob=()=>{const db=new DatabaseSync(database,{readOnly:true});try{return db.prepare('SELECT id,world_id,build_id,status,check_input,check_input_hash,output,output_hash FROM craftmine_godot_jobs WHERE id=?').get(jobId);}finally{db.close();}};
let original,launch,child,exit,ended=true,audit,ready=false;
let cancelled=false,cancelRequested=false;
const cancel=()=>{cancelled=true;report.cancelled=true;if(child?.connected&&!ended&&!cancelRequested){cancelRequested=true;void rpc('quit').catch(()=>{});}};
process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
const watcher=setInterval(()=>{if(fs.existsSync(report.cancelFile))cancel();},300);
const pending=new Map();
function rpc(method,payload){return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('HEADLESS_REPLAY_RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,payload});});}
try{
 original=readJob();assert(original&&original.status==='failed','ACTUAL_FAILED_JOB_REQUIRED');assert.equal(sha(original.check_input),original.check_input_hash,'STORED_DESCRIPTOR_HASH_MISMATCH');
 const descriptor=JSON.parse(original.check_input);assert.equal(descriptor.jobId,jobId);assert.equal(descriptor.worldId,original.world_id);assert.equal(descriptor.buildId,original.build_id);
 const packet={format:'craftmine.godot-check-replay/1',diagnosticOnly:true,sourceDatabase:database,job:{id:jobId,worldId:original.world_id,buildId:original.build_id,status:original.status,checkInputHash:original.check_input_hash,outputHash:original.output_hash},checkInput:original.check_input,originalOutput:original.output};
 const packetBytes=Buffer.from(JSON.stringify(packet,null,2)+'\n');fs.writeFileSync(path.join(out,'replay-packet.json'),packetBytes,{flag:'wx'});report.packetSha256=sha(packetBytes);report.originalOutput=JSON.parse(original.output);
 // Read-only plain-Node timing isolates disk/hash work from Electron and GPU.
 const artifactRoot=descriptor.root.startsWith('\\\\?\\UNC\\')?'\\\\'+descriptor.root.slice(8):descriptor.root.startsWith('\\\\?\\')?descriptor.root.slice(4):descriptor.root;
 for(const artifact of descriptor.artifacts){
  if(cancelled)throw Error('REPLAY_CANCELLED');
  const started=performance.now();assert(artifact.path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.includes('\\')&&!p.includes(':')));
  let file=artifactRoot;assert(fs.lstatSync(file).isDirectory()&&!fs.lstatSync(file).isSymbolicLink());
  for(const part of artifact.path.split('/')){file=path.join(file,part);assert(!fs.lstatSync(file).isSymbolicLink(),'LINKED_ARTIFACT_DENIED');}
  const hash=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(file)){hash.update(chunk);bytes+=chunk.length;}
  const digest=hash.digest('hex');report.artifactReads.push({path:artifact.path,bytes,sha256:digest,elapsedMs:performance.now()-started});write();assert.equal(bytes,artifact.bytes);assert.equal(digest,artifact.sha256);
 }
 report.preparationVerified=true;write();
 if(run){
  launch=resolveCreationNativeLaunch({root:applicationRoot,inherited:process.env,requiredGuards:['godotCheckReplay','CHECK_REPLAY_PARENT_PIN_REQUIRED']});requirePackagedResources(launch.packaged,path.resolve(resources));
  report.packageIdentity=launch.identity?{packaged:launch.packaged,version:launch.identity.version,inventorySha256:launch.identity.inventorySha256,mainSha256:launch.identity.mainSha256}:null;report.mainSha256=sha(launch.main);
  const profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacy);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
  ended=false;child=spawn(launch.executable,launch.args,{cwd:launch.cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...launch.environment({out,profile,token}),CRAFTMINE_RUNTIME_RESOURCES:resources,CRAFTMINE_CHECK_REPLAY_PACKET_SHA256:report.packetSha256}});
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,stream+'.log'),bytes));
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')audit=message;const task=pending.get(message.id);if(task){pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error)):task.resolve(message.result);}});
  exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;report.exit={code,signal};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('REPLAY_DESKTOP_EXITED'));}pending.clear();resolve();});child.once('error',error=>{ended=true;report.launchError=String(error);resolve();});});
  while(!ready){if(cancelled)throw Error('REPLAY_CANCELLED');if(ended)throw Error('REPLAY_DESKTOP_EXITED');await delay(100);}
  report.status=await rpc('status');assert.deepEqual(report.status.violations,[]);assert(report.status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));write();
  report.result=await rpc('godotCheckReplay',{diagnosticOnly:true});write();
  assert.equal(report.result.diagnosticOnly,true);assert.equal(report.result.packetSha256,report.packetSha256);assert.equal(report.result.checkInputSha256,original.check_input_hash);
  if(cancelled)throw Error('REPLAY_CANCELLED');assert.equal(report.result.evidence.passed,true,'DIAGNOSTIC_VERIFIER_FAILED:'+report.result.evidence.error);
  report.diagnosticPassed=true;
 }
}catch(error){report.diagnosticPassed=false;report.error=String(error.stack??error);process.exitCode=1;}
finally{
 clearInterval(watcher);
 if(child&&!ended){const deadline=Date.now()+60000;while(!ended&&Date.now()<deadline){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(1000)]);}if(!ended){child.kill();await exit;report.shutdownError='NORMAL_SHUTDOWN_REQUIRED';report.diagnosticPassed=false;process.exitCode=1;}}
 if(child)try{report.audit=audit;assert(audit);assert.deepEqual(audit.violations,[]);assert.deepEqual(audit.pageErrors,[]);assert.deepEqual(audit.shutdownFailures,[]);assert.equal(report.exit.code,0);}catch(error){report.shutdownError=String(error);report.diagnosticPassed=false;process.exitCode=1;}
 try{if(original)assert.deepEqual(readJob(),original,'ORIGINAL_FAILED_JOB_CHANGED');launch?.assertUnchanged();}catch(error){report.integrityError=String(error);report.diagnosticPassed=false;process.exitCode=1;}
 write();
}
console.log(JSON.stringify({diagnosticOnly:true,preparationVerified:report.preparationVerified===true,diagnosticPassed:report.diagnosticPassed??null,report:path.join(out,'report.json'),error:report.error}));
