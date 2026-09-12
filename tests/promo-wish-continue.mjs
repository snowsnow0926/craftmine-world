// Explicit player follow-up in the original isolated session; never a fresh trial.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalConfig} from '../app/local-config.mjs';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {assertProofs,readCheckpointJson} from './helpers/promo-checkpoint-contract.mjs';
import {checkpointSanitizer} from './helpers/promo-checkpoint-live-contract.mjs';
import {promoPilotProgress} from './helpers/promo-pilot-progress.mjs';
import {playerClarificationMode,choosePlayerClarification,MAX_PLAYER_CLARIFICATIONS} from './helpers/promo-player-clarification.mjs';
import {continuationArgs,inspectContinuationSource,continuationEnvironment,assertContinuationSnapshot,assertContinuationLedger,continuationBudget,claimContinuation,CONTINUATION_MILLISECONDS} from './helpers/promo-continuation-contract.mjs';

const options=continuationArgs(process.argv.slice(2)),context=inspectContinuationSource(options.file);
const clarificationMode=playerClarificationMode(process.env.CRAFTMINE_PROMO_CLARIFICATION_MODE);
const client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot:context.original.packageIdentity.packaged,
  requiredGuards:['CRAFTMINE_EVAL_SESSION','EVALUATION_WISH_BUSY_OR_FIXED_SUITE','CRAFTMINE_EVAL_REQUEST_LIMIT',...(clarificationMode==='off'?[]:['headlessAskPending','headlessAskResolve'])]});
assert.equal(client.identity.inventorySha256,context.original.packageIdentity.inventorySha256,'CONTINUATION_FROZEN_PACKAGE_CHANGED');
const plan={originalReport:options.file,originalWish:context.original.wish,followUp:context.followUp,sessionId:context.selection.sessionId,worldId:context.selection.worldId,
  model:context.selection.modelId,thinking:'high',maxRequests:context.selection.budget.limit,budgetAtStart:context.selection.budget,maxMinutes:10,clarificationMode};
if(!options.live){console.log(JSON.stringify({mode:'prepare-only',...plan,modelRequests:0,packageSha256:client.identity.inventorySha256}));process.exit(0);}
const configFile=process.env.CRAFTMINE_LIVE_CONFIG;assert.ok(configFile&&path.isAbsolute(configFile),'CONTINUATION_EXPLICIT_CONFIG_REQUIRED');
const config={};loadLocalConfig(configFile,config);
const secret=config.CRAFTMINE_DEEPSEEK_API_KEY??config.DEEPSEEK_API_KEY??config.CRAFTMINE_EVAL_KEY;
assert.ok(secret&&(!config.CRAFTMINE_MODEL_PROVIDER||config.CRAFTMINE_MODEL_PROVIDER==='deepseek'),'CONTINUATION_DEEPSEEK_CONFIG_REQUIRED');
const sanitize=checkpointSanitizer([secret,context.marker.token]);
const report={format:'craftmine.promo-pilot/1',...plan,trialKind:'same-session-player-follow-up',wish:context.original.wish,group:context.original.group,
  planSha256:context.original.planSha256,packageIdentity:client.identity,status:'PREPARING',startedAt:new Date().toISOString(),
  sourceReportProof:context.proofs[0],sourceEditsByHarness:0,automaticWishRetries:0,profileCopied:false,modelRequestsAdded:0,
  budget:context.selection.budget,functional:'UNVERIFIED',visual:'UNVERIFIED',continuity:'UNVERIFIED',snapshots:[],
  playerClarification:{mode:clarificationMode,count:0,questionCount:0,events:[]}};
