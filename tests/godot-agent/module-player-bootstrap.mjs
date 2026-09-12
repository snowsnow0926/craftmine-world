// Sealed product bootstrap for a later ordinary player turn. Only existing
// protected APIs: create world, import same ZIP twice, real check/adopt, session.
// No provider/model setup, prompt, fabricated capture or harness source patch.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createCompleteOutput} from '../godot-final/complete-contract.mjs';
import {resolveCreationNativeLaunch,creationPackagedRoot} from '../helpers/creation-native-launch.mjs';
import {adoptionEnvironment} from '../helpers/promo-adoption-contract.mjs';
import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
import {assertFormalPackageCheck,assertFormalAdoption} from './formal-package-contract.mjs';
import {BUILDING_ZIP_SHA256,validateModuleBootstrapCall,assertModuleBootstrapPackages} from './module-player-bootstrap-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),packagedRoot=creationPackagedRoot();
assert.ok(packagedRoot&&path.isAbsolute(packagedRoot),'Explicit sealed --packaged-root required');
const expectedCommit=process.env.CRAFTMINE_EXPECTED_PACKAGE_COMMIT;assert.match(expectedCommit??'',/^[a-f0-9]{40}$/,'Explicit CRAFTMINE_EXPECTED_PACKAGE_COMMIT required');
const client=resolveCreationNativeLaunch({root,packagedRoot,requiredGuards:['playerCreateSession','HEADLESS_PLAYER_NORMAL_SESSION_REQUIRED']});
const manifest=JSON.parse(fs.readFileSync(path.join(packagedRoot,'resources/source/build-manifest.json'),'utf8'));assert.equal(manifest.commit,expectedCommit);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),zip=fs.readFileSync(path.join(root,'docs/evidence/gu6-kenney-modules-20260912/building.zip'));
assert.equal(hash(zip),BUILDING_ZIP_SHA256);
const out=createCompleteOutput(root),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
fs.writeFileSync(path.join(out,'component.zip'),zip);
const report={format:'craftmine.module-player-bootstrap/1',status:'preparing',out,worldId:null,startedAt:new Date().toISOString(),packageIdentity:client.identity,commit:manifest.commit,
 modelRequestsStarted:0,directSourceEditsByHarness:0,syntheticCaptures:0,steps:[],calls:[],packages:[],
 scope:'protected ordinary double building import/check/adopt plus ordinary empty player session; no layout, parameter edit, model or cold game acceptance',
 notVerified:['Module layout: the two normal default instances overlap','Actual selected sceneObjectTarget','Module parameter editing/persistence','Player model capabilities','Cold application reopen']};
const file=path.join(out,'bootstrap.json'),save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
let child,ready=false,ended=false,stopping=false,exitReport,exitPromise;const pending=new Map();
function rpc(method,fields={},timeout=120000){
 validateModuleBootstrapCall(method,fields,report.worldId);
 if((stopping&&method!=='quit')||ended)return Promise.reject(Error('BOOTSTRAP_STOPPED'));
 const record={method,fields:structuredClone(fields),worldId:report.worldId};report.calls.push(record);save();
 return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('BOOTSTRAP_RPC_TIMEOUT:'+method));},timeout);
  pending.set(id,{timer,resolve,reject});child.send({type:'craftmine-headless',id,method,...fields},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
 });
}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId:report.worldId,...payload}});
const packageCall=(method,params={})=>panel('package.request',{method,params:{worldId:report.worldId,...params}});
async function until(read,predicate,label,timeout=900000){
 const deadline=Date.now()+timeout;let last,lastError;
 while(Date.now()<deadline){
  if(stopping||ended)throw Error('BOOTSTRAP_STOPPED');
  try{last=await read();}catch(error){lastError=String(error);await delay(500);continue;}
  if(predicate(last))return last;await delay(500);
 }
 throw Error(label+': '+JSON.stringify(last)+' '+(lastError??''));
}
async function step(label,run){
 try{const value=await run();report.steps.push({label,passed:true});save();console.log('PASS '+label);return value;}
 catch(error){report.steps.push({label,passed:false,error:String(error)});save();throw error;}
}
function stop(reason){
 if(stopping)return;stopping=true;report.cancelled={reason,at:new Date().toISOString()};
 for(const [id,task]of pending){clearTimeout(task.timer);pending.delete(id);task.reject(Error('BOOTSTRAP_CANCELLED'));}
 save();if(child&&!ended)void rpc('quit',{},5000).catch(()=>{});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(signal));
