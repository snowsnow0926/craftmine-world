import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readHeadlessProfile} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';
import {readCheckpointJson,fileProof,assertProofs} from './promo-checkpoint-contract.mjs';
import {promoPilotProgress} from './promo-pilot-progress.mjs';

export const CHECKPOINT_A05=Object.freeze({id:'PET_CHECKPOINT_A05',text:'我希望狗换成白色博美犬。'});
export const CHECKPOINT_A05_LIMITS=Object.freeze({requests:10,milliseconds:600000,thinking:'high'});
export function parseCheckpointLiveArgs(args){
 assert.ok(args.length>=1&&args.length<=2&&path.isAbsolute(args[0])&&(args.length===1||args[1]==='--live'),'CHECKPOINT_LIVE_USAGE: <absolute successful restore report> [--live]');
 return {file:args[0],live:args[1]==='--live'};
}
export function checkpointBudget(profile){
 const file=path.join(profile,'creation-evaluation-budget.json');
 if(!fs.existsSync(file))return {limit:10,reserved:0,remaining:10,filePresent:false};
 const ledger=readCheckpointJson(file);
 assert.equal(ledger.format,'craftmine.creation-evaluation-budget/1');assert.equal(ledger.limit,10,'CHECKPOINT_LIMIT_CHANGED');
 assert.ok(Array.isArray(ledger.requests)&&ledger.requests.length<=10&&new Set(ledger.requests).size===ledger.requests.length&&ledger.requests.every(id=>typeof id==='string'&&id.length>0),'CHECKPOINT_LEDGER_INVALID');
 return {limit:10,reserved:ledger.requests.length,remaining:10-ledger.requests.length,filePresent:true,ledgerSha256:fileProof(file).sha256};
}
export function inspectCheckpointLive(file,env=process.env){
 assert.equal(env.CRAFTMINE_EVAL_SESSION,undefined,'CHECKPOINT_FRESH_SESSION_REQUIRED');
 if(env.CRAFTMINE_EVAL_REQUEST_LIMIT!==undefined)assert.equal(env.CRAFTMINE_EVAL_REQUEST_LIMIT,'10','CHECKPOINT_LIMIT_FIXED');
 if(env.CRAFTMINE_EVAL_THINKING!==undefined)assert.equal(env.CRAFTMINE_EVAL_THINKING,'high','CHECKPOINT_THINKING_FIXED');
 const restored=readCheckpointJson(file);assert.equal(restored.format,'craftmine.promo-checkpoint/1');assert.equal(restored.phase,'restore');assert.equal(restored.ok,true,'CHECKPOINT_SUCCESSFUL_RESTORE_REQUIRED');
 assert.equal(restored.trialKind,'checkpoint-derived');assert.equal(restored.modelRequestsAdded,0);assert.equal(restored.originalEvidenceUnchanged,true);
 const out=path.resolve(path.dirname(file)),profile=path.join(out,'profile'),markerFile=path.join(profile,'headless-profile.json'),marker=readCheckpointJson(markerFile);
 assert.equal(path.resolve(restored.newProfile.profile),profile);assert.equal(path.resolve(restored.newProfile.root),out);
 readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token});
 assert.equal(fileProof(markerFile).sha256,restored.newProfile.markerSha256,'CHECKPOINT_MARKER_CHANGED');
 assert.ok(restored.checkpoint?.worldId&&restored.checkpoint.buildId&&restored.packageIdentity?.packaged&&restored.packageIdentity.inventorySha256,'CHECKPOINT_IDENTITY_REQUIRED');
 const original=readCheckpointJson(restored.originalReport),model=original.model;
 assert.ok(typeof model==='string'&&/^deepseek-[a-z0-9.-]+$/.test(model),'CHECKPOINT_ORIGINAL_MODEL_REQUIRED');
 if(env.CRAFTMINE_EVAL_MODEL!==undefined)assert.equal(env.CRAFTMINE_EVAL_MODEL,model,'CHECKPOINT_MODEL_CHANGED');
 const proofs=[fileProof(file),fileProof(markerFile),...(restored.sourceProofs??[])];assert.ok(restored.sourceProofs?.length>=3,'CHECKPOINT_SOURCE_PROOFS_REQUIRED');assertProofs(proofs);
 const budget=checkpointBudget(profile);assert.equal(budget.reserved,0,'CHECKPOINT_ALREADY_CONSUMED');
 const output=path.join(out,'model-report.json');assert.equal(fs.existsSync(output),false,'CHECKPOINT_MODEL_REPORT_EXISTS');
 return {restored,original,out,profile,token:marker.token,model,proofs,budget,output};
}
export function checkpointA05Plan(context){
 const plan={trialKind:'checkpoint-derived',checkpointBase:'PET01',mainlineStep:'A05',attemptWithinRestoredProfile:1,wish:CHECKPOINT_A05,
  note:'基于 PET01 已采用检查点的新 A05 尝试；不是独立清单 PET02（叫它团子），也不是完整主线通过。',
  worldId:context.restored.checkpoint.worldId,originalBuild:context.restored.checkpoint.buildId,model:context.model,thinking:'high',maxRequests:10,maxMinutes:10};
 return {...plan,planSha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
export function checkpointPoll(state,started){
 assert.equal(state.budget?.limit,10,'CHECKPOINT_RUNTIME_BUDGET');assert.ok(Number.isSafeInteger(state.budget.reserved)&&state.budget.reserved>=0&&state.budget.reserved<=10,'CHECKPOINT_RUNTIME_BUDGET');
 const observed=started||state.active===true||state.budget.reserved>0;
 return {started:observed,...(observed?promoPilotProgress(state):{settled:false,reason:'WAITING_FIRST_TURN'})};
}
export function checkpointSanitizer(secrets){
 const strings=secrets.filter(value=>typeof value==='string'&&value.length>0);
 const clean=value=>typeof value==='string'?strings.reduce((text,secret)=>text.split(secret).join('[REDACTED]'),value):Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/secret|api.?key|authorization|access.?token|refresh.?token/i.test(key)?'[REDACTED]':clean(item)])):value;
 return clean;
}
export function checkpointRecoverySignal(value){
 if(!value||typeof value!=='object')return false;
 if(Array.isArray(value))return value.some(checkpointRecoverySignal);
 for(const key of ['error','errorCode','code'])if(typeof value[key]==='string'&&/EXPLICIT_RECOVERY_REQUIRED|WORLD_LEASE|LEASE_HELD/.test(value[key]))return true;
 return Object.values(value).some(item=>item&&typeof item==='object'&&checkpointRecoverySignal(item));
}
