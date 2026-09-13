// Actual product host, native initialization/build/first-load/save/reopen.
// Read-only application/runtime inputs; all data belongs to this new background run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {assertTemplateReopened} from './helpers/template-reopen-assertions.mjs';

const [applicationRoot,resources]=process.argv.slice(2);
if(!applicationRoot||!resources||![applicationRoot,resources].every(path.isAbsolute))throw Error('Usage: node tests/world-templates-client-native.mjs ABS_BUILT_CHECKOUT ABS_RUNTIME_RESOURCES');
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const previousFile=process.argv[4],previous=previousFile?JSON.parse(fs.readFileSync(previousFile)):null;
if(previous){assert.equal(previous.format,'craftmine.world-template-client-native/1');assert.equal(path.dirname(previous.out),path.join(root,'test-results'));assert(path.basename(previous.out).startsWith('desktop-native-templates-'));assert.equal(previous.applicationRoot,applicationRoot);assert.equal(previous.resources,resources);assert(previous.worlds.length===4&&previous.worlds.every(w=>w.save));}
const out=previous?.out??fs.mkdtempSync(path.join(root,'test-results/desktop-native-templates-')),profile=path.join(out,'profile'),token=previous?JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'))).token:randomUUID();
if(!previous){const legacySource=path.join(out,'legacy');fs.mkdirSync(profile);fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));}
const launch=resolveCreationNativeLaunch({root:applicationRoot,inherited:{...process.env,CRAFTMINE_EVAL_CORE:path.join(applicationRoot,'vendor/pi-desktop/target/release/craftmine-core.exe'),CRAFTMINE_EVAL_HOST:path.join(applicationRoot,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe')}});
const report={format:'craftmine.world-template-client-native/1',out,applicationRoot,resources,launches:previous?.launches??[],worlds:previous?.worlds??[],modelCalls:0,...(previous?{previousReport:previousFile,previousError:previous.error}:{})};
const reportFile=path.join(out,previous?'continuation-'+randomUUID()+'.json':'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
let child,ended=true,ready=false,exit;
const pending=new Map(),abort=new AbortController();process.on('SIGINT',()=>abort.abort());process.on('SIGTERM',()=>abort.abort());
const watcher=setInterval(()=>{if(fs.existsSync(path.join(out,'cancel')))abort.abort();},300);
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{
 if(ended)return reject(Error('DESKTOP_EXITED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('DESKTOP_RPC_TIMEOUT:'+method));},120000);
 pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});
});
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
async function until(read,accept){while(!abort.signal.aborted){if(ended)throw Error('DESKTOP_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/Window is not ready|Actual Godot host unavailable|No world runtime is running|World view is not ready|WORLD_BUSY|GODOT_CANDIDATE_ACTIVE/.test(String(error)))throw error;}await delay(350);}throw Error('TEST_CANCELLED');}
async function start(){
 ready=false;ended=false;
 const env={...launch.environment({out,profile,token}),CRAFTMINE_RUNTIME_RESOURCES:resources};
 child=spawn(launch.executable,launch.args,{cwd:applicationRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 const current={pid:child.pid};report.launches.push(current);save();
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,report.launches.length+'-'+stream+'.log'),bytes));
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')current.audit=message;const task=pending.get(message.id);if(task){pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error)):task.resolve(message.result);}});
 exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;current.exit={code,signal};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('DESKTOP_EXITED'));}pending.clear();resolve();});child.once('error',error=>{ended=true;current.error=String(error);resolve();});});
 await until(async()=>ready,Boolean);const status=await until(()=>rpc('status'),s=>s.windows.length>0);assert.deepEqual(status.violations,[]);assert(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
 await until(()=>nav('world.createOptions'),o=>o.bases?.some(b=>b.starters?.some(s=>s.id==='promo-mainline')));
}
async function stop(){if(!ended){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(15000)]);if(!ended){child.kill();await exit;throw Error('NORMAL_SHUTDOWN_FAILED');}}const current=report.launches.at(-1);assert(current.audit);assert.deepEqual(current.audit.violations,[]);assert.deepEqual(current.audit.shutdownFailures,[]);save();}
async function waitWorld(worldId){
 await until(()=>nav('world.list'),value=>{const row=value.worlds.find(w=>w.id===worldId);if(row?.state==='failed')throw Error('TEMPLATE_INITIALIZATION_FAILED:'+JSON.stringify(row));return row?.state==='ready';});
 await until(()=>rpc('godotObserve'),o=>o.worldId===worldId&&!!o.instanceId);
 return rpc('godotSnapshot');
}
try{
 console.log(JSON.stringify({out,cancel:path.join(out,'cancel')}));await start();
 if(!previous)for(const starterId of ['promo-mainline','promo-flight','promo-rain','promo-city']){
  const started=Date.now(),record={starterId};report.worlds.push(record);save();
  const created=await nav('world.create',{title:starterId+' native copy',baseId:'creation-sandbox',starterId,operationId:randomUUID()});record.worldId=created.id;save();
  record.snapshot=await waitWorld(created.id);
  record.save=await rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId:created.id,freeze:true}});
  record.elapsedMs=Date.now()-started;save();console.log(JSON.stringify({starterId,worldId:created.id,elapsedMs:record.elapsedMs}));
 }
 if(!previous){await stop();await start();}
 for(const record of report.worlds){await until(()=>nav('world.open',{id:record.worldId}),Boolean);record.reopenedSnapshot=await waitWorld(record.worldId);record.reopened=true;record.reopenChecks=assertTemplateReopened(record);save();}
 const worlds=await nav('world.list');for(const record of report.worlds)assert(worlds.worlds.some(w=>w.id===record.worldId));
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{try{await stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;}clearInterval(watcher);save();}
console.log(JSON.stringify({passed:report.passed===true,report:reportFile,error:report.error,shutdownError:report.shutdownError}));
