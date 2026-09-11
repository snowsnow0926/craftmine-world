// A second PET01-checkpoint-derived A05 attempt, one exact wish, never a retry.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../app/local-config.mjs';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {assertProofs} from './helpers/promo-checkpoint-contract.mjs';
import {CHECKPOINT_A05,CHECKPOINT_A05_LIMITS,parseCheckpointLiveArgs,inspectCheckpointLive,checkpointA05Plan,checkpointBudget,checkpointPoll,checkpointSanitizer,checkpointRecoverySignal} from './helpers/promo-checkpoint-live-contract.mjs';

const options=parseCheckpointLiveArgs(process.argv.slice(2)),context=inspectCheckpointLive(options.file),plan=checkpointA05Plan(context);
if(!options.live){console.log(JSON.stringify({mode:'prepare-only',...plan,modelRequests:0}));process.exit(0);}
const configFile=process.env.CRAFTMINE_LIVE_CONFIG;assert.ok(configFile&&path.isAbsolute(configFile),'CHECKPOINT_EXPLICIT_CONFIG_REQUIRED');
const config={};loadLocalConfig(configFile,config);
const secret=config.CRAFTMINE_DEEPSEEK_API_KEY??config.DEEPSEEK_API_KEY??config.CRAFTMINE_EVAL_KEY;
assert.ok(secret&&(!config.CRAFTMINE_MODEL_PROVIDER||config.CRAFTMINE_MODEL_PROVIDER==='deepseek'),'CHECKPOINT_DEEPSEEK_CONFIG_REQUIRED');
const client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot:context.restored.packageIdentity.packaged,requiredGuards:['EVALUATION_WISH_BUSY_OR_FIXED_SUITE','CRAFTMINE_EVAL_REQUEST_LIMIT','godotExplore']});
assert.equal(client.identity.inventorySha256,context.restored.packageIdentity.inventorySha256,'CHECKPOINT_FROZEN_PACKAGE_CHANGED');
client.assertUnchanged();assertProofs(context.proofs);
const sanitize=checkpointSanitizer([secret,context.token]);
const report={format:'craftmine.promo-pilot/1',...plan,group:'pet',packageIdentity:client.identity,status:'PREPARING',startedAt:new Date().toISOString(),
 restoreReport:options.file,checkpoint:context.restored.checkpoint,checkpointSourceProofs:context.proofs,sourceTrialBudget:context.restored.sourceTrialBudget,
 originalArchive:context.restored.parentExport,sourceEditsByHarness:0,automaticWishRetries:0,legacyTaskRecovery:false,modelRequestsAdded:0,
 budgetAtStart:context.budget,budget:context.budget,functional:'UNVERIFIED',visual:'UNVERIFIED',continuity:'UNVERIFIED',snapshots:[]};