const claimed=claimContinuation(context,sanitize(report));
const save=()=>fs.writeFileSync(claimed.output,JSON.stringify(sanitize(report),null,2));
const originalJournal=readCheckpointJson(path.join(context.profile,'creation-evaluation-wishes.json'));
let child,ready=false,ended=true,exited,exitReport=null,initialized=false,submitted=false,observedTurn=false,modelDeadline=0,deadlineTimer;
const pending=new Map(),answered=new Set();
const rejectPending=error=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(error);}pending.clear();};
function rpc(type,method,fields={},timeoutMs=60000){
  assert.ok((type==='craftmine-creation-evaluation'&&['initialize','snapshot','resume-play','wish','wish-state','abort'].includes(method))||
    (type==='craftmine-headless'&&['status','primaryMode','godotObserve','godotCaptureView','headlessAskPending','headlessAskResolve','quit'].includes(method)),'CONTINUATION_RPC_DENIED');
  if(method==='wish'){assert.equal(submitted,false,'CONTINUATION_ALREADY_SUBMITTED');assert.deepEqual(fields,{wish:context.followUp},'CONTINUATION_FOLLOWUP_CHANGED');submitted=true;}
  if(ended)return Promise.reject(Error('CONTINUATION_CLIENT_EXITED'));
  return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('CONTINUATION_TIMEOUT: '+method));},timeoutMs);
    pending.set(id,{resolve,reject,timer});child.send({type,id,method,...fields},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});
}
const native=(method,fields={},timeout)=>rpc('craftmine-headless',method,fields,timeout);
const evaluation=(method,fields={},timeout)=>rpc('craftmine-creation-evaluation',method,fields,timeout);
async function until(read,accept,label){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){if(ended)throw Error('CONTINUATION_CLIENT_EXITED: '+label);
    try{const value=await read();if(accept(value))return value;}catch(error){if(!/not ready|WORLD_BUSY|No world runtime is running|World view is not ready/i.test(error.message))throw error;}
    await delay(400);
  }throw Error('CONTINUATION_TIMEOUT: '+label);
}
function takeSnapshot(state){
  assertContinuationSnapshot(state,context);report.latest=state;report.budget=state.budget;report.metrics=state.metrics;
  report.modelRequestsAdded=state.budget.reserved-context.selection.budget.reserved;
  observedTurn ||= state.active===true||report.modelRequestsAdded>0;
}
try{
  assertProofs(context.proofs);client.assertUnchanged();
  const env=continuationEnvironment(client,context,secret);report.launch={stdoutBytes:0,stderrBytes:0};ended=false;
  child=spawn(client.executable,client.args,{cwd:client.cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
  // Keep counts only: splitting output chunks cannot reveal part of a credential.
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{report.launch[stream+'Bytes']+=bytes.length;});
  exited=new Promise(resolve=>{child.once('error',error=>{ended=true;report.launch.errorCode=error.code??'SPAWN_FAILED';rejectPending(error);resolve();});
    child.once('exit',(code,signal)=>{ended=true;report.launch.exit={code,signal};rejectPending(Error('CONTINUATION_CLIENT_EXITED'));resolve();});});
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')exitReport=message;
    const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
  await until(async()=>ready,Boolean,'controller');
  const isolation=await until(()=>native('status'),value=>value.windows?.length,'window');
  assert.deepEqual(isolation.violations,[]);assert.deepEqual(isolation.pageErrors,[]);
  assert.ok(isolation.windows.every(window=>!window.visible&&!window.focused&&!window.focusable&&window.offscreen),'CONTINUATION_ISOLATION');
  await until(()=>native('primaryMode'),value=>value.entry,'entry');await native('primaryMode',{payload:{action:'create'}});
  await until(()=>native('godotObserve'),value=>value.worldId===context.selection.worldId&&value.instanceId,'original world');
  report.session=await evaluation('initialize');initialized=true;
  assert.equal(report.session.reopened,true,'CONTINUATION_REOPEN_REQUIRED');assert.equal(report.session.sessionId,context.selection.sessionId,'CONTINUATION_NEW_SESSION_DENIED');
  report.before=await evaluation('snapshot');assertContinuationSnapshot(report.before,context,{beforeSubmission:true});
  assert.deepEqual(readCheckpointJson(context.budgetFile),context.ledger,'CONTINUATION_LEDGER_CHANGED_BEFORE_SUBMISSION');
  await evaluation('resume-play');
  const readyState=await evaluation('snapshot');assertContinuationSnapshot(readyState,context,{beforeSubmission:true});assertProofs(context.proofs);
  modelDeadline=Date.now()+CONTINUATION_MILLISECONDS;report.submittedAt=new Date().toISOString();report.deadlineAt=new Date(modelDeadline).toISOString();
  // A slow snapshot or clarification reply must not postpone the model cutoff.
  deadlineTimer=setTimeout(()=>{report.deadlineAbortRequestedAt=new Date().toISOString();if(!ended)void evaluation('abort',{},10000).catch(error=>{report.deadlineAbortError=String(error.message);});},CONTINUATION_MILLISECONDS);
  report.status='SUBMITTING';save();
  report.submission=await evaluation('wish',{wish:context.followUp});
  assert.equal(report.submission.content,context.followUp.text,'CONTINUATION_SUBMISSION_CHANGED');assert.equal(report.submission.target?.worldId,context.selection.worldId,'CONTINUATION_SUBMISSION_WORLD_CHANGED');
  report.status='SUBMITTED';save();let lastStage='';
  while(Date.now()<modelDeadline){
    const state=await evaluation('snapshot',{},Math.max(1,Math.min(60000,modelDeadline-Date.now())));takeSnapshot(state);
    assertContinuationLedger(context.ledger,readCheckpointJson(context.budgetFile));
    const stage={active:state.active,job:state.job?.status,stage:state.job?.stage,reserved:state.budget.reserved};
    report.snapshots.push({at:new Date().toISOString(),...stage});save();
    if(JSON.stringify(stage)!==lastStage){console.log(JSON.stringify(stage));lastStage=JSON.stringify(stage);}
    const progress=promoPilotProgress(state);
    if(observedTurn&&progress.settled){report.status=progress.reason;break;}
    if(clarificationMode!=='off'&&state.active){
      try{
        const ask=await native('headlessAskPending',{payload:{sessionId:context.selection.sessionId}});
        if(ask&&!answered.has(ask.requestId)){
          assert.ok(report.playerClarification.count<MAX_PLAYER_CLARIFICATIONS,'PROMO_CLARIFICATION_LIMIT');
          const selected=choosePlayerClarification(ask,context.selection.sessionId,clarificationMode);
          const event={...selected.ask,answers:selected.answers,choices:selected.choices,selectionReasons:selected.selectionReasons,startedAt:new Date().toISOString(),status:'sending'};
          report.playerClarification.events.push(event);save();
          const receipt=await native('headlessAskResolve',{payload:{sessionId:ask.sessionId,requestId:ask.requestId,choices:selected.choices}});
          assert.equal(receipt.status,'resolved');assert.equal(receipt.sessionId,ask.sessionId);assert.equal(receipt.requestId,ask.requestId);assert.deepEqual(receipt.answers,selected.answers);
          event.status='resolved';event.answeredAt=new Date().toISOString();answered.add(ask.requestId);
          report.playerClarification.count++;report.playerClarification.questionCount+=ask.questions.length;report.interactionPath='player-clarified-follow-up';save();
        }
      }catch(error){report.status='CLARIFICATION_DRIVER_BLOCKED';report.clarificationError=String(error.message);const event=report.playerClarification.events.at(-1);if(event?.status==='sending')event.status='failed';break;}
    }
    await delay(Math.min(2000,Math.max(0,modelDeadline-Date.now())));
  }
  if(report.status==='SUBMITTED')report.status='TIME_STOP';
}catch(error){report.status=modelDeadline&&Date.now()>=modelDeadline?'TIME_STOP':'RUN_FAILED';report.error=String(error.stack??error);process.exitCode=1;}
finally{
  clearTimeout(deadlineTimer);
  if(!ended&&initialized){
    try{await evaluation('abort',{},10000);const final=await evaluation('snapshot',{},15000);takeSnapshot(final);assert.equal(final.active,false,'CONTINUATION_ABORT_INCOMPLETE');report.journal=await evaluation('wish-state');}
    catch(error){report.closeoutError=String(error.message);process.exitCode=1;}
    try{const capture=await native('godotCaptureView');const name=path.basename(claimed.output,'.json')+'-formal-world.png';fs.writeFileSync(path.join(context.out,name),Buffer.from(capture.pngBase64,'base64'),{flag:'wx'});report.formalCapture={file:name,width:capture.width,height:capture.height,role:'formal-world-at-follow-up-end'};}
    catch(error){report.captureError=String(error.message);}
  }
  if(!ended){try{await native('quit',{},5000);}catch{}await Promise.race([exited,delay(15000)]);if(!ended){report.forcedStop=true;child.kill();await Promise.race([exited,delay(5000)]);}}
  report.exitReport=exitReport;rejectPending(Error('CONTINUATION_CLOSED'));
  try{
    assert.ok(!report.forcedStop,'CONTINUATION_SHUTDOWN_TIMEOUT');
    for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(exitReport?.[key],[],'CONTINUATION_CLEAN_END_REQUIRED');
    assertProofs(context.proofs);client.assertUnchanged();
    const ledger=readCheckpointJson(context.budgetFile);assertContinuationLedger(context.ledger,ledger);
    report.budget=continuationBudget(ledger);report.modelRequestsAdded=report.budget.reserved-context.selection.budget.reserved;
    if(report.latest)assert.deepEqual(report.latest.budget,report.budget,'CONTINUATION_FINAL_BUDGET_MISMATCH');
    const journal=readCheckpointJson(path.join(context.profile,'creation-evaluation-wishes.json'));
    assert.deepEqual(journal.entries.slice(0,originalJournal.entries.length),originalJournal.entries,'CONTINUATION_OLD_WISHES_CHANGED');
    report.originalReportUnchanged=true;report.budgetAppendOnly=true;
  }catch(error){report.integrityError=String(error.message);process.exitCode=1;}
  report.endedAt=new Date().toISOString();save();claimed.release();console.log('Report: '+claimed.output);
}
