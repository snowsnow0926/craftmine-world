// Product IPC only, independent offscreen Electron process and private profile.
// No model calls, input simulation, pointer lock, or personal browser access.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {compareGodotPersistentProgress,godotPersistentProgress} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-godot-bases-acceptance.ts';

const root=path.resolve(import.meta.dirname,'../..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const packaged=process.env.CRAFTMINE_PACKAGED_ROOT?path.resolve(process.env.CRAFTMINE_PACKAGED_ROOT):null;
const resources=packaged?path.join(packaged,'resources'):null;
function readApp(relative){
  if(!packaged)return fs.readFileSync(path.join(desktop,relative));
  const builder=createRequire(require.resolve('electron-builder')),lib=createRequire(builder.resolve('app-builder-lib'));
  return lib('@electron/asar').extractFile(path.join(resources,'app.asar'),path.normalize(relative));
}
const compiled=readApp('out/main/index.js').toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance','Headless window was not created offscreen'])assert.ok(compiled.includes(guard),'Build lacks input isolation: '+guard);
assert.ok(readApp('out/preload/craftmine-headless.cjs').includes(Buffer.from('requestPointerLock')));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/desktop-native-complete-')),profile=path.join(out,'profile'),token=randomUUID();
const legacySource=path.join(out,'legacy');fs.mkdirSync(profile);fs.mkdirSync(legacySource);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const report={format:'craftmine.complete-client-acceptance/1',startedAt:new Date().toISOString(),packaged,out,steps:[],launches:[],calls:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
let images=0;
function evidence(value){
  if(Array.isArray(value))return value.map(evidence);
  if(value&&typeof value==='object'){
    const result={};for(const [key,item]of Object.entries(value)){
      if(key==='pngBase64'){
        const bytes=Buffer.from(item,'base64'),file=`capture-${++images}.png`;fs.writeFileSync(path.join(out,file),bytes);
        result.image={file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
      }else result[key]=evidence(item);
    }return result;
  }return value;
}
let child,ready=false,ended=true,exit=Promise.resolve(),launch;
const pending=new Map();
function start(){
  assert.ok(ended);ready=false;ended=false;launch={number:report.launches.length+1,startedAt:new Date().toISOString()};report.launches.push(launch);
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,
    CRAFTMINE_CORE_BIN:resources?path.join(resources,'bin/craftmine-core.exe'):path.join(root,'vendor/pi-desktop/target/release/craftmine-core.exe'),
    PI_DESKTOP_HOST_BIN:resources?path.join(resources,'bin/pi-desktop-host-core.exe'):path.join(root,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe')};
  delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(packaged?path.join(packaged,'Craftmine World.exe'):require('electron'),packaged?[]:[desktop],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const current=launch,number=current.number;
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,`${number}-${stream}.log`),bytes));
  child.on('message',message=>{
    if(message?.type==='craftmine-headless-ready')ready=true;
    if(message?.type==='craftmine-headless-exit')current.exitAudit=message;
    if(message?.type!=='craftmine-headless')return;
    const task=pending.get(message.id);if(!task)return;clearTimeout(task.timer);pending.delete(message.id);
    message.error?task.reject(Error(message.error)):task.resolve(message.result);
  });
  exit=new Promise(resolve=>{
    const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};resolve();for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Electron exited'));}pending.clear();save();};
    child.once('error',error=>finish(null,null,error));child.once('exit',(code,signal)=>finish(code,signal));
  });
}
const rpc=(method,payload={},timeout=30000)=>new Promise((resolve,reject)=>{
  if(ended||!child.connected)return reject(Error('Electron exited'));
  const id=randomUUID(),record={launch:launch.number,method,payload,at:new Date().toISOString()};report.calls.push(record);
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},timeout);
  pending.set(id,{timer,resolve:value=>{record.result=evidence(value);save();resolve(value);},reject:error=>{record.error=String(error);save();reject(error);}});
  child.send({type:'craftmine-headless',id,method,...payload});
});
const until=async(fn,predicate,label,timeout=90000)=>{const deadline=Date.now()+timeout;let value,error;while(Date.now()<deadline){if(ended)throw Error('Electron exited');try{value=await fn();if(predicate(value))return value;}catch(e){if(e.fatal)throw e;error=String(e);}await delay(500);}throw Error(`${label}: ${JSON.stringify(value)} ${error??''}`);};
const step=async(name,fn)=>{const begin=Date.now();try{const result=await fn();report.steps.push({name,passed:true,ms:Date.now()-begin,result:evidence(result)});console.log('PASS '+name);save();return result;}catch(error){report.steps.push({name,passed:false,ms:Date.now()-begin,error:String(error)});save();throw error;}};
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload},180000);
const panel=(worldId,channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}},180000);
async function stop(){if(ended)return;try{await rpc('quit',{},5000);}catch{}await Promise.race([exit,delay(10000)]);if(!ended){launch.forcedStop=true;child.kill();}await exit;}
async function settled(worldId){const row=await until(async()=>{const list=await nav('world.list'),row=list.worlds.find(item=>item.id===worldId);if(row?.state==='failed')throw Object.assign(Error(JSON.stringify(row.creation)),{fatal:true});return row;},row=>row?.state==='ready','World initialization',900000);await until(()=>rpc('godotObserve'),value=>value?.worldId===worldId&&value?.instanceId,'Formal runtime promotion');await until(()=>rpc('worldNavigationReady'),value=>value?.ready&&value.worldId===worldId,'Actual navigation controls enabled');return row;}
async function started(){await until(()=>ready,Boolean,'Controller');await until(()=>rpc('status'),value=>value.windows.length>0,'Main window');const status=await rpc('status');assert.equal(status.violations.length,0);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await until(()=>nav('world.createOptions'),v=>v.bases?.some(b=>b.id==='first-person'),'Catalog');const list=await nav('world.list');if(list.worlds.find(w=>w.id===list.activeWorldId)?.runtimeKind==='godot')await settled(list.activeWorldId);return status;}
async function capture(baseId){const result=await rpc('godotCaptureView');assert.equal(result.width,1280);assert.equal(result.height,720);assert.ok(result.pixelStats.sampledColors>4,'Blank or single-color runtime');assert.equal(result.viewportObservation.baseId,baseId);return result;}
const worlds=[];
try{
  start();await step('isolated client starts with installed product catalog',started);
  for(const baseId of process.env.CRAFTMINE_TEST_BASES?.split(',')??['first-person','top-down','side-view','mining-sandbox']){
    const starterId={'first-person':'training-range','top-down':'town','side-view':'ruins','mining-sandbox':'mine-camp'}[baseId];
    const world=await step(`create ${baseId} ${starterId}`,()=>nav('world.create',{baseId,starterId,title:`Acceptance ${baseId}`,operationId:randomUUID()}));world.baseId=baseId;worlds.push(world);
    await step(`real build, check and first application ${baseId}`,()=>settled(world.id));
    await step(`actual game pixels ${baseId}`,()=>capture(baseId));
    if(worlds.length===1)await step('capture the actual client layout',async()=>{const size=await rpc('capture',{name:'complete-client-layout'});const bytes=fs.readFileSync(path.join(out,'complete-client-layout.png'));assert.ok(bytes.length>1000);return {...size,file:'complete-client-layout.png',sha256:createHash('sha256').update(bytes).digest('hex')};});
    if(baseId==='first-person')await step('actual equipment switches and camera movement',()=>rpc('godotPlay',{},60000));
    else await step(`actual ${baseId} gameplay progression`,async()=>{const result=await rpc({'top-down':'godotPlayTown','side-view':'godotPlayRuins','mining-sandbox':'godotPlayMine'}[baseId],{},240000);assert.equal(result.ok,true,result.error);return result;});
    await step(`save ${baseId}`,()=>panel(world.id,'godot.runtimeSave',{freeze:true}));
    world.observation=await rpc('godotObserve');
    world.snapshot=await rpc('godotSnapshot');
  }
  const last=worlds.at(-1);
  await step('orderly shutdown saves current play state',async()=>{await stop();assert.equal(launch.exit.code,0);assert.ok(!launch.forcedStop);return launch;});
  start();await step('restart from the same private profile',started);
  for(const world of worlds){
    await step(`reopen saved ${world.baseId}`,async()=>{await nav('world.open',{id:world.id});await settled(world.id);const actual=await rpc('godotObserve');assert.equal(actual.worldId,world.id);assert.equal(actual.buildId,world.observation.buildId);const comparison=compareGodotPersistentProgress(world.snapshot,await rpc('godotSnapshot'));assert.equal(comparison.equal,true,JSON.stringify(comparison.differences));await capture(world.baseId);return {actual,comparison};});
  }
  if(process.env.CRAFTMINE_TEST_REUSE==='1'){
    const source=worlds.find(w=>w.baseId==='first-person');assert.ok(source);
    await nav('world.open',{id:source.id});
    const listed=await step('list actual source components',()=>panel(source.id,'package.request',{method:'sourceList',params:{worldId:source.id}}));
    const item=listed.items.find(item=>item.supported);assert.ok(item,'No reusable source entity');
    await step('export selected entity through native file grant',()=>panel(source.id,'package.request',{method:'exportSource',params:{worldId:source.id,revision:listed.revision,manifestHash:listed.manifestHash,nodePath:item.nodePath,assetId:'accepted-component',version:1}}));
    const target=await nav('world.create',{baseId:'first-person',starterId:'training-range',title:'Reuse target',operationId:randomUUID()});await settled(target.id);
    await step('play the reuse target before adding content',()=>rpc('godotPlay',{},60000));
    await panel(target.id,'godot.runtimeSave',{freeze:true});
    const checkTimeSnapshot=godotPersistentProgress(await rpc('godotSnapshot'));
    const imported=await step('install into a different world draft',()=>panel(target.id,'package.request',{method:'importSource',params:{worldId:target.id,operationId:randomUUID()}}));
    assert.ok(imported.grantId);assert.equal(imported.applied,false);
    await step('native package status projects the actual pending job',async()=>{const result=await panel(target.id,'package.request',{method:'sourceJob',params:{worldId:target.id,jobId:imported.job.id}});assert.deepEqual(Object.keys(result).sort(),['jobId','status','terminal','worldId']);assert.equal(result.worldId,target.id);assert.equal(result.jobId,imported.job.id);assert.equal(typeof result.terminal,'boolean');return result;});
    await step('first import check reaches its actual terminal state',()=>until(()=>nav('godot.historyJob',{worldId:target.id,jobId:imported.job.id}),job=>{if(['failed','blocked','cancelled','interrupted'].includes(job.status))throw Object.assign(Error(JSON.stringify(job)),{fatal:true});return job.status==='passed';},'First component check',900000));
    await step('native package status confirms completion before another install',async()=>{const result=await panel(target.id,'package.request',{method:'sourceJob',params:{worldId:target.id,jobId:imported.job.id}});assert.equal(result.status,'passed');assert.equal(result.terminal,true);return result;});
    const second=await step('install a second independent instance',()=>panel(target.id,'package.request',{method:'repeatImportSource',params:{worldId:target.id,operationId:randomUUID(),grantId:imported.grantId}}));
    assert.ok(imported.instanceIds.every(id=>!second.instanceIds.includes(id)));
    const checked=await step('real check of both installed instances',()=>until(()=>nav('godot.historyJob',{worldId:target.id,jobId:second.job.id}),job=>{if(['failed','blocked','cancelled','interrupted'].includes(job.status))throw Object.assign(Error(JSON.stringify(job)),{fatal:true});return job.status==='passed';},'Component check',900000));
    await step('advance real player progress after the candidate was checked',()=>rpc('godotAdvance',{},60000));
    await panel(target.id,'godot.runtimeSave',{freeze:true});
    const beforeApply=godotPersistentProgress(await rpc('godotSnapshot'));
    assert.notEqual(beforeApply.body.player.yaw,checkTimeSnapshot.body.player.yaw);
    assert.notEqual(beforeApply.body.equipment.active,checkTimeSnapshot.body.equipment.active);
    await step('preview and apply checked reused content',async()=>{await panel(target.id,'godot.candidatePreview',{candidateId:checked.candidateId});return panel(target.id,'godot.candidateApply',{candidateId:checked.candidateId});});
    const appliedSnapshot=await step('both new instances exist and every old native field is preserved',async()=>{
      const actual=godotPersistentProgress(await rpc('godotSnapshot')),projected=structuredClone(actual);let added=0;
      for(const key of ['targets','interactables']){const original=beforeApply.body[key],entries=actual.body[key];assert.equal(new Set(entries.map(entry=>entry.id)).size,entries.length);for(const entry of original)assert.deepEqual(entries.find(next=>next.id===entry.id),entry);added+=entries.length-original.length;projected.body[key]=original;}
      assert.equal(added,2);assert.deepEqual(projected,beforeApply);await capture('first-person');return actual;
    });
    await panel(target.id,'godot.runtimeSave',{freeze:true});
    await step('restart preserves the applied reusable content and complete progress',async()=>{await stop();start();await started();await settled(target.id);const compared=compareGodotPersistentProgress(appliedSnapshot,await rpc('godotSnapshot'));assert.equal(compared.equal,true,JSON.stringify(compared.differences));await capture('first-person');return compared;});
  }
  if(process.env.CRAFTMINE_TEST_COPY==='1'){
    for(const source of worlds){
      await nav('world.open',{id:source.id});await settled(source.id);
      await panel(source.id,'godot.runtimeSave',{freeze:true});
      const original=await rpc('godotSnapshot');
      const result=await step(`copy ${source.baseId} into its own checked runtime`,()=>nav('world.copy',{worldId:source.id,operationId:randomUUID(),title:`Copy ${source.baseId}`}));
      assert.equal(result.status,'ready');assert.notEqual(result.targetWorldId,source.id);await settled(result.targetWorldId);
      const copy=await rpc('godotSnapshot'),expected=godotPersistentProgress(original);
      expected.worldId=result.targetWorldId;expected.body.worldId=result.targetWorldId;
      if(expected.baseId==='mining-sandbox')expected.body.state.worldId=result.targetWorldId;
      const comparison=compareGodotPersistentProgress(expected,copy);assert.equal(comparison.equal,true,JSON.stringify(comparison.differences));
      await capture(source.baseId);
      await step(`restart independent ${source.baseId} copy`,async()=>{await stop();start();await started();const persisted=await rpc('godotSnapshot');const compared=compareGodotPersistentProgress(copy,persisted);assert.equal(compared.equal,true,JSON.stringify(compared.differences));return compared;});
    }
  }
  if(process.env.CRAFTMINE_TEST_BACKUP==='1'){
    const selected=(await nav('world.list')).activeWorldId;
    await panel(selected,'godot.runtimeSave',{freeze:true});
    const saved=await rpc('godotObserve');
    const beforeBackup=await rpc('godotSnapshot');
    await step('export full portable source and progress archive',()=>panel(selected,'backup.export',{operationId:randomUUID()}));
    const inspected=await step('inspect portable archive bodies and current state',()=>panel(selected,'backup.inspect'));
    const restored=await step('activate portable archive and rebuild formal world',()=>panel(selected,'backup.restore',{operationId:randomUUID(),grantId:inspected.grantId,expectedCurrentHash:inspected.expectedCurrentHash}));
    assert.equal(restored.activated,true);assert.equal(restored.modelReplay,false);
    const observed=await rpc('godotObserve');assert.equal(observed.worldId,saved.worldId);
    await step('restored progress matches every saved native field',async()=>{const result=compareGodotPersistentProgress(beforeBackup,await rpc('godotSnapshot'));assert.equal(result.equal,true,JSON.stringify(result.differences));return result;});
    await capture(observed.baseId);
    await step('restart restored data-root pointer',async()=>{await stop();start();await started();await nav('world.open',{id:observed.worldId});await settled(observed.worldId);const fresh=await rpc('godotObserve');assert.equal(fresh.worldId,observed.worldId);assert.equal(fresh.buildId,observed.buildId);const comparison=compareGodotPersistentProgress(beforeBackup,await rpc('godotSnapshot'));assert.equal(comparison.equal,true,JSON.stringify(comparison.differences));return {capture:await capture(fresh.baseId),comparison};});
  }
  await step('no foreground windows or input-policy violations',async()=>{const status=await rpc('status');assert.equal(status.violations.length,0);assert.ok(status.windows.length>0&&status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));return status;});
}catch(error){report.fatal=String(error?.stack??error);process.exitCode=1;console.error(report.fatal);}
finally{await stop();report.finishedAt=new Date().toISOString();save();console.log('Evidence: '+out);}
