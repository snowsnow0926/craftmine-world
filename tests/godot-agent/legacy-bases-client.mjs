// Sealed product: ordinary four-base creation -> actual initialization check,
// existing semantic gameplay and full process restart in independent profiles.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {createCompleteOutput,completeEnvironment} from '../godot-final/complete-contract.mjs';
import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
import {LEGACY_BASE_CASES,assertLegacyCheck,assertLegacyCold,validateLegacyCall,isWorldBusyPreflight} from './legacy-bases-contract.mjs';
import {creationPackageInventory} from '../helpers/creation-native-launch.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const packaged=process.env.CRAFTMINE_PACKAGED_ROOT;
const requestedBase=process.env.CRAFTMINE_LEGACY_BASE;
if(requestedBase!==undefined&&!LEGACY_BASE_CASES.some(item=>item.baseId===requestedBase))throw Error('Unknown legacy base selection');
const selectedCases=requestedBase?LEGACY_BASE_CASES.filter(item=>item.baseId===requestedBase):LEGACY_BASE_CASES;
if(!packaged||!path.isAbsolute(packaged))throw Error('Exact sealed CRAFTMINE_PACKAGED_ROOT required');
const resources=path.join(packaged,'resources'),manifestFile=path.join(resources,'source/build-manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
assert.equal(manifest.format,'craftmine.build/1');assert.equal(manifest.appId,'world.craftmine.desktop');
assert.equal(manifest.commit,'2a584796a9da32f6c8c5e597804d03fdefff638a');
const dependencies=process.env.CRAFTMINE_DESKTOP_DEPS_ROOT||'D:/cm-agent-godot-0912/vendor/pi-desktop/apps/desktop';
const require=createRequire(path.join(dependencies,'package.json')),builder=createRequire(require.resolve('electron-builder')),lib=createRequire(builder.resolve('app-builder-lib'));
const asar=lib('@electron/asar');
const main=asar.extractFile(path.join(resources,'app.asar'),path.normalize('out/main/index.js')).toString('utf8');
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance','Headless window was not created offscreen'])assert.ok(main.includes(guard),'Sealed build lacks guard: '+guard);
assert.ok(asar.extractFile(path.join(resources,'app.asar'),path.normalize('out/preload/craftmine-headless.cjs')).includes(Buffer.from('requestPointerLock')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=createCompleteOutput(root);let profile,token,currentCase;
const packageInventory=creationPackageInventory(packaged),inventorySha256=hash(JSON.stringify(packageInventory));
fs.writeFileSync(path.join(out,'package-inventory.json'),JSON.stringify(packageInventory,null,2));
const report={format:'craftmine.legacy-bases-client/1',out,packaged,commit:manifest.commit,inventorySha256,manifestSha256:hash(fs.readFileSync(manifestFile)),startedAt:new Date().toISOString(),launches:[],steps:[],calls:[],cases:[],scope:'Model-free normal four-base creation/check/load and existing fixed semantic gameplay/save/cold restart',notVerified:['Ordinary player-model authorship','All gameplay/features of each base','Subjective controls or performance']};
report.requestedBases=selectedCases.map(item=>item.baseId);
if(requestedBase)report.scope='Single-base developer diagnostic; not the complete GA27 four-base acceptance';
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));let imageCount=0;
function evidence(value){if(Array.isArray(value))return value.map(evidence);if(value&&typeof value==='object'){const result={};for(const [key,item]of Object.entries(value)){if(key==='pngBase64'){const bytes=Buffer.from(item,'base64'),file='capture-'+(++imageCount)+'.png';fs.writeFileSync(path.join(out,file),bytes);result.image={file,sha256:hash(bytes),bytes:bytes.length};}else result[key]=evidence(item);}return result;}return value;}
let child,ready=false,ended=true,exit=Promise.resolve(),launch,stopping=false;const pending=new Map();
function start(){
  assert.ok(ended);ready=false;ended=false;launch={number:report.launches.length+1,baseId:currentCase.baseId};report.launches.push(launch);
  const env=completeEnvironment(process.env,{out,profile,token,core:path.join(resources,'bin/craftmine-core.exe'),host:path.join(resources,'bin/pi-desktop-host-core.exe'),bases:undefined});
  child=spawn(path.join(packaged,'Craftmine World.exe'),[],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});launch.pid=child.pid;const current=launch;
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,current.number+'-'+stream+'.log'),bytes));
  child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')current.exitAudit=message;if(message?.type!=='craftmine-headless')return;const task=pending.get(message.id);if(!task)return;clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error)):task.resolve(message.result);});
  exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Client exited'));}pending.clear();save();resolve();};child.once('error',error=>finish(null,null,error));child.once('exit',(code,signal)=>finish(code,signal));});
}
function rpc(method,payload={},timeout=30000){validateLegacyCall(method,payload);return new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Client is closed'));const id=randomUUID(),record={launch:launch.number,baseId:currentCase.baseId,method,payload,at:new Date().toISOString()};report.calls.push(record);const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},timeout);pending.set(id,{timer,resolve:result=>{record.result=evidence(result);save();resolve(result);},reject:error=>{record.error=String(error);save();reject(error);}});child.send({type:'craftmine-headless',id,method,...payload});});}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload},180000);
const panel=(worldId,channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}},180000);
async function until(read,predicate,label,timeout=900000){const deadline=Date.now()+timeout;let last,lastError;while(Date.now()<deadline){if(stopping||ended)throw Error('TRIAL_STOPPED');try{last=await read();}catch(error){lastError=String(error);await delay(1000);continue;}if(predicate(last))return last;await delay(1000);}throw Error(label+': '+JSON.stringify(last)+' '+(lastError||''));}
async function step(name,body){try{const value=await body();report.steps.push({baseId:currentCase.baseId,name,passed:true,result:evidence(value)});save();console.log('PASS '+currentCase.baseId+' '+name);return value;}catch(error){report.steps.push({baseId:currentCase.baseId,name,passed:false,error:String(error)});save();throw error;}}
async function stop(){if(!launch)return;if(!ended){try{await rpc('quit',{},5000);}catch{}await Promise.race([exit,delay(12000)]);if(!ended){launch.forcedStop=true;child.kill();await exit;}}assertCleanHeadlessShutdown({...launch,audit:launch.exitAudit});}
function requestStop(reason){
  if(stopping)return;stopping=true;report.cancelled={reason,at:new Date().toISOString()};
  for(const [id,task]of pending){clearTimeout(task.timer);pending.delete(id);task.reject(Error('TRIAL_CANCELLED'));}
  save();if(!ended)void rpc('quit',{},5000).catch(()=>{});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>requestStop(signal));
