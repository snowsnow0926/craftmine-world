// New package only. Fixed create/read/restart; no model, real input or evaluation RPC.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadPackageAsar} from '../../desktop/package-asar.mjs';
import {inspectParameterPackage,isolatedParameterEnvironment} from './parameter-client-package.mjs';
import {taskPathPackageArguments,assertTaskPathWorld,refusedImportEvidence} from './task-path-client-package.mjs';
import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
const options=taskPathPackageArguments(process.argv.slice(2)),asar=loadPackageAsar(options.deps);
const info=await inspectParameterPackage({...options,asar});
assert(info.main.includes(Buffer.from('GODOT_TASK_PATH_TOO_LONG')),'Package lacks the reviewed path-error UI');
const packagedExecutor=fs.readFileSync(path.join(options.packaged,'resources/plugins/craftmine.world/godot-executor.cjs'));
assert(packagedExecutor.includes(Buffer.from('GODOT_TASK_PATH_TOO_LONG')),'Package lacks the reviewed executor mapping');
fs.mkdirSync(options.parent,{recursive:true});
const out=fs.mkdtempSync(path.join(options.parent,'desktop-native-task-paths-'));
const suffix='/plugins/data/craftmine.world/godot/tasks/im-000000000000000000000000/work/Packages/craftmine.godot.task.im-000000000000000000000000/AC/Godot';
const stem=path.join(out,'profile-'),padding=266-stem.length-suffix.length;
assert(padding>=0&&padding<200,'Choose a shorter explicit output parent to make a 266-unit cache layout');
const profile=stem+'p'.repeat(padding),legacy=path.join(out,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacy);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={format:'craftmine.task-path-package-acceptance/1',passed:false,startedAt:new Date().toISOString(),out,profile,
 cacheUtf16Units:profile.length+suffix.length,...info.identity,steps:[],launches:[],calls:[],
 limits:['Actual explicitly pinned packaged EXE/core/host/runtime, no development executable fallback.',
  'Fixed first-person blank creation and read-only failed-world observation across restart. No mouse/keyboard/focus/Pointer Lock/model request.',
  'A verified version preflight may launch Godot; the corresponding refused import must never allocate or launch an engine task.',
  'This is intentional rejection of an unsupported 266-unit cache layout, not long-path support or successful game creation.']};
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));persist();
let child,ended=true,ready=false,exit,launch;const pending=new Map();
async function start(){
 assert(ended);assert.deepEqual((await inspectParameterPackage({...options,asar})).identity,info.identity,'Package changed between launches');
 ended=false;ready=false;launch={at:new Date().toISOString()};report.launches.push(launch);const current=launch,number=report.launches.length;
 child=spawn(info.executable,[],{cwd:info.cwd,env:isolatedParameterEnvironment(process.env,{out,profile,token,core:info.core,host:info.host,bases:info.bases}),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,`${number}-${stream}.log`),bytes));
 child.on('message',m=>{if(m?.type==='craftmine-headless-ready')ready=true;if(m?.type==='craftmine-headless-exit')current.audit=m;if(m?.type!=='craftmine-headless')return;const task=pending.get(m.id);if(!task)return;pending.delete(m.id);clearTimeout(task.timer);m.error?task.reject(Error(m.error)):task.resolve(m.result);});
 exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,error:error?String(error):null};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Client exited'));}pending.clear();persist();resolve();};child.once('error',error=>finish(null,null,error));child.once('exit',(code,signal)=>finish(code,signal));});
}
function rpc(method,payload={},timeoutMs=120000){return new Promise((resolve,reject)=>{
 if(ended||!child.connected)return reject(Error('Client exited'));const id=randomUUID(),record={method,payload};report.calls.push(record);
 const timer=setTimeout(()=>{pending.delete(id);record.error='timeout';reject(Error('Timed out '+method));},timeoutMs);
 pending.set(id,{timer,resolve:value=>{record.result=value;resolve(value);},reject:error=>{record.error=String(error);reject(error);}});
 child.send({type:'craftmine-headless',id,method,...payload});
});}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
async function waitFor(fn,accept,label){const deadline=Date.now()+180000;let last;do{if(ended)throw Error('Client exited during '+label);try{last=await fn();}catch(error){last={error:String(error)};}if(accept(last))return last;await delay(200);}while(Date.now()<deadline);throw Error('Timed out '+label+': '+JSON.stringify(last));}
async function stop(){if(!launch)return;if(!ended){try{await rpc('quit',{},5000);}catch{}await Promise.race([exit,delay(20000)]);if(!ended){launch.forcedStop=true;child.kill();await Promise.race([exit,delay(5000).then(()=>{throw Error('CLIENT_STOP_TIMEOUT');})]);}}assertCleanHeadlessShutdown(launch);}
async function step(name,fn){try{const result=await fn();report.steps.push({name,passed:true,result});persist();return result;}catch(error){report.steps.push({name,passed:false,error:String(error)});persist();throw error;}}
let worldId;
try{
 await start();await waitFor(async()=>ready,Boolean,'controller');await waitFor(()=>nav('world.list'),value=>Array.isArray(value.worlds),'world navigation');
 const world=await step('create one fixed world through the packaged product',()=>nav('world.create',{baseId:'first-person',starterId:'blank',title:'Long task path rejection',operationId:randomUUID()}));
 worldId=world.id;assert.match(worldId,/^[a-z0-9][a-z0-9-]{1,47}$/);report.worldId=worldId;
 const failedWorld=async()=>{const list=await waitFor(()=>nav('world.list'),value=>value.worlds?.some(world=>world.id===worldId&&world.state==='failed'),'failed world');return list.worlds.find(world=>world.id===worldId);};
 report.before=await step('show precise build preparation failure without exposing an internal path',async()=>{const row=await failedWorld();assertTaskPathWorld(row,worldId);return row;});
 report.attempt=await step('record an unlaunched rejected import with no task directory',()=>refusedImportEvidence(profile,worldId));
 await step('first orderly package shutdown',stop);
 const ledgerFile=path.join(profile,'plugins/data/craftmine.world/godot/executor-ledger.json');report.firstLedgerSha256=sha(fs.readFileSync(ledgerFile));fs.copyFileSync(ledgerFile,path.join(out,'first-executor-ledger.json'));
 await start();await waitFor(async()=>ready,Boolean,'restarted controller');
 report.after=await step('restart keeps the same failed world, finite code and build stage',async()=>{const row=await failedWorld();assertTaskPathWorld(row,worldId);assert.equal(row.creation.operationId,report.before.creation.operationId);return row;});
 await step('restart does not retry or launch the refused import',()=>{const evidence=refusedImportEvidence(profile,worldId);assert.equal(evidence.jobId,report.attempt.jobId);assert.equal(evidence.requestId,report.attempt.requestId);return evidence;});
 await step('second orderly package shutdown',stop);
 fs.copyFileSync(ledgerFile,path.join(out,'second-executor-ledger.json'));
 assert.deepEqual((await inspectParameterPackage({...options,asar})).identity,info.identity);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{try{await stop();}catch(error){report.shutdownError=String(error);report.passed=false;process.exitCode=1;}report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({out,passed:report.passed,error:report.error,shutdownError:report.shutdownError}));}
