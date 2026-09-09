// Actual offscreen product IPC against an explicitly owned failed-run profile.
// Requires a pre-frozen app/core/toolchain; never rebuilds or edits product code.
// Usage: node tests/godot-final/client-recovery-faults.mjs <frozen-run> <failed-run>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const root=path.resolve(import.meta.dirname,'../..');
const run=path.resolve(process.argv[2]??''),failedRun=path.resolve(process.argv[3]??'');
for(const directory of [run,failedRun]){
  assert.equal(path.dirname(directory),path.join(root,'test-results'));
  assert.ok(path.basename(directory).startsWith('desktop-native-'));
  assert.ok(!fs.lstatSync(directory).isSymbolicLink());
}
const frozen=JSON.parse(fs.readFileSync(path.join(run,'frozen-info.json'),'utf8'));
const profile=path.join(failedRun,'profile');
const marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'));
assert.equal(marker.format,'craftmine.headless-profile/1');
const originalReportBytes=fs.readFileSync(path.join(failedRun,'report.json'));
const original=JSON.parse(originalReportBytes);
const lostReply=original.calls.findLast(call=>call.payload?.channel==='backup.restore'&&/INVALID_OPERATION_RECEIPT/.test(call.error??''));
assert.ok(lostReply,'Profile must carry actual committed-activation/lost-receipt evidence');
const pointerFile=path.join(profile,'plugins/data/craftmine.world/.craftmine-active-data.json');
const pointerBefore=fs.readFileSync(pointerFile);
const pointer=JSON.parse(pointerBefore);
assert.equal(pointer.operationId,lostReply.payload.payload.operationId);
assert.equal(pointer.format,'craftmine.restored-data/1');
const restoredRoot=path.resolve(path.dirname(pointerFile),pointer.relativeDirectory);
assert.ok(restoredRoot.startsWith(path.resolve(profile)+path.sep));
assert.ok(fs.existsSync(path.join(restoredRoot,'tasks.sqlite')));
const expected=new Map();
for(const call of original.calls)if(call.method==='godotSnapshot'&&call.result?.state?.worldId)expected.set(call.result.state.worldId,call.result);
assert.ok(expected.size>=2,'Expected original full native progress evidence');
const expectedActive=lostReply.payload.payload.worldId;
const originalArchive=path.join(failedRun,'portable-backup.craftmine');
assert.ok(fs.existsSync(originalArchive));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const archiveHash=sha(fs.readFileSync(originalArchive));
assert.equal(sha(fs.readFileSync(path.join(frozen.app,'out/main/index.js'))),frozen.sourceMainSha256);
for(const item of frozen.files){
  const full=path.join(frozen.frozen,...item.path.split('/'));
  assert.equal(sha(fs.readFileSync(full)),item.sha256,'Frozen product file changed: '+item.path);
}
const compiled=fs.readFileSync(path.join(frozen.app,'out/main/index.js'),'utf8');
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance'])assert.ok(compiled.includes(guard));
assert.ok(fs.readFileSync(path.join(frozen.app,'out/preload/craftmine-headless.cjs')).includes(Buffer.from('requestPointerLock')));
const evidenceDir=fs.mkdtempSync(path.join(run,'fault-evidence-'));
fs.writeFileSync(path.join(evidenceDir,'original-failed-report.json'),originalReportBytes);
fs.writeFileSync(path.join(evidenceDir,'activation-before.json'),pointerBefore);
const report={format:'craftmine.actual-recovery-faults/1',startedAt:new Date().toISOString(),evidenceDir,failedRun,profile,
  frozenManifest:path.join(run,'frozen-info.json'),originalReportSha256:sha(originalReportBytes),pointer,archiveHash,
  expectedActive,steps:[],calls:[],launches:[],limits:['Actual product source-built frozen client, not a release installer','Prior activation receipt failure is genuine historical evidence; it is not reinjected','No model, OS input, focus, pointer lock, snapshot assignment or successful restore replay']};