// Exclusive creation makes every actual attempt one-shot, including failures.
fs.writeFileSync(context.output,JSON.stringify(sanitize(report),null,2),{flag:'wx'});
const save=()=>fs.writeFileSync(context.output,JSON.stringify(sanitize(report),null,2));
let child,ready=false,ended=true,exited,exitReport=null,initialized=false,submitted=false,modelDeadline=0;const pending=new Map();
const rejectPending=error=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();};
function rpc(type,method,fields={},timeoutMs=60000){
 assert.ok((type==='craftmine-creation-evaluation'&&['initialize','snapshot','resume-play','wish','wish-state','abort'].includes(method))||
  (type==='craftmine-headless'&&['status','primaryMode','worldNavigation','godotObserve','godotExplore','quit'].includes(method)),'CHECKPOINT_RPC_DENIED');
 assert.ok(Object.keys(fields).every(key=>['payload','channel','wish'].includes(key)),'CHECKPOINT_ENVELOPE_DENIED');
 if(method==='wish'){assert.equal(submitted,false,'CHECKPOINT_WISH_ALREADY_SENT');assert.deepEqual(fields.wish,CHECKPOINT_A05);submitted=true;}
 if(ended)return Promise.reject(Error('CHECKPOINT_CLIENT_EXITED'));
 return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('CHECKPOINT_TIMEOUT: '+method));},timeoutMs);
  pending.set(id,{resolve,reject,timer});child.send({type,id,method,...fields},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});
}
const native=(method,fields={},timeout)=>rpc('craftmine-headless',method,fields,timeout),evaluation=(method,fields={},timeout)=>rpc('craftmine-creation-evaluation',method,fields,timeout);
async function until(read,accept,label,timeoutMs=120000){
 const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(ended)throw Error('CHECKPOINT_CLIENT_EXITED: '+label);
  try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/i.test(error.message))throw error;}await delay(400);
 }throw Error('CHECKPOINT_TIMEOUT: '+label);
}
const isolation=value=>{assert.deepEqual(value.violations,[]);assert.deepEqual(value.pageErrors,[]);assert.ok(value.windows?.length&&value.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen),'CHECKPOINT_ISOLATION');};
try{
 const env={...client.environment({out:context.out,profile:context.profile,token:context.token}),CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_MODEL:context.model,CRAFTMINE_EVAL_THINKING:'high',CRAFTMINE_EVAL_KEY:secret,CRAFTMINE_EVAL_REQUEST_LIMIT:'10'};
 assert.equal(env.CRAFTMINE_EVAL_SESSION,undefined);assert.equal(checkpointBudget(context.profile).reserved,0);
 report.launch={stdoutBytes:0,stderrBytes:0};ended=false;
 child=spawn(client.executable,client.args,{cwd:client.cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
 // Avoid partial-secret leakage across log chunks: retain byte counts only.
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{report.launch[stream+'Bytes']+=bytes.length;});
 exited=new Promise(resolve=>{child.once('error',error=>{ended=true;report.launch.errorCode=error.code??'SPAWN_FAILED';rejectPending(error);resolve();});child.once('exit',(code,signal)=>{ended=true;report.launch.exit={code,signal};rejectPending(Error('CHECKPOINT_CLIENT_EXITED'));resolve();});});
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;
  const request=pending.get(message.id);if(request){clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(Error(message.error)):request.resolve(message.result);}});
 await until(async()=>ready,Boolean,'controller');isolation(await until(()=>native('status'),value=>value.windows?.length,'window'));
 await until(()=>native('primaryMode'),value=>value.entry,'entry');await native('primaryMode',{payload:{action:'create'}});
 const list=await until(()=>native('worldNavigation',{channel:'world.list'}),value=>value.worlds?.some(world=>world.id===plan.worldId),'restored world');
 if(list.activeWorldId!==plan.worldId){const result=await native('worldNavigation',{channel:'world.switch',payload:{id:plan.worldId}});assert.notEqual(result?.ok,false,'CHECKPOINT_SWITCH_FAILED');}
 const observed=await until(()=>native('godotObserve'),value=>value.worldId===plan.worldId&&value.instanceId,'restored engine');assert.equal(observed.buildId,plan.originalBuild,'CHECKPOINT_ORIGINAL_BUILD_CHANGED');
 report.session=await evaluation('initialize');initialized=true;assert.ok(report.session.sessionId&&!report.session.reopened,'CHECKPOINT_NEW_SESSION_REQUIRED');
 const oldSessions=new Set([context.original.sessionId,context.original.session?.sessionId].filter(Boolean));assert.ok(!oldSessions.has(report.session.sessionId),'CHECKPOINT_REUSED_SOURCE_SESSION');
 report.sessionId=report.session.sessionId;const initial=await evaluation('snapshot');assert.equal(initial.budget?.reserved,0);assert.equal(initial.budget?.limit,10);assert.equal(initial.active,false);
 await evaluation('resume-play');
 const identity={worldId:observed.worldId,buildId:observed.buildId,instanceId:observed.instanceId};
 report.stabilization=await native('godotExplore',{payload:{...identity,steps:[{op:'wait',args:{frames:30}}]}});
 report.before=await evaluation('snapshot');assert.equal(report.before.budget?.reserved,0);assert.equal(report.before.observation?.worldId,plan.worldId);
 const deadline=Date.now()+CHECKPOINT_A05_LIMITS.milliseconds;modelDeadline=deadline;report.submittedAt=new Date().toISOString();report.deadlineAt=new Date(deadline).toISOString();
 report.submission=await evaluation('wish',{wish:CHECKPOINT_A05});report.status='SUBMITTED';save();
 let observedWork=false,last='';
 while(Date.now()<deadline){
  const state=await evaluation('snapshot',{},Math.max(1,Math.min(60000,deadline-Date.now())));report.latest=state;report.budget=state.budget;report.metrics=state.metrics;
  const progress=checkpointPoll(state,observedWork);observedWork=progress.started;
  const stage={active:state.active,job:state.job?.status,stage:state.job?.stage,reserved:state.budget.reserved};report.snapshots.push({at:new Date().toISOString(),...stage});save();
  if(JSON.stringify(stage)!==last){console.log(JSON.stringify(stage));last=JSON.stringify(stage);}
  if(progress.settled){report.status=progress.reason;break;}await delay(Math.min(2000,Math.max(0,deadline-Date.now())));
 }
 if(report.status==='SUBMITTED'){report.status='TIME_STOP';await evaluation('abort');}
 report.journal=await evaluation('wish-state');report.isolation=await native('status');isolation(report.isolation);
 if(checkpointRecoverySignal(report.latest)){report.status='BLOCKED';report.recoverySignalDetected=true;process.exitCode=1;}
}catch(error){report.status=/EXPLICIT_RECOVERY_REQUIRED|WORLD_LEASE|LEASE_HELD/.test(error.message)?'BLOCKED':modelDeadline&&Date.now()>=modelDeadline?'TIME_STOP':'RUN_FAILED';report.error=sanitize(String(error.message));process.exitCode=1;}
finally{
 if(child&&!ended){if(initialized)try{await evaluation('abort',{},10000);}catch(error){report.abortError=sanitize(String(error.message));}
  try{await native('quit',{},5000);}catch{}await Promise.race([exited,delay(15000)]);if(!ended){report.forcedStop=true;child.kill();await Promise.race([exited,delay(5000)]);}}
 rejectPending(Error('CHECKPOINT_CLOSED'));report.exitReport=exitReport;
 try{assert.ok(!report.forcedStop,'CHECKPOINT_FORCED_SHUTDOWN');assert.deepEqual(exitReport?.violations,[]);assert.deepEqual(exitReport?.pageErrors,[]);assert.deepEqual(exitReport?.shutdownFailures,[]);report.shutdownVerified=true;}
 catch(error){report.shutdownVerified=false;report.shutdownError=sanitize(String(error.message));process.exitCode=1;}
 try{assertProofs(context.proofs);client.assertUnchanged();report.sourceEvidenceUnchanged=true;report.budget=checkpointBudget(context.profile);report.modelRequestsAdded=report.budget.reserved;}
 catch(error){report.sourceEvidenceUnchanged=false;report.preservationError=sanitize(String(error.message));process.exitCode=1;}
 report.endedAt=new Date().toISOString();save();console.log(JSON.stringify({report:context.output,status:report.status,budget:report.budget,trialKind:'checkpoint-derived'}));
}