const cancel=setInterval(()=>{if(fs.existsSync(path.join(out,'cancel.request')))stop('cancel.request');},250);cancel.unref();
save();console.log('EVIDENCE_DIRECTORY='+out);
try{
 const env=adoptionEnvironment(client,{out,profile,token});
 assert.ok(!Object.keys(env).some(key=>/CREATION_EVAL|EVAL_|LIVE_|API_KEY|SECRET|AUTHORIZATION/i.test(key)));
 child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});report.pid=child.pid;
 for(const name of ['stdout','stderr'])child[name].on('data',bytes=>fs.appendFileSync(path.join(out,name+'.log'),bytes));
 exitPromise=new Promise(resolve=>{
  child.on('error',error=>{report.launchError=String(error);ended=true;resolve();});
  child.on('exit',(code,signal)=>{report.exit={code,signal};ended=true;for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Client exited'));}pending.clear();resolve();});
 });
 child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')exitReport=message;const task=pending.get(message?.id);if(task){clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error)):task.resolve(message.result);}});
 await until(async()=>ready,Boolean,'protected controller',90000);
 report.initialStatus=await step('sealed offscreen protected client',()=>until(()=>rpc('status'),state=>state.windows?.length,'window',90000));
 assert.ok(report.initialStatus.windows.every(window=>!window.visible&&!window.focused&&!window.focusable&&window.offscreen));assert.deepEqual(report.initialStatus.violations,[]);
 await step('ordinary create mode',()=>rpc('primaryMode',{payload:{action:'create'}}));
 await until(()=>rpc('worldNavigationReady'),value=>value.ready,'ordinary navigation surface ready before create',90000);
 await until(()=>nav('world.createOptions'),result=>result.bases?.some(base=>base.id==='creation-sandbox'&&base.delivered),'base catalog',90000);
 const created=await step('ordinary blank creation world',()=>nav('world.create',{title:'两栋导入建筑参数验收',baseId:'creation-sandbox',starterId:'blank',operationId:randomUUID()}));report.worldId=created.id;save();
 await until(()=>nav('world.list'),list=>{const row=list.worlds?.find(world=>world.id===created.id);if(row?.state==='failed')throw Error('World initialization failed');return row?.state==='ready';},'initial real build');
 report.initialObservation=await until(()=>rpc('godotObserve'),value=>value.worldId===created.id&&value.instanceId,'runtime');
 await until(()=>rpc('worldNavigationReady'),value=>value.worldId===created.id&&value.ready,'navigation',90000);
 let lastBuild=report.initialObservation.buildId;
 for(const slot of ['A','B']){
  const operationId=randomUUID();
  const imported=await step(slot+' ordinary source ZIP import',()=>packageCall('importSource',{operationId}));
  assert.equal(imported.operationId,operationId);assert.equal(imported.archiveSha256,BUILDING_ZIP_SHA256);
  const checked=await step(slot+' actual executor check',()=>until(()=>nav('godot.historyJob',{worldId:created.id,jobId:imported.job.id}),job=>{if(['blocked','failed','cancelled','interrupted'].includes(job.status))throw Error('Real check did not pass: '+job.status);return job.status==='passed';},'package check'));
  assertFormalPackageCheck(created.id,imported,checked);
  const terminal=await packageCall('sourceJob',{jobId:imported.job.id});assert.equal(terminal.status,'passed');assert.equal(terminal.terminal,true);
  assert.equal((await rpc('godotObserve')).buildId,lastBuild);
  await panel('godot.runtimeSave',{freeze:true});const progressBefore=await rpc('godotSnapshot');
  const preview=await step(slot+' normal candidate preview',()=>panel('godot.candidatePreview',{candidateId:checked.candidateId}));
  const applied=await step(slot+' normal candidate apply',()=>panel('godot.candidateApply',{candidateId:checked.candidateId}));
  const observed=await until(()=>rpc('godotObserve'),value=>value.worldId===created.id&&value.buildId===preview.buildId,'new adopted runtime');
  assertFormalAdoption(created.id,checked,preview,applied,observed);lastBuild=observed.buildId;
  const sources=await packageCall('sourceList'),progressAfter=await rpc('godotSnapshot');
  assert.deepEqual(progressAfter.state,progressBefore.state,'normal module adoption must preserve the existing base progress');
  report.packages.push({slot,kind:'building',archiveSha256:BUILDING_ZIP_SHA256,imported,checked,preview,applied,observed,sources,progressBefore,progressAfter});save();
 }
 report.finalSources=await packageCall('sourceList');report.finalObservation=await rpc('godotObserve');
 await panel('godot.runtimeSave',{freeze:true});report.finalSnapshot=await rpc('godotSnapshot');
 const frame=await rpc('godotCaptureView'),image=Buffer.from(frame.pngBase64,'base64');fs.writeFileSync(path.join(out,'two-default-buildings.png'),image);
 report.image={file:'two-default-buildings.png',sha256:hash(image),width:frame.width,height:frame.height,scope:'default instances may overlap; no selection/layout claim'};
 report.session=await step('ordinary empty player session creation',()=>rpc('playerCreateSession',{payload:{worldId:created.id,title:'两栋建筑的普通玩家创作'}}));
 report.sessionId=report.session.sessionId;report.entityIds=assertModuleBootstrapPackages(report);report.status='created';save();
}catch(error){report.failure=String(error.stack??error);report.status=stopping?'cancelled':'failed';process.exitCode=1;}
finally{
 clearInterval(cancel);
 if(child&&!ended){try{await rpc('quit',{},5000);}catch{}await Promise.race([exitPromise,delay(15000)]);if(!ended){report.forcedStop=true;child.kill();await exitPromise;}}
 report.exitReport=exitReport;for(const task of pending.values())clearTimeout(task.timer);
 try{client.assertUnchanged();assertCleanHeadlessShutdown({exit:report.exit,forcedStop:report.forcedStop,audit:exitReport});report.stateIntegrityVerified=true;}catch(error){report.shutdownFailure=String(error);report.stateIntegrityVerified=false;process.exitCode=1;}
 report.passed=!stopping&&!report.failure&&!report.shutdownFailure&&report.steps.every(step=>step.passed);report.finishedAt=new Date().toISOString();save();console.log('REPORT='+file);
}
