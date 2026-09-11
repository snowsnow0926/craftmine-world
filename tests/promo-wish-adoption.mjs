// Continue a completed pilot via normal player preview/apply/save APIs. No model.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
const file=process.argv[2];assert.ok(file&&path.isAbsolute(file),'Pass the absolute completed pilot report');
const original=JSON.parse(fs.readFileSync(file)),out=path.dirname(file),profile=path.join(out,'profile');
assert.equal(original.format,'craftmine.promo-pilot/1');assert.equal(original.latest?.job?.status,'passed');assert.equal(original.budget?.remaining,0,'This continuation refuses any remaining model budget');
const marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'))),client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot:original.packageIdentity.packaged});
assert.equal(client.identity.inventorySha256,original.packageIdentity.inventorySha256,'Use the exact pilot product');
const auditDir=path.join(out,'adoption-'+randomUUID());fs.mkdirSync(auditDir);
const record={format:'craftmine.promo-adoption/1',originalReport:file,worldId:original.worldId,candidateId:original.latest.job.candidateId,modelRequestsAdded:0,sourceEdits:0,checks:[],launches:[],visual:'UNVERIFIED'};
const budgetFile=path.join(profile,'creation-evaluation-budget.json'),budget=fs.readFileSync(budgetFile,'utf8');
let child,ready,ended,exit,exitReport;const pending=new Map();
function boot(){
  ready=false;ended=false;exitReport=null;const number=record.launches.length+1;
  const env={...client.environment({out,profile,token:marker.token}),CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_REQUEST_LIMIT:String(original.budget.limit)};
  child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  for(const stream of ['stdout','stderr'])child[stream].on('data',data=>fs.appendFileSync(path.join(auditDir,number+'-'+stream+'.log'),data));
  const launch={number};record.launches.push(launch);
  exit=new Promise(resolve=>child.on('exit',(code,signal)=>{ended=true;launch.exit={code,signal};resolve();}));
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit'){exitReport=message;launch.audit=message;}const call=pending.get(message.id);if(call){clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.result);}});
}
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('TIMEOUT '+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload});
async function until(read,accept,label){const deadline=Date.now()+120000;while(Date.now()<deadline){if(ended)throw Error('CLIENT_EXITED '+label);try{const r=await read();if(accept(r))return r;}catch(error){if(!/not ready|UNAVAILABLE|WORLD_BUSY|No world runtime is running/.test(error.message))throw error;}await delay(500);}throw Error('TIMEOUT '+label);}
async function start(){boot();await until(async()=>ready,Boolean,'controller');await until(()=>rpc('primaryMode'),r=>r.entry,'entry');await rpc('primaryMode',{payload:{action:'create'}});await until(()=>rpc('godotObserve'),r=>r.worldId===original.worldId&&r.instanceId,'world');}
async function stop(){if(!ended){try{await rpc('quit');}catch{}await Promise.race([exit,delay(15000)]);if(!ended){child.kill();throw Error('SHUTDOWN_TIMEOUT');}}assert.deepEqual(exitReport?.violations,[]);assert.deepEqual(exitReport?.pageErrors,[]);assert.deepEqual(exitReport?.shutdownFailures,[]);}
const check=(name,yes)=>{assert.ok(yes,name);record.checks.push(name);console.log('PASS '+name);};
try{
  await start();record.before=await rpc('godotObserve');
  record.preview=await panel('godot.candidatePreview',{worldId:original.worldId,candidateId:record.candidateId});check('original checked candidate enters normal preview',record.preview.status==='preview');
  record.applied=await panel('godot.candidateApply',{worldId:original.worldId,candidateId:record.candidateId});check('normal adoption commits the original candidate',record.applied.status==='applied');
  const after=await until(()=>rpc('godotObserve'),r=>r.worldId===original.worldId&&r.buildId!==record.before.buildId,'adopted runtime');record.after=after;
  const capture=await rpc('godotCaptureView');fs.writeFileSync(path.join(auditDir,'adopted.png'),Buffer.from(capture.pngBase64,'base64'));record.capture={width:capture.width,height:capture.height};
  record.saved=await panel('godot.runtimeSave',{worldId:original.worldId,freeze:true});await stop();
  await start();record.reopened=await rpc('godotObserve');check('cold reopen preserves the adopted world and build',record.reopened.worldId===after.worldId&&record.reopened.buildId===after.buildId&&record.reopened.instanceId!==after.instanceId);
  const reopened=await rpc('godotCaptureView');fs.writeFileSync(path.join(auditDir,'reopened.png'),Buffer.from(reopened.pngBase64,'base64'));
  check('no additional provider requests were reserved',fs.readFileSync(budgetFile,'utf8')===budget);await stop();record.ok=true;
}catch(error){record.ok=false;record.error=String(error.stack??error);process.exitCode=1;console.error(error.message);}
finally{if(!ended)try{await stop();}catch{}for(const p of pending.values())clearTimeout(p.timer);fs.writeFileSync(path.join(auditDir,'report.json'),JSON.stringify(record,null,2));console.log('Report: '+auditDir);}

