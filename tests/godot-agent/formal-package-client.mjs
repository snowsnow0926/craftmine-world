// Sealed product only: ordinary package.request -> managed executor check ->
// candidate preview/apply -> full process restart, in a protected profile.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {createCompleteOutput,completeEnvironment} from '../godot-final/complete-contract.mjs';
import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
import {assertFormalPackageCheck,assertFormalAdoption,assertFormalCold} from './formal-package-contract.mjs';
import {seedCatalogArchives,assertCatalogSourceBinding} from './formal-catalog-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const packaged=process.env.CRAFTMINE_PACKAGED_ROOT;
const sourceMode=process.env.CRAFTMINE_SOURCE_PACKAGE_MODE??'file';
assert.ok(['file','catalog'].includes(sourceMode),'Unknown source package mode');
if(sourceMode==='catalog')assert.ok(process.env.CRAFTMINE_EXPECTED_PACKAGE_COMMIT,'Catalog trial requires an explicit new package commit');
if(!packaged||!path.isAbsolute(packaged))throw Error('Exact sealed CRAFTMINE_PACKAGED_ROOT required');
const resources=path.join(packaged,'resources'),manifestFile=path.join(resources,'source/build-manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
assert.equal(manifest.format,'craftmine.build/1');assert.equal(manifest.appId,'world.craftmine.desktop');
assert.equal(manifest.commit,process.env.CRAFTMINE_EXPECTED_PACKAGE_COMMIT||'2ae18b25a7cf88e2cf810082a84c17c09092ce3d');
const dependencies=process.env.CRAFTMINE_DESKTOP_DEPS_ROOT||'D:/cm-agent-godot-0912/vendor/pi-desktop/apps/desktop';
const require=createRequire(path.join(dependencies,'package.json')),builder=createRequire(require.resolve('electron-builder')),lib=createRequire(builder.resolve('app-builder-lib'));
const asar=lib('@electron/asar');
const main=asar.extractFile(path.join(resources,'app.asar'),path.normalize('out/main/index.js')).toString('utf8');
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance','Headless window was not created offscreen'])assert.ok(main.includes(guard),'Sealed build lacks guard: '+guard);
assert.ok(asar.extractFile(path.join(resources,'app.asar'),path.normalize('out/preload/craftmine-headless.cjs')).includes(Buffer.from('requestPointerLock')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=createCompleteOutput(root),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacySource);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const report={format:'craftmine.formal-package-client/1',out,packaged,commit:manifest.commit,manifestSha256:hash(fs.readFileSync(manifestFile)),startedAt:new Date().toISOString(),launches:[],steps:[],calls:[],packages:[],
  scope:'Model-free protected ordinary source-package import/check/candidate/apply/restart',notVerified:['Player-model authorship','Module parameter progress persistence','Player controls and gameplay','Second formal world']};
report.sourceMode=sourceMode;
if(sourceMode==='catalog')report.notVerified.push('Initial catalog input is an explicit core fixture, not an ordinary asset UI import');
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));let imageCount=0;
function evidence(value){if(Array.isArray(value))return value.map(evidence);if(value&&typeof value==='object'){const result={};for(const [key,item]of Object.entries(value)){if(key==='pngBase64'){const bytes=Buffer.from(item,'base64'),file='capture-'+(++imageCount)+'.png';fs.writeFileSync(path.join(out,file),bytes);result.image={file,sha256:hash(bytes),bytes:bytes.length};}else result[key]=evidence(item);}return result;}return value;}
let child,ready=false,ended=true,exit=Promise.resolve(),launch,stopping=false;const pending=new Map();
function start(){
  assert.ok(ended);ready=false;ended=false;launch={number:report.launches.length+1};report.launches.push(launch);
  const env=completeEnvironment(process.env,{out,profile,token,core:path.join(resources,'bin/craftmine-core.exe'),host:path.join(resources,'bin/pi-desktop-host-core.exe'),bases:path.join(resources,'godot')});
  child=spawn(path.join(packaged,'Craftmine World.exe'),[],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});launch.pid=child.pid;const current=launch;
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,current.number+'-'+stream+'.log'),bytes));
  child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')current.exitAudit=message;if(message?.type!=='craftmine-headless')return;const task=pending.get(message.id);if(!task)return;clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error)):task.resolve(message.result);});
  exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Client exited'));}pending.clear();save();resolve();};child.once('error',error=>finish(null,null,error));child.once('exit',(code,signal)=>finish(code,signal));});
}
function rpc(method,payload={},timeout=30000){return new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Client is closed'));const id=randomUUID(),record={launch:launch.number,method,payload,at:new Date().toISOString()};report.calls.push(record);const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},timeout);pending.set(id,{timer,resolve:result=>{record.result=evidence(result);save();resolve(result);},reject:error=>{record.error=String(error);save();reject(error);}});child.send({type:'craftmine-headless',id,method,...payload});});}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload},180000);
const panel=(worldId,channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}},180000);
const packageCall=(worldId,method,params={})=>panel(worldId,'package.request',{method,params:{worldId,...params}});
async function until(read,predicate,label,timeout=900000){const deadline=Date.now()+timeout;let last,lastError;while(Date.now()<deadline){if(stopping||ended)throw Error('TRIAL_STOPPED');try{last=await read();}catch(error){lastError=String(error);await delay(1000);continue;}if(predicate(last))return last;await delay(1000);}throw Error(label+': '+JSON.stringify(last)+' '+(lastError||''));}
async function step(name,body){try{const value=await body();report.steps.push({name,passed:true,result:evidence(value)});save();console.log('PASS '+name);return value;}catch(error){report.steps.push({name,passed:false,error:String(error)});save();throw error;}}
async function stop(){if(!launch)return;if(!ended){try{await rpc('quit',{},5000);}catch{}await Promise.race([exit,delay(12000)]);if(!ended){launch.forcedStop=true;child.kill();await exit;}}assertCleanHeadlessShutdown({...launch,audit:launch.exitAudit});}
function requestStop(reason){
  if(stopping)return;stopping=true;report.cancelled={reason,at:new Date().toISOString()};
  for(const [id,task]of pending){clearTimeout(task.timer);pending.delete(id);task.reject(Error('TRIAL_CANCELLED'));}
  save();if(!ended)void rpc('quit',{},5000).catch(()=>{});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>requestStop(signal));
