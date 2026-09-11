// Continue a completed pilot via normal player preview/apply/save APIs. No model.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {inspectAdoptionSource,adoptionEnvironment,validateAdoptionCall,modelFreeExecutionEvidence} from './helpers/promo-adoption-contract.mjs';
import {assertProofs} from './helpers/promo-checkpoint-contract.mjs';
const file=process.argv[2];assert.ok(file&&path.isAbsolute(file),'Pass the absolute completed pilot report');
const {original,out,profile,marker,selection,proofs}=inspectAdoptionSource(file);
const client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot:original.packageIdentity.packaged});
assert.equal(client.identity.inventorySha256,original.packageIdentity.inventorySha256,'Use the exact pilot product');
const auditDir=path.join(out,'adoption-'+randomUUID());fs.mkdirSync(auditDir);
const record={format:'craftmine.promo-adoption/1',sourceFormat:original.format,originalReport:file,worldId:selection.worldId,candidateId:selection.candidateId,checkedBuildId:selection.buildId,...(selection.budget?{budgetBefore:selection.budget,budgetAfter:null}:{}),modelCallsAdded:null,modelRequestsAdded:null,sourceEdits:0,checks:[],launches:[],visual:'UNVERIFIED'};
const controllerCalls=[];
let child,ready,ended=true,exit,exitReport;const pending=new Map();
function boot(){
  assertProofs(proofs);client.assertUnchanged();
  ready=false;ended=false;exitReport=null;const number=record.launches.length+1;
  const env=adoptionEnvironment(client,{out,profile,token:marker.token});
  child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const launch={number,stdoutBytes:0,stderrBytes:0};record.launches.push(launch);
  for(const stream of ['stdout','stderr'])child[stream].on('data',data=>{launch[stream+'Bytes']+=data.length;});
  exit=new Promise(resolve=>{child.on('exit',(code,signal)=>{ended=true;launch.exit={code,signal};resolve();});child.once('error',error=>{ended=true;launch.errorCode=error.code;for(const call of pending.values()){clearTimeout(call.timer);call.reject(error);}pending.clear();resolve();});});
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit'){exitReport=message;launch.audit=message;}const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
}
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{validateAdoptionCall(method,fields,selection);controllerCalls.push(method==='worldPanel'?method+':'+fields.channel:method);const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('TIMEOUT '+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload});
async function until(read,accept,label){const deadline=Date.now()+120000;while(Date.now()<deadline){if(ended)throw Error('CLIENT_EXITED '+label);try{const r=await read();if(accept(r))return r;}catch(error){if(!/not ready|UNAVAILABLE|WORLD_BUSY|No world runtime is running/.test(error.message))throw error;}await delay(500);}throw Error('TIMEOUT '+label);}
async function start(){boot();await until(async()=>ready,Boolean,'controller');const isolation=await until(()=>rpc('status'),r=>r.windows?.length,'isolation');assert.deepEqual(isolation.violations,[]);assert.ok(isolation.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await until(()=>rpc('primaryMode'),r=>r.entry,'entry');await rpc('primaryMode',{payload:{action:'create'}});await until(()=>rpc('godotObserve'),r=>r.worldId===original.worldId&&r.instanceId,'world');}
async function stop(){if(!ended){try{await rpc('quit');}catch{}await Promise.race([exit,delay(15000)]);if(!ended){child.kill();throw Error('SHUTDOWN_TIMEOUT');}}assert.deepEqual(exitReport?.violations,[]);assert.deepEqual(exitReport?.pageErrors,[]);assert.deepEqual(exitReport?.shutdownFailures,[]);assertProofs(proofs);client.assertUnchanged();}
const check=(name,yes)=>{assert.ok(yes,name);record.checks.push(name);console.log('PASS '+name);};
try{
  await start();record.before=await rpc('godotObserve');
  record.preview=await panel('godot.candidatePreview',{worldId:original.worldId,candidateId:record.candidateId});check('original checked candidate enters normal preview',record.preview.status==='preview');
  record.applied=await panel('godot.candidateApply',{worldId:original.worldId,candidateId:record.candidateId});check('normal adoption commits the original candidate',record.applied.status==='applied');
  const after=await until(()=>rpc('godotObserve'),r=>r.worldId===original.worldId&&r.buildId===selection.buildId,'adopted runtime');record.after=after;
  const capture=await rpc('godotCaptureView');fs.writeFileSync(path.join(auditDir,'adopted.png'),Buffer.from(capture.pngBase64,'base64'));record.capture={width:capture.width,height:capture.height};
  record.saved=await panel('godot.runtimeSave',{worldId:original.worldId,freeze:true});await stop();
  await start();record.reopened=await rpc('godotObserve');check('cold reopen preserves the adopted world and build',record.reopened.worldId===after.worldId&&record.reopened.buildId===after.buildId&&record.reopened.instanceId!==after.instanceId);
  const reopened=await rpc('godotCaptureView');fs.writeFileSync(path.join(auditDir,'reopened.png'),Buffer.from(reopened.pngBase64,'base64'));
  await stop();assertProofs(proofs);check(selection.budget?'original report and request ledger remain byte-identical':'original player report and marker remain byte-identical',true);
  if(selection.budget)record.budgetAfter={...selection.budget};record.noModelExecution=modelFreeExecutionEvidence(exitReport,controllerCalls);record.modelCallsAdded=0;record.modelRequestsAdded=0;record.ok=true;
}catch(error){record.ok=false;record.error=String(error.stack??error);process.exitCode=1;console.error(error.message);}
finally{if(!ended)try{await stop();}catch(error){record.ok=false;record.shutdownError=String(error.message);process.exitCode=1;}try{assertProofs(proofs);client.assertUnchanged();}catch(error){record.ok=false;record.integrityError=String(error.message);process.exitCode=1;}for(const p of pending.values())clearTimeout(p.timer);fs.writeFileSync(path.join(auditDir,'report.json'),JSON.stringify(record,null,2));console.log('Report: '+auditDir);}
