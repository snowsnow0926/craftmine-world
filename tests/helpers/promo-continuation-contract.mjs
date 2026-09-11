import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readCheckpointJson,fileProof,assertProofs} from './promo-checkpoint-contract.mjs';
import {adoptionEnvironment} from './promo-adoption-contract.mjs';
import {readHeadlessProfile} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';

export const CONTINUATION_TEXT='继续完成刚才的愿望。';
export const CONTINUATION_MILLISECONDS=600000;
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(value);
export function continuationArgs(args){
  assert.ok(args.length>=1&&args.length<=2&&path.isAbsolute(args[0])&&(args.length===1||args[1]==='--live'),'CONTINUATION_USAGE: <absolute report> [--live]');
  return {file:args[0],live:args[1]==='--live'};
}
export function continuationBudget(ledger){
  assert.equal(ledger?.format,'craftmine.creation-evaluation-budget/1','CONTINUATION_LEDGER_INVALID');
  assert.ok(Number.isSafeInteger(ledger.limit)&&ledger.limit>=1&&ledger.limit<=40&&Array.isArray(ledger.requests)&&ledger.requests.length<=ledger.limit&&new Set(ledger.requests).size===ledger.requests.length&&ledger.requests.every(value=>typeof value==='string'&&value.length>0&&value.length<=240),'CONTINUATION_LEDGER_INVALID');
  return {limit:ledger.limit,reserved:ledger.requests.length,remaining:ledger.limit-ledger.requests.length};
}
export function assertContinuationLedger(before,after){
  continuationBudget(before);continuationBudget(after);
  assert.equal(after.limit,before.limit,'CONTINUATION_LIMIT_CHANGED');
  assert.deepEqual(after.requests.slice(0,before.requests.length),before.requests,'CONTINUATION_LEDGER_REWRITTEN');
  assert.ok(after.requests.length>=before.requests.length,'CONTINUATION_LEDGER_REWRITTEN');
}
export function validateContinuationSource(original,ledger,registry,journal){
  assert.equal(original?.format,'craftmine.promo-pilot/1','CONTINUATION_PILOT_REQUIRED');
  assert.ok(typeof original.endedAt==='string'&&Number.isFinite(Date.parse(original.endedAt))&&!original.forcedStop&&!original.integrityError&&!original.closeoutError,'CONTINUATION_CLEAN_END_REQUIRED');
  for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(original.exitReport?.[key],[],'CONTINUATION_CLEAN_END_REQUIRED');
  const lastAssistant=original.latest?.record?.session?.messages?.filter(message=>message.role==='assistant').at(-1);
  // TIME_STOP snapshots may predate their successful abort. Actual inactivity is
  // checked again after reopening, before sending the new player follow-up.
  assert.ok(original.status==='TIME_STOP'||(original.latest?.active===false&&lastAssistant?.status==='error'&&lastAssistant.error),'CONTINUATION_ERROR_OR_TIME_STOP_REQUIRED');
  assert.ok(!['queued','running','recovering'].includes(original.latest?.job?.status),'CONTINUATION_PENDING_JOB');
  assert.ok(path.isAbsolute(original.packageIdentity?.packaged??'')&&/^[a-f0-9]{64}$/.test(original.packageIdentity?.inventorySha256??''),'CONTINUATION_FROZEN_PACKAGE_REQUIRED');
  const budget=continuationBudget(ledger);
  assert.deepEqual(original.budget,budget,'CONTINUATION_REPORT_LEDGER_MISMATCH');
  if(original.maxRequests!==undefined)assert.equal(original.maxRequests,budget.limit,'CONTINUATION_REPORT_LEDGER_MISMATCH');
  assert.ok(budget.reserved>0&&budget.remaining>0,'CONTINUATION_REMAINING_BUDGET_REQUIRED');
  const session=original.latest?.record?.session;
  assert.ok(session&&/^[a-f0-9-]{36}$/.test(session.id)&&id(original.worldId)&&session.mode==='agent'&&/^deepseek-[a-z0-9.-]+$/.test(session.modelId)&&session.modelId===original.model&&session.thinkingLevel==='high'&&id(session.providerId),'CONTINUATION_SESSION_IDENTITY');
  for(const value of [original.sessionId,original.session?.sessionId,original.latest?.sessionId])if(value!==undefined)assert.equal(value,session.id,'CONTINUATION_SESSION_IDENTITY');
  assert.equal(original.latest?.observation?.worldId,original.worldId,'CONTINUATION_WORLD_IDENTITY');
  const buildId=original.latest.observation.buildId;assert.ok(id(buildId),'CONTINUATION_BUILD_IDENTITY');
  const identity={sessionId:session.id,providerId:session.providerId,modelId:session.modelId,thinkingLevel:'high'};
  assert.equal(registry?.format,'craftmine.creation-evaluation-sessions/1','CONTINUATION_SESSION_REGISTRY');
  assert.deepEqual(registry.sessions?.[session.id],identity,'CONTINUATION_SESSION_REGISTRY');
  assert.equal(journal?.format,'craftmine.evaluation-wishes/1','CONTINUATION_WISH_JOURNAL');
  assert.ok(Array.isArray(journal.entries)&&journal.entries.length<40,'CONTINUATION_WISH_JOURNAL');
  const wish=original.wish;
  assert.ok(wish&&typeof wish.text==='string'&&typeof wish.id==='string','CONTINUATION_ORIGINAL_WISH_REQUIRED');
  const entry=journal.entries.find(item=>item.id===wish.id);
  assert.ok(entry?.text===wish.text&&entry.sessionId===session.id&&entry.worldId===original.worldId&&entry.status==='submitted'&&id(entry.messageId),'CONTINUATION_WISH_JOURNAL');
  assert.ok(session.messages.some(message=>message.role==='user'&&message.id===entry.messageId&&message.content===wish.text),'CONTINUATION_ORIGINAL_MESSAGE_REQUIRED');
  return {...identity,permissionMode:session.permissionMode,worldId:original.worldId,buildId,budget,originalMessageId:entry.messageId};
}
export function inspectContinuationSource(file){
  assert.ok(path.isAbsolute(file),'CONTINUATION_ABSOLUTE_REPORT_REQUIRED');
  const out=path.dirname(file),profile=path.join(out,'profile');
  const original=readCheckpointJson(file),markerFile=path.join(profile,'headless-profile.json'),marker=readCheckpointJson(markerFile);
  readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token});
  const budgetFile=path.join(profile,'creation-evaluation-budget.json'),ledger=readCheckpointJson(budgetFile);
  const registry=readCheckpointJson(path.join(profile,'creation-evaluation-sessions.json'));
  const journal=readCheckpointJson(path.join(profile,'creation-evaluation-wishes.json'));
  const selection=validateContinuationSource(original,ledger,registry,journal),proofs=[file,markerFile].map(fileProof);
  const claimFile=path.join(out,'continuation-'+proofs[0].sha256+'.claim.json');
  assert.ok(!fs.existsSync(claimFile),'CONTINUATION_SOURCE_ALREADY_CLAIMED');
  const followUp={id:'CONTINUE_'+proofs[0].sha256.slice(0,32),text:CONTINUATION_TEXT};
  assert.ok(!journal.entries.some(entry=>entry.id===followUp.id),'CONTINUATION_FOLLOWUP_ALREADY_CLAIMED');
  assertProofs(proofs);
  return {file,original,out,profile,marker,budgetFile,ledger,selection,proofs,claimFile,followUp};
}
export function continuationEnvironment(client,context,secret){
  return {...adoptionEnvironment(client,{out:context.out,profile:context.profile,token:context.marker.token}),
    CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_SESSION:context.selection.sessionId,CRAFTMINE_EVAL_MODEL:context.selection.modelId,
    CRAFTMINE_EVAL_THINKING:'high',CRAFTMINE_EVAL_KEY:secret,CRAFTMINE_EVAL_REQUEST_LIMIT:String(context.selection.budget.limit)};
}
export function assertContinuationSnapshot(snapshot,context,{beforeSubmission=false}={}){
  const selected=context.selection,session=snapshot?.record?.session,budget=snapshot?.budget;
  assert.equal(snapshot?.sessionId,selected.sessionId,'CONTINUATION_LIVE_SESSION_CHANGED');
  for(const [key,value] of Object.entries({id:selected.sessionId,providerId:selected.providerId,modelId:selected.modelId,thinkingLevel:'high',mode:'agent',permissionMode:selected.permissionMode}))assert.equal(session?.[key],value,'CONTINUATION_LIVE_SESSION_CHANGED');
  assert.equal(snapshot.observation?.worldId,selected.worldId,'CONTINUATION_LIVE_WORLD_CHANGED');
  assert.ok(budget?.limit===selected.budget.limit&&Number.isSafeInteger(budget.reserved)&&budget.reserved>=selected.budget.reserved&&budget.reserved<=budget.limit&&budget.remaining===budget.limit-budget.reserved,'CONTINUATION_LIVE_BUDGET_CHANGED');
  if(beforeSubmission){
    assert.equal(snapshot.active,false,'CONTINUATION_MODEL_STILL_ACTIVE');
    assert.equal(snapshot.observation.buildId,selected.buildId,'CONTINUATION_FORMAL_BUILD_CHANGED');
    assert.deepEqual(budget,selected.budget,'CONTINUATION_UNEXPECTED_PROVIDER_REQUEST');
    assert.ok(!['queued','running','recovering'].includes(snapshot.job?.status),'CONTINUATION_PENDING_JOB');
    assert.ok(!['applying'].includes(snapshot.application?.status)&&snapshot.application?.phase!=='applying','CONTINUATION_APPLICATION_ACTIVE');
    assert.ok(session.messages?.some(message=>message.id===selected.originalMessageId&&message.role==='user'&&message.content===context.original.wish.text),'CONTINUATION_ORIGINAL_MESSAGE_MISSING');
  }
}
export function claimContinuation(context,report){
  assertProofs(context.proofs);assert.deepEqual(readCheckpointJson(context.budgetFile),context.ledger,'CONTINUATION_LEDGER_CHANGED_BEFORE_START');
  const lock=path.join(context.out,'continuation-active.json');
  fs.writeFileSync(lock,JSON.stringify({source:context.file}),{flag:'wx'});
  let claimed=false;
  try{
    const output=path.join(context.out,'continuation-'+randomUUID()+'.json');
    fs.writeFileSync(context.claimFile,JSON.stringify({source:context.file,sourceSha256:context.proofs[0].sha256,output,followUp:context.followUp}),{flag:'wx'});claimed=true;
    fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
    return {output,release:()=>fs.unlinkSync(lock)};
  }catch(error){fs.unlinkSync(lock);if(claimed)error.message+=' (source remains claimed; inspect before any retry)';throw error;}
}