const cancelPoll=setInterval(()=>{if(fs.existsSync(path.join(out,'cancel.request')))requestStop('cancel.request');},250);cancelPoll.unref();
async function started(){await until(async()=>ready,Boolean,'headless control ready',90000);const status=await until(()=>rpc('status'),r=>r.windows.length>0,'offscreen main window',90000);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));assert.deepEqual(status.violations,[]);await until(()=>nav('world.createOptions'),r=>r.bases?.some(b=>b.id==='creation-sandbox'),'catalog',90000);return status;}
async function settled(worldId){const row=await until(async()=>{const list=await nav('world.list');const row=list.worlds?.find(w=>w.id===worldId);return row;},row=>{if(row?.state==='failed')throw Error('World initialization failed: '+JSON.stringify(row));return row?.state==='ready';},'ready world');await until(()=>rpc('godotObserve'),r=>r.worldId===worldId&&r.instanceId,'runtime bound');await until(()=>rpc('worldNavigationReady'),r=>r.worldId===worldId&&r.ready,'navigation ready',90000);return row;}
console.log('EVIDENCE_DIRECTORY='+out);save();
for(const definition of selectedCases){
 if(stopping)break;
 currentCase={...definition,passed:false};report.cases.push(currentCase);
 const directory=path.join(out,definition.baseId);fs.mkdirSync(directory);profile=path.join(directory,'profile');const legacySource=path.join(directory,'legacy');token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacySource);
 fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
 currentCase.profile=profile;
 try{
  start();await step('sealed client offscreen startup',started);
  await step('ordinary create surface',()=>rpc('primaryMode',{payload:{action:'create'}}));
  await until(()=>rpc('worldNavigationReady'),r=>r.ready,'surface ready',90000);
  const options=await nav('world.createOptions');assert.ok(options.bases.some(base=>base.id===definition.baseId&&base.starters.some(starter=>starter.id===definition.starterId)));
  const world=await step('ordinary world.create',()=>nav('world.create',{title:'GA27 '+definition.baseId,baseId:definition.baseId,starterId:definition.starterId,operationId:randomUUID()}));currentCase.worldId=world.id;
  currentCase.initialization=await step('initialization reaches real loaded runtime',()=>settled(world.id));
  currentCase.initialObservation=await rpc('godotObserve');
  const candidates=await panel(world.id,'godot.candidateList');const candidate=candidates.items.find(item=>item.buildId===currentCase.initialObservation.buildId);assert.ok(candidate,'Loaded build must have a real checked candidate');
  const job=await nav('godot.historyJob',{worldId:world.id,jobId:candidate.checkJobId});
  await step('loaded build binds original real LPAC check',async()=>{assertLegacyCheck(definition.baseId,world.id,currentCase.initialObservation,candidate,job);return {candidate,job};});currentCase.candidate=candidate;currentCase.job=evidence(job);
  await step('initial live pixels',()=>rpc('godotCaptureView'));
  await panel(world.id,'godot.runtimeResume');
  currentCase.gameplay=evidence(await step('existing semantic gameplay route',async()=>{
   if(definition.gameplay==='godotExplore'){
    const observed=await rpc('godotObserve'),result=await rpc('godotExplore',{payload:{worldId:world.id,buildId:observed.buildId,instanceId:observed.instanceId,steps:[{op:'walk',args:{forward:1,right:0,frames:30}},{op:'wait',args:{frames:30}}]}},180000);
    const a=result.before.payload.player.position,b=result.after.payload.player.position;assert.ok(Array.isArray(a)&&Array.isArray(b),'measured player positions');assert.ok(Math.hypot(...a.map((n,i)=>b[i]-n))>0.05,'normal walk moves actual player');return result;
   }
   const result=await rpc(definition.gameplay,{},900000);assert.equal(result.ok,true,result.error);return result;
  }));
  await step('save full native progress',()=>panel(world.id,'godot.runtimeSave',{freeze:true}));
  const beforeCold={observation:await rpc('godotObserve'),snapshot:await rpc('godotSnapshot')};currentCase.beforeCold=evidence(beforeCold);
  await step('saved live pixels',()=>rpc('godotCaptureView'));
  await step('first process clean shutdown',stop);start();await step('same package cold startup',started);
  await rpc('primaryMode',{payload:{action:'create'}});
  await until(()=>rpc('worldNavigationReady'),r=>r.ready,'cold navigation ready',90000);
  try{await nav('world.open',{id:world.id});}catch(error){if(!isWorldBusyPreflight(error))throw error;await until(()=>rpc('worldNavigationReady'),r=>r.ready,'busy navigation ready',90000);await nav('world.open',{id:world.id});}
  await settled(world.id);await panel(world.id,'godot.runtimeSave',{freeze:true});
  const afterCold={observation:await rpc('godotObserve'),snapshot:await rpc('godotSnapshot')};currentCase.afterCold=evidence(afterCold);
  await step('cold same build new instance and complete progress',async()=>{assertLegacyCold(beforeCold,afterCold);return afterCold;});
  await step('cold live pixels',()=>rpc('godotCaptureView'));
  currentCase.passed=true;
 }catch(error){currentCase.failure=String(error.stack??error);console.error(definition.baseId+': '+currentCase.failure);process.exitCode=1;}
 finally{try{await stop();}catch(error){currentCase.shutdownFailure=String(error.stack??error);currentCase.passed=false;process.exitCode=1;}save();}
}
clearInterval(cancelPoll);report.finishedAt=new Date().toISOString();
try{assert.equal(hash(JSON.stringify(creationPackageInventory(packaged))),inventorySha256);report.packageUnchanged=true;}catch(error){report.packageChanged=String(error);process.exitCode=1;}
report.passed=!stopping&&report.cases.length===selectedCases.length&&report.cases.every(item=>item.passed)&&report.packageUnchanged===true;save();console.log('EVIDENCE_DIRECTORY='+out);