const persist=()=>fs.writeFileSync(path.join(evidenceDir,'report.json'),JSON.stringify(report,null,2));
let images=0;
function evidence(value){
 if(Array.isArray(value))return value.map(evidence);
 if(value&&typeof value==='object'){
  const result={};for(const[key,item]of Object.entries(value)){
   if(key==='pngBase64'){const bytes=Buffer.from(item,'base64'),file='capture-'+(++images)+'.png';fs.writeFileSync(path.join(evidenceDir,file),bytes);result.image={file,bytes:bytes.length,sha256:sha(bytes)};}
   else result[key]=evidence(item);
  }return result;
 }return value;
}
const require=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'));
let child,ready=false,ended=true,exited=Promise.resolve(),launch;
const pending=new Map();
function start(){
 assert.ok(ended);ended=false;ready=false;launch={number:report.launches.length+1,at:new Date().toISOString()};report.launches.push(launch);
 const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:failedRun,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token,
  CRAFTMINE_CORE_BIN:path.join(frozen.frozen,'bin/craftmine-core.exe'),PI_DESKTOP_HOST_BIN:path.join(frozen.frozen,'bin/pi-desktop-host-core.exe'),
  CRAFTMINE_GODOT_BASES:path.join(frozen.frozen,'desktop/godot')};
 delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 child=spawn(require('electron'),[frozen.app],{cwd:frozen.frozen,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 const current=launch;
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(evidenceDir,current.number+'-'+stream+'.log'),bytes));
 child.on('message',message=>{
  if(message?.type==='craftmine-headless-ready')ready=true;
  if(message?.type==='craftmine-headless-exit')current.exitAudit=message;
  if(message?.type!=='craftmine-headless')return;
  const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);
  message.error?task.reject(Error(message.error)):task.resolve(message.result);
 });
 exited=new Promise(resolve=>{
  const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Electron exited'));}pending.clear();persist();resolve();};
  child.once('error',error=>finish(null,null,error));child.once('exit',(code,signal)=>finish(code,signal));
 });
}
const rpc=(method,payload={},timeout=30000)=>new Promise((resolve,reject)=>{
 if(ended||!child.connected)return reject(Error('Electron exited'));
 const id=randomUUID(),entry={launch:launch.number,method,payload,at:new Date().toISOString()};report.calls.push(entry);
 const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},timeout);
 pending.set(id,{timer,resolve:value=>{entry.result=evidence(value);persist();resolve(value);},reject:error=>{entry.error=String(error);persist();reject(error);}});
 child.send({type:'craftmine-headless',id,method,...payload});
});
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload},180000);
const panel=(worldId,channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}},180000);
async function until(fn,predicate,label,timeout=120000){
 const end=Date.now()+timeout;let last,error;
 while(Date.now()<end){if(ended)throw Error('Electron exited during '+label);try{last=await fn();if(predicate(last))return last;}catch(e){if(e.fatal)throw e;error=String(e);}await delay(500);}
 throw Error(label+': '+JSON.stringify(last)+' '+(error??''));
}
const step=async(name,fn)=>{
 try{const result=await fn();report.steps.push({name,passed:true,result:evidence(result)});persist();console.log('PASS '+name);return result;}
 catch(error){report.steps.push({name,passed:false,error:String(error)});persist();throw error;}
};
async function settled(worldId){
 await until(async()=>{const list=await nav('world.list');const row=list.worlds.find(w=>w.id===worldId);if(row?.state==='failed')throw Object.assign(Error(JSON.stringify(row.creation)),{fatal:true});return row;},row=>row?.state==='ready','Real initialized world',900000);
 await until(()=>rpc('godotObserve'),value=>value?.worldId===worldId&&value.instanceId,'Actual runtime');
 await until(()=>rpc('worldNavigationReady'),value=>value?.ready&&value.worldId===worldId,'Unfrozen navigation');
}
async function boot(){
 await until(()=>ready,Boolean,'Headless controller');
 const status=await until(()=>rpc('status'),value=>value.windows.length>0,'Offscreen window');
 assert.equal(status.violations.length,0);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
 return status;
}
const state=value=>value?.format==='craftmine.godot-progress/1'?value:value?.state??value?.snapshot?.state;
async function compareSnapshot(expectedValue){
 const actual=await rpc('godotSnapshot');assert.ok(state(actual));assert.deepEqual(state(actual),state(expectedValue));
 return {equal:true,actual,expectedSha256:sha(JSON.stringify(state(expectedValue)))};
}
async function capture(){
 const image=await rpc('godotCaptureView');assert.ok(image.width>0&&image.height>0);assert.ok(image.pixelStats.sampledColors>4,'Blank runtime');
 return image;
}
async function stop(){
 if(ended)return;
 try{await rpc('quit',{},5000);}catch{}
 await Promise.race([exited,delay(10000)]);
 if(!ended){launch.forcedStop=true;child.kill();}await exited;
}
try{
 start();await step('restart genuine failed-activation profile in a frozen isolated client',boot);
 const list=await step('committed pointer selects actual active world without restore replay',async()=>{
  const result=await until(()=>nav('world.list'),v=>v.worlds?.length>0,'World catalog');
  assert.equal(result.activeWorldId,expectedActive);assert.deepEqual(JSON.parse(fs.readFileSync(pointerFile)),pointer);return result;
 });
 for(const[worldId,snapshot]of expected){
  await step('original complete progress survives receipt failure: '+worldId,async()=>{
   if((await nav('world.list')).activeWorldId!==worldId)await nav('world.open',{id:worldId});
   await settled(worldId);const comparison=await compareSnapshot(snapshot);return {comparison,capture:await capture()};
  });
 }
 assert.ok(!report.calls.some(c=>c.payload?.channel==='backup.restore'),'First recovery must not replay restore');
 await step('actual stale CAS created by later product activity',async()=>{
  const current=(await nav('world.list')).activeWorldId;
  const inspected=await panel(current,'backup.inspect');
  assert.equal(inspected.bodiesVerified,true);
  const created=await nav('world.create',{baseId:'first-person',starterId:'training-range',title:'Recovery CAS continuation',operationId:randomUUID()});
  await settled(created.id);
  await rpc('godotPlay',{},60000);
  await panel(created.id,'godot.runtimeSave',{freeze:true});
  const changed=await panel(created.id,'backup.status');
  assert.notEqual(changed.currentHash,inspected.expectedCurrentHash,'CAS must become stale through real core writes');
  const before=await rpc('godotSnapshot');
  const pointerAtFailure=fs.readFileSync(pointerFile);
  let rejected;
  try{await panel(created.id,'backup.restore',{operationId:randomUUID(),grantId:inspected.grantId,expectedCurrentHash:inspected.expectedCurrentHash});}
  catch(error){rejected=String(error);}
  assert.match(rejected??'',/BACKUP_CURRENT_(HASH|STATE)_CONFLICT/,'Must reject actual CAS before activation');
  assert.deepEqual(fs.readFileSync(pointerFile),pointerAtFailure,'Stale restore must not activate another root');
  assert.equal((await nav('world.list')).activeWorldId,created.id);
  await settled(created.id);
  await compareSnapshot(before);
  report.continuation={worldId:created.id,before,rejected};
  return {created,inspected,changed,rejected,pointerUnchanged:true};
 });
 await step('failed activation unfreezes real gameplay and durable saving',async()=>{
  const played=await rpc('godotPlay',{},60000);
  assert.ok(played.actions.some(a=>a.op==='look'));
  const worldId=report.continuation.worldId;
  await panel(worldId,'godot.runtimeSave',{freeze:true});
  report.continuation.saved=await rpc('godotSnapshot');
  const beforeState=state(report.continuation.before),afterState=state(report.continuation.saved);
  // The finite play sequence is repeatable; action evidence proves real calls.
  // A later pose need not differ if that same sequence returns to its final pose.
  assert.equal(beforeState.worldId,afterState.worldId);
  return {played,capture:await capture(),saved:report.continuation.saved};
 });
 await step('orderly shutdown after rejected restore',async()=>{await stop();assert.equal(launch.exit.code,0);assert.ok(!launch.forcedStop);return launch;});
 start();await step('restart continued world through same activation pointer',boot);
 await step('post-failure complete saved progress survives full restart',async()=>{
  const selected=(await nav('world.list')).activeWorldId;
  assert.equal(selected,report.continuation.worldId);await settled(selected);
  return {comparison:await compareSnapshot(report.continuation.saved),capture:await capture()};
 });
 await step('no input, focus or personal profile effects',async()=>{
  const status=await rpc('status');assert.equal(status.violations.length,0);
  assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
  assert.equal(sha(fs.readFileSync(originalArchive)),archiveHash);assert.equal(sha(fs.readFileSync(path.join(failedRun,'report.json'))),report.originalReportSha256);return status;
 });
}catch(error){report.fatal=String(error?.stack??error);process.exitCode=1;console.error(report.fatal);}
finally{await stop();report.finishedAt=new Date().toISOString();persist();console.log('Evidence: '+evidenceDir);}
