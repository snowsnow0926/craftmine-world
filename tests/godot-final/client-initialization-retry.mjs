// Recover an actual owned failed initialization through an immutable package.
// No input events, model calls, arbitrary scripts, or personal profiles.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {compareGodotPersistentProgress} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-godot-bases-acceptance.ts';
const root=path.resolve(import.meta.dirname,'../..'),failed=path.resolve(process.argv[2]??'');
assert.equal(path.dirname(failed),path.join(root,'test-results'));assert.ok(path.basename(failed).startsWith('desktop-native-complete-'));assert.ok(!fs.lstatSync(failed).isSymbolicLink());
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const oldBytes=fs.readFileSync(path.join(failed,'report.json')),old=JSON.parse(oldBytes),packaged=process.env.CRAFTMINE_PACKAGED_ROOT??old.packaged;
assert.ok(old.fatal&&old.finishedAt&&path.isAbsolute(packaged));
const profile=path.join(failed,'profile'),marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'));
assert.equal(marker.format,'craftmine.headless-profile/1');assert.ok(marker.token);
const create=old.calls.findLast(call=>call.payload?.channel==='world.create'&&call.result?.id);
assert.equal(create.payload.payload.baseId,'side-view');const worldId=create.result.id;
const expected=new Map();for(const call of old.calls)if(call.method==='godotSnapshot'&&call.result?.state?.worldId)expected.set(call.result.state.worldId,call.result);
assert.ok(expected.size>=2);
const out=fs.mkdtempSync(path.join(root,'test-results/desktop-native-retry-'));
fs.writeFileSync(path.join(out,'original-report.json'),oldBytes);
const ledger=fs.readFileSync(path.join(profile,'plugins/data/craftmine.world/godot/executor-ledger.json'));
fs.writeFileSync(path.join(out,'original-executor-ledger.json'),ledger);
const report={format:'craftmine.client-initialization-retry/1',startedAt:new Date().toISOString(),out,failed,packaged,worldId,
 originalReportSha256:hash(oldBytes),originalLedgerSha256:hash(ledger),steps:[],calls:[],launches:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
let child,ended=true,ready=false,exit=Promise.resolve(),launch,imageCount=0;const pending=new Map();
function evidence(value){if(Array.isArray(value))return value.map(evidence);if(value&&typeof value==='object'){const result={};for(const[k,v]of Object.entries(value)){if(k==='pngBase64'){const bytes=Buffer.from(v,'base64'),file=`capture-${++imageCount}.png`;fs.writeFileSync(path.join(out,file),bytes);result.image={file,sha256:hash(bytes),bytes:bytes.length};}else result[k]=evidence(v);}return result;}return value;}
function start(){assert.ok(ended);ended=false;ready=false;launch={number:report.launches.length+1};report.launches.push(launch);const current=launch;
 const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:failed,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token,
 CRAFTMINE_CORE_BIN:path.join(packaged,'resources/bin/craftmine-core.exe'),PI_DESKTOP_HOST_BIN:path.join(packaged,'resources/bin/pi-desktop-host-core.exe')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 child=spawn(path.join(packaged,'Craftmine World.exe'),[],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const name of ['stdout','stderr'])child[name].on('data',bytes=>fs.appendFileSync(path.join(out,`${current.number}-${name}.log`),bytes));
 child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit')current.exitAudit=message;if(message?.type!=='craftmine-headless')return;const task=pending.get(message.id);if(!task)return;clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error)):task.resolve(message.result);});
 exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,...(error?{error:String(error)}:{})};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Client exited'));}pending.clear();save();resolve();};child.once('error',error=>finish(null,null,error));child.once('exit',(code,signal)=>finish(code,signal));});
}
const rpc=(method,payload={},timeout=180000)=>new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Client exited'));const id=randomUUID(),record={method,payload,launch:launch.number,at:new Date().toISOString()};report.calls.push(record);const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout: '+method));},timeout);pending.set(id,{timer,resolve:value=>{record.result=evidence(value);save();resolve(value);},reject:error=>{record.error=String(error);save();reject(error);}});child.send({type:'craftmine-headless',id,method,...payload});});
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const until=async(fn,accept,label,timeout=120000)=>{const deadline=Date.now()+timeout;let result;while(Date.now()<deadline){if(ended)throw Error('Client exited');result=await fn();if(accept(result))return result;await delay(500);}throw Error(label+': '+JSON.stringify(result));};
const step=async(name,fn)=>{try{const result=await fn();report.steps.push({name,passed:true,result:evidence(result)});save();console.log('PASS '+name);return result;}catch(error){report.steps.push({name,passed:false,error:String(error)});save();throw error;}};
async function stop(){if(ended)return;try{await rpc('quit',{},5000);}catch{}await Promise.race([exit,delay(15000)]);if(!ended){launch.forcedStop=true;child.kill();}await exit;}
async function started(){await until(()=>ready,Boolean,'Controller');const status=await until(()=>rpc('status'),value=>value.windows?.length>0,'Offscreen window');assert.deepEqual(status.violations,[]);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));await until(()=>nav('world.createOptions'),x=>x.bases?.length>0,'Catalog');return status;}
async function settled(id){await until(()=>nav('world.list'),list=>list.worlds.some(w=>w.id===id&&w.state==='ready'),'World ready',600000);await until(()=>rpc('godotObserve'),x=>x.worldId===id&&x.instanceId,'Actual runtime');await until(()=>rpc('worldNavigationReady'),x=>x.ready&&x.worldId===id,'Navigation');}
try{
 start();await step('start the recorded package on the actual failed profile',started);
 await step('retry the same failed world through the product action',async()=>{const before=await nav('world.list');assert.equal(before.worlds.find(w=>w.id===worldId).state,'failed');const result=await nav('world.creationRetry',{worldId});assert.equal(result.worldId,worldId);await settled(worldId);const after=await nav('world.list');assert.equal(after.worlds.length,before.worlds.length);return result;});
 await step('recovered side-view game produces actual pixels and gameplay',async()=>{const play=await rpc('godotPlayRuins',{},240000);assert.equal(play.ok,true,play.error);const capture=await rpc('godotCaptureView');assert.ok(capture.pixelStats.sampledColors>4);await rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});expected.set(worldId,await rpc('godotSnapshot'));return {play,capture};});
 for(const[id,snapshot]of expected)await step('same profile keeps complete native progress '+id,async()=>{await nav('world.open',{id});await settled(id);const compared=compareGodotPersistentProgress(snapshot,await rpc('godotSnapshot'));assert.equal(compared.equal,true,JSON.stringify(compared.differences));return compared;});
 await step('orderly close after recovery',async()=>{await stop();assert.equal(launch.exit.code,0);assert.ok(!launch.forcedStop);assert.deepEqual(launch.exitAudit.violations,[]);return launch;});
 start();await step('second restart uses the repaired profile',started);
 for(const[id,snapshot]of expected)await step('restart preserves all fields '+id,async()=>{await nav('world.open',{id});await settled(id);const compared=compareGodotPersistentProgress(snapshot,await rpc('godotSnapshot'));assert.equal(compared.equal,true,JSON.stringify(compared.differences));return compared;});
 assert.equal(hash(fs.readFileSync(path.join(failed,'report.json'))),report.originalReportSha256);report.passed=true;
}catch(error){report.passed=false;report.fatal=String(error.stack??error);process.exitCode=1;console.error(report.fatal);}
finally{await stop();report.finishedAt=new Date().toISOString();save();console.log('Evidence: '+out);}
