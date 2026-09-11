import assert from 'node:assert/strict';
import path from 'node:path';
import {readCheckpointJson,fileProof,assertProofs} from './promo-checkpoint-contract.mjs';
import {checkpointEnvironment} from './checkpoint-native-controller.mjs';
import {readHeadlessProfile} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(value);
export function validateAdoptionReport(original,ledger){
 assert.equal(original?.format,'craftmine.promo-pilot/1','ADOPTION_PILOT_REQUIRED');
 if(original.trialKind==='same-session-player-follow-up')assert.ok(original.originalReportUnchanged===true&&original.budgetAppendOnly===true&&!original.integrityError&&!original.closeoutError,'ADOPTION_CONTINUATION_INTEGRITY_REQUIRED');
 assert.equal(original.latest?.active,false,'ADOPTION_MODEL_MUST_BE_STOPPED');
 assert.ok(typeof original.endedAt==='string'&&Number.isFinite(Date.parse(original.endedAt))&&!original.forcedStop,'ADOPTION_CLEAN_END_REQUIRED');
 for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(original.exitReport?.[field],[],'ADOPTION_CLEAN_END_REQUIRED');
 const job=original.latest.job;
 assert.ok(job?.kind==='check'&&job.status==='passed'&&job.sourceStale===false&&job.output?.passed===true&&job.output?.check?.passed===true,'ADOPTION_REAL_CHECK_REQUIRED');
 assert.ok(Array.isArray(job.output.check.assertions)&&job.output.check.assertions.length>0&&job.output.check.assertions.every(item=>item.passed===true),'ADOPTION_REAL_CHECK_REQUIRED');
 assert.ok(id(original.worldId)&&job.worldId===original.worldId&&id(job.candidateId)&&id(job.buildId)&&id(job.jobId),'ADOPTION_CHECK_IDENTITY');
 assert.ok(path.isAbsolute(original.packageIdentity?.packaged??'')&&/^[a-f0-9]{64}$/.test(original.packageIdentity?.inventorySha256??''),'ADOPTION_FROZEN_PACKAGE_REQUIRED');
 const budget=original.budget;
 assert.ok(budget&&Number.isSafeInteger(budget.limit)&&budget.limit>0&&Number.isSafeInteger(budget.reserved)&&budget.reserved>0&&budget.reserved<=budget.limit&&Number.isSafeInteger(budget.remaining)&&budget.remaining>=0&&budget.remaining===budget.limit-budget.reserved,'ADOPTION_BUDGET_INVALID');
 if(original.maxRequests!==undefined)assert.equal(original.maxRequests,budget.limit,'ADOPTION_BUDGET_INVALID');
 assert.equal(ledger?.format,'craftmine.creation-evaluation-budget/1','ADOPTION_LEDGER_INVALID');
 assert.equal(ledger.limit,budget.limit,'ADOPTION_LEDGER_INVALID');
 assert.ok(Array.isArray(ledger.requests)&&ledger.requests.length===budget.reserved&&new Set(ledger.requests).size===ledger.requests.length&&ledger.requests.every(id),'ADOPTION_LEDGER_INVALID');
 return {worldId:original.worldId,candidateId:job.candidateId,buildId:job.buildId,jobId:job.jobId,budget:{limit:budget.limit,reserved:budget.reserved,remaining:budget.remaining}};
}
export function inspectAdoptionSource(file){
 assert.ok(path.isAbsolute(file),'ADOPTION_ABSOLUTE_REPORT_REQUIRED');
 const out=path.dirname(file),profile=path.join(out,'profile');
 const markerFile=path.join(profile,'headless-profile.json'),budgetFile=path.join(profile,'creation-evaluation-budget.json');
 const proofs=[file,markerFile,budgetFile].map(fileProof),original=readCheckpointJson(file);
 const marker=readCheckpointJson(markerFile);
 readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token});
 const selection=validateAdoptionReport(original,readCheckpointJson(budgetFile));
 assertProofs(proofs);
 return {original,out,profile,marker,budgetFile,selection,proofs};
}
// In addition to checkpoint sanitization, inherit only runtime/OS essentials.
// The sole permitted token is the already validated isolated headless authority.
const RUNTIME_ENV=new Set(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','HOME','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','COMMONPROGRAMFILES(X86)','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PROCESSOR_IDENTIFIER','LANG','LC_ALL','TZ','CRAFTMINE_HEADLESS_TEST','CRAFTMINE_HEADLESS_ROOT','CRAFTMINE_DATA_DIR','CRAFTMINE_HEADLESS_TOKEN','CRAFTMINE_CORE_BIN','CRAFTMINE_GODOT_BASES','PI_DESKTOP_HOST_BIN']);
export function adoptionEnvironment(client,paths){return Object.fromEntries(Object.entries(checkpointEnvironment(client,paths)).filter(([key])=>RUNTIME_ENV.has(key.toUpperCase())));}
export function validateAdoptionCall(method,fields={},selection){
 assert.ok(['status','primaryMode','godotObserve','godotCaptureView','worldPanel','quit'].includes(method),'ADOPTION_METHOD_DENIED');
 const allowed=method==='worldPanel'?['channel','payload']:method==='primaryMode'?['payload']:[];
 assert.ok(fields&&typeof fields==='object'&&!Array.isArray(fields)&&Object.keys(fields).every(key=>allowed.includes(key)),'ADOPTION_ENVELOPE_DENIED');
 if(method==='primaryMode'&&fields.payload!==undefined)assert.deepEqual(fields.payload,{action:'create'},'ADOPTION_MODE_DENIED');
 if(method==='worldPanel'){
  assert.ok(['godot.candidatePreview','godot.candidateApply','godot.runtimeSave'].includes(fields.channel),'ADOPTION_PANEL_DENIED');
  assert.deepEqual(fields.payload,fields.channel==='godot.runtimeSave'?{worldId:selection.worldId,freeze:true}:{worldId:selection.worldId,candidateId:selection.candidateId},'ADOPTION_TARGET_CHANGED');
 }
}
