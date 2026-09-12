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
assert.match(process.env.CRAFTMINE_EXPECTED_PACKAGE_COMMIT??'',/^[a-f0-9]{40}$/);assert.equal(manifest.commit,process.env.CRAFTMINE_EXPECTED_PACKAGE_COMMIT);
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
  const env=completeEnvironment(process.env,{out:originalRoot,profile,token,core:path.join(resources,'bin/craftmine-core.exe'),host:path.join(resources,'bin/pi-desktop-host-core.exe'),bases:undefined});
  child=spawn(path.join(packaged,'Craftmine World.exe'),[],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});launch.pid=child.pid;const current=launch;
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,current.number+'-'+stream+'.log'),bytes));
  child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')current.exitAudit=message;if(message?.type!=='craftmine-headless')return;const task=pending.get(message.id);if(!task)return;clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error)):task.resolve(message.result);});
  exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Client exited'));}pending.clear();save();resolve();};child.once('error',error=>finish(null,null,error));child.once('exit',(code,signal)=>finish(code,signal));});
}
function rpc(method,payload={},timeout=30000){
 if(method==='worldNavigation'&&payload.channel==='world.create')throw Error('RECOVERY_MUST_NOT_CREATE_WORLD');
 if(method==='worldNavigation'&&payload.channel==='world.creationRetry')assert.deepEqual(payload,{channel:'world.creationRetry',payload:{worldId:originalWorldId}});
 else validateLegacyCall(method,payload);return new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Client is closed'));const id=randomUUID(),record={launch:launch.number,baseId:currentCase.baseId,method,payload,at:new Date().toISOString()};report.calls.push(record);const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},timeout);pending.set(id,{timer,resolve:result=>{record.result=evidence(result);save();resolve(result);},reject:error=>{record.error=String(error);save();reject(error);}});child.send({type:'craftmine-headless',id,method,...payload});});}
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

async function settled(worldId){const row=await until(async()=>{const list=await nav('world.list');const row=list.worlds?.find(w=>w.id===worldId);return row;},row=>{return row?.state==='ready';},'ready world');await until(()=>rpc('godotObserve'),r=>r.worldId===worldId&&r.instanceId,'runtime bound');await until(()=>rpc('worldNavigationReady'),r=>r.worldId===worldId&&r.ready,'navigation ready',90000);return row;}

// This driver has explicit authorization to retry this existing isolated test world.
// Its original report/log/source files are archived and verified unchanged below.
const originalRoot='D:/cm-ga27-legacy-bases-0912/test-results/desktop-native-complete-O5Cj5p';
const originalWorldId='world-fd55cf940cd2';
const originalJobId='gjob-e2cf1872e38556c0fc3ae90add0bedeeb082904357c74225a7395ed25c9866d6';
profile=path.join(originalRoot,'side-view/profile');
const marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'));token=marker.token;
const domain=path.join(profile,'plugins/data/craftmine.world');
const build=path.join(domain,'godot-builds/3f0bb419dec4ec3faea4d887922a9da0c2626239d030b1555e73028d37b3baf2/gbd-8836ede78aff6173d3d0e4721e5599585962f676d32aa8c23fe8c1eab0ce2dbb');
const originalManifest=JSON.parse(fs.readFileSync(path.join(build,'manifest.json'),'utf8'));
assert.equal(originalManifest.manifestHash,'29112926d99d0463a816ea802a7aba6c041c4e9773145332748399b33711f0c5');
const archive=path.join(out,'before-recovery');fs.mkdirSync(archive);
const archived=[];
function preserve(file,name){const bytes=fs.readFileSync(file),target=path.join(archive,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);archived.push({original:file,file:name,bytes:bytes.length,sha256:hash(bytes)});}
for(const name of ['report.json','side-view-failed-jobs.json'])preserve(path.join(originalRoot,name),name);
preserve(path.join(build,'manifest.json'),'manifest.json');
for(const f of originalManifest.files){const file=path.join(build,'source',f.path),bytes=fs.readFileSync(file);assert.equal(hash(bytes),f.sha256);assert.equal(bytes.length,f.bytes);preserve(file,'source/'+f.path);}
for(const taskId of ['im-8da9c139ecd5472c9cfdb320','im-d68fa341115745e8a6cf8314']){
 for(const name of fs.readdirSync(path.join(domain,'godot/tasks',taskId,'logs')))preserve(path.join(domain,'godot/tasks',taskId,'logs',name),'tasks/'+taskId+'/logs/'+name);
}
// Ledger/DB may legitimately change under normal recovery; freeze their old bytes/hash.
preserve(path.join(domain,'godot/executor-ledger.json'),'executor-ledger.json');
const immutable=archived.filter(f=>f.file!=='executor-ledger.json');
function databaseHashes(){return ['tasks.sqlite','tasks.sqlite-wal','tasks.sqlite-shm'].filter(name=>fs.existsSync(path.join(domain,name))).map(name=>{const bytes=fs.readFileSync(path.join(domain,name));return {name,bytes:bytes.length,sha256:hash(bytes)};});}
report.format='craftmine.ruins-existing-world-recovery/1';report.scope='Normal world.creationRetry of the original failed GA27 isolated world; new sealed repair product, original world and source; no model or input';
report.originalRoot=originalRoot;report.originalWorldId=originalWorldId;report.originalJobId=originalJobId;report.databaseBefore=databaseHashes();report.archived=archived;
fs.writeFileSync(path.join(archive,'index.json'),JSON.stringify({archived,database:report.databaseBefore},null,2));
currentCase={baseId:'side-view',starterId:'ruins',worldId:originalWorldId,passed:false};report.cases=[currentCase];report.requestedBases=['side-view'];
console.log('EVIDENCE_DIRECTORY='+out);save();
try{
 start();await step('original profile opens offscreen',started);
 await rpc('primaryMode',{payload:{action:'create'}});
 await until(()=>rpc('worldNavigationReady'),r=>r.ready,'surface ready',90000);
 const before=await nav('world.list');report.beforeWorlds=before;assert.equal(before.worlds.find(w=>w.id===originalWorldId)?.state,'failed');
 const failedJob=await nav('godot.historyJob',{worldId:originalWorldId,jobId:originalJobId});assert.equal(failedJob.status,'failed');report.originalFailedJob=evidence(failedJob);
 await step('select original failed world',()=>nav('world.open',{id:originalWorldId}));
 await until(()=>rpc('worldNavigationReady'),r=>r.worldId===originalWorldId&&r.ready,'failed world selected',90000);
 await step('ordinary creation retry',()=>nav('world.creationRetry',{worldId:originalWorldId}));
 currentCase.initialization=await step('original world recovers to loaded runtime',()=>settled(originalWorldId));
 const observed=await rpc('godotObserve');currentCase.initialObservation=observed;
 const candidates=await panel(originalWorldId,'godot.candidateList');const candidate=candidates.items.find(row=>row.buildId===observed.buildId);assert.ok(candidate);
 const job=await nav('godot.historyJob',{worldId:originalWorldId,jobId:candidate.checkJobId});
 await step('recovery binds unchanged source and real LPAC check',async()=>{assertLegacyCheck('side-view',originalWorldId,observed,candidate,job);assert.equal(job.manifestHash,originalManifest.manifestHash);assert.equal(job.sourceRevision,originalManifest.sourceRevision);return {candidate,job};});
 await step('recovered runtime live pixels',()=>rpc('godotCaptureView'));
 await step('recovered original ruins gameplay',()=>rpc('godotPlayRuins',{},180000));
 await panel(originalWorldId,'godot.runtimeSave',{freeze:true});report.beforeCold=await rpc('godotSnapshot');
 report.beforeColdObservation=await rpc('godotObserve');
 const after=await nav('world.list');assert.deepEqual(after.worlds.map(w=>w.id).sort(),before.worlds.map(w=>w.id).sort());report.afterWorlds=after;
 report.originalJobAfter=await nav('godot.historyJob',{worldId:originalWorldId,jobId:originalJobId});assert.equal(report.originalJobAfter.status,'failed');
 await step('recovery process clean shutdown',stop);
 start();await step('recovered world cold client starts',started);await rpc('primaryMode',{payload:{action:'create'}});await until(()=>rpc('worldNavigationReady'),r=>r.ready,'cold surface ready',90000);await nav('world.open',{id:originalWorldId});await until(()=>rpc('godotObserve'),r=>r.worldId===originalWorldId&&r.instanceId,'cold runtime');report.afterCold=await rpc('godotSnapshot');report.afterColdObservation=await rpc('godotObserve');assert.deepEqual(report.afterCold.state,report.beforeCold.state);assert.notEqual(report.beforeColdObservation.instanceId,report.afterColdObservation.instanceId);assert.equal(report.beforeColdObservation.buildId,report.afterColdObservation.buildId);await step('recovered cold pixels',()=>rpc('godotCaptureView'));await step('recovered cold client clean shutdown',stop);
 await step('original failure logs reports and source remain byte exact',async()=>{for(const file of immutable)assert.equal(hash(fs.readFileSync(file.original)),file.sha256,file.original);return {files:immutable.length};});
 currentCase.passed=true;
}catch(error){currentCase.failure=String(error.stack??error);console.error(currentCase.failure);process.exitCode=1;}
finally{try{await stop();}catch(error){currentCase.shutdownFailure=String(error);currentCase.passed=false;process.exitCode=1;}clearInterval(cancelPoll);report.databaseAfter=databaseHashes();report.finishedAt=new Date().toISOString();report.packageUnchanged=hash(JSON.stringify(creationPackageInventory(packaged)))===inventorySha256;report.passed=currentCase.passed&&report.packageUnchanged;save();console.log('EVIDENCE_DIRECTORY='+out);}