const cancelPoll=setInterval(()=>{if(fs.existsSync(path.join(out,'cancel.request')))requestStop('cancel.request');},250);cancelPoll.unref();
async function started(){await until(async()=>ready,Boolean,'headless control ready',90000);const status=await until(()=>rpc('status'),r=>r.windows.length>0,'offscreen main window',90000);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));assert.deepEqual(status.violations,[]);await until(()=>nav('world.createOptions'),r=>r.bases?.some(b=>b.id==='creation-sandbox'),'catalog',90000);return status;}
async function settled(worldId){await until(async()=>{const list=await nav('world.list');const row=list.worlds?.find(w=>w.id===worldId);if(row?.state==='failed')throw Error('World initialization failed: '+JSON.stringify(row));return row;},row=>row?.state==='ready','ready world');await until(()=>rpc('godotObserve'),r=>r.worldId===worldId&&r.instanceId,'runtime bound');await until(()=>rpc('worldNavigationReady'),r=>r.worldId===worldId&&r.ready,'navigation ready',90000);}
async function terminal(worldId,jobId){return until(()=>nav('godot.historyJob',{worldId,jobId}),job=>{if(['blocked','failed','cancelled','interrupted'].includes(job.status))throw Error('Actual package check not passed: '+JSON.stringify(job));return job.status==='passed';},'package check');}
function ids(list){return list.items.map(item=>item.entityId).sort();}
console.log('EVIDENCE_DIRECTORY='+out);save();
try{
  if(sourceMode==='catalog')report.catalogFixture=await step('explicit catalog fixture import and original test download removal',()=>seedCatalogArchives({root,out,profile,binary:path.join(resources,'bin/craftmine-core.exe'),assertActive:()=>{if(stopping)throw Error('TRIAL_CANCELLED');}}));
  start();await step('sealed client starts offscreen in protected fresh profile',started);
  await step('ordinary create mode opens product surface',()=>rpc('primaryMode',{payload:{action:'create'}}));
  const world=await step('ordinary creation-sandbox world creation',()=>nav('world.create',{title:'GU6 formal package adoption',baseId:'creation-sandbox',starterId:'blank',operationId:randomUUID()}));report.worldId=world.id;
  await step('initial world real build/check/apply settles',()=>settled(world.id));
  report.initialObservation=await rpc('godotObserve');report.initialSnapshot=await rpc('godotSnapshot');save();
  const expectedIds=[];let lastBuild=report.initialObservation.buildId;
  for(const kind of ['building','road']){
    const bytes=fs.readFileSync(path.join(root,'docs/evidence/gu6-kenney-modules-20260912',kind+'.zip'));
    if(sourceMode==='file')fs.writeFileSync(path.join(out,'component.zip'),bytes);
    const catalog=report.catalogFixture?.records.find(r=>r.kind===kind),operationId=randomUUID();
    const imported=await step(kind+' ordinary native '+(catalog?'importCatalogSource':'importSource'),()=>packageCall(world.id,catalog?'importCatalogSource':'importSource',{operationId,...(catalog?{ref:catalog.ref}:{})}));
    if(catalog)assertCatalogSourceBinding(catalog,imported);
    assert.equal(imported.status,'check-queued');assert.equal(imported.applied,false);assert.equal(imported.archiveSha256,hash(bytes));expectedIds.push(...imported.instanceIds.map(id=>id+'-e0'));
    const checked=await step(kind+' actual executor job check passed',()=>terminal(world.id,imported.job.id));assertFormalPackageCheck(world.id,imported,checked);
    const native=await packageCall(world.id,'sourceJob',{jobId:imported.job.id});assert.equal(native.status,'passed');assert.equal(native.terminal,true);
    const before=await rpc('godotObserve');assert.equal(before.buildId,lastBuild,'import/check must not be mislabeled as formal adoption');
    await panel(world.id,'godot.runtimeSave',{freeze:true});
    const preview=await step(kind+' checked candidate preview',()=>panel(world.id,'godot.candidatePreview',{candidateId:checked.candidateId}));
    const applied=await step(kind+' ordinary candidateApply',()=>panel(world.id,'godot.candidateApply',{candidateId:checked.candidateId}));
    const observed=await until(()=>rpc('godotObserve'),r=>r.worldId===world.id&&r.buildId===preview.buildId,'adopted runtime');assert.notEqual(observed.buildId,lastBuild);lastBuild=observed.buildId;
    assertFormalAdoption(world.id,checked,preview,applied,observed);
    const listed=await step(kind+' adopted source identities',()=>packageCall(world.id,'sourceList'));for(const id of expectedIds)assert.ok(ids(listed).includes(id));
    const capture=await step(kind+' formal runtime pixels',()=>rpc('godotCaptureView'));assert.ok(capture.pixelStats.sampledColors>4);
    report.packages.push({kind,archiveSha256:hash(bytes),imported,checked:evidence(checked),preview,adoptedBuildId:lastBuild,identities:ids(listed),...(catalog?{catalogRef:catalog.ref,operationId}:{})});save();
  }
  await panel(world.id,'godot.runtimeSave',{freeze:true});const beforeCold={observation:await rpc('godotObserve'),snapshot:await rpc('godotSnapshot'),sources:await packageCall(world.id,'sourceList')};report.beforeCold=evidence(beforeCold);save();
  await step('first process shuts down cleanly',stop);start();await step('same sealed build cold reopens protected profile',started);
  await step('ordinary create mode after cold launch',()=>rpc('primaryMode',{payload:{action:'create'}}));
  await step('ordinary world.open after cold launch',()=>nav('world.open',{id:world.id}));await settled(world.id);
  const afterCold=await step('adopted package source and build survive cold restart',async()=>{const observed=await rpc('godotObserve'),sources=await packageCall(world.id,'sourceList');assert.equal(observed.worldId,world.id);assert.equal(observed.buildId,beforeCold.observation.buildId);assert.deepEqual(ids(sources),ids(beforeCold.sources));return {observed,sources,snapshot:await rpc('godotSnapshot')};});report.afterCold=evidence(afterCold);
  assertFormalCold(beforeCold,afterCold);
  if(sourceMode==='catalog'){
    for(const entry of report.packages)await step(entry.kind+' same catalog operation survives service restart',async()=>{
      const replay=await packageCall(world.id,'importCatalogSource',{operationId:entry.operationId,ref:entry.catalogRef});assert.deepEqual(replay,entry.imported);
      const sources=await packageCall(world.id,'sourceList');assert.deepEqual(sources,afterCold.sources);
      const observed=await rpc('godotObserve');assert.equal(observed.buildId,afterCold.observed.buildId);return {replay,sources};
    });
  }
  await step('cold reopened formal runtime pixels',()=>rpc('godotCaptureView'));const status=await rpc('status');assert.deepEqual(status.violations,[]);assert.deepEqual(status.pageErrors,[]);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
}catch(error){report.failure=String(error.stack??error);process.exitCode=1;console.error(report.failure);}
finally{try{await stop();}catch(error){report.shutdownFailure=String(error.stack??error);process.exitCode=1;}clearInterval(cancelPoll);report.passed=!stopping&&!report.failure&&!report.shutdownFailure&&report.steps.every(s=>s.passed);report.finishedAt=new Date().toISOString();save();console.log('EVIDENCE_DIRECTORY='+out);}
