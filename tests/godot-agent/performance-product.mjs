// Sealed desktop, actual Core and registered plugin tool IPC. No model request.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {createCompleteOutput} from '../godot-final/complete-contract.mjs';
import {resolveCreationNativeLaunch,creationPackagedRoot} from '../helpers/creation-native-launch.mjs';
import {adoptionEnvironment} from '../helpers/promo-adoption-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),packagedRoot=creationPackagedRoot();
assert.ok(packagedRoot&&path.isAbsolute(packagedRoot),'Explicit --packaged-root required');
const expected=process.env.CRAFTMINE_EXPECTED_PACKAGE_COMMIT;assert.match(expected??'',/^[a-f0-9]{40}$/,'Explicit package commit required');
const client=resolveCreationNativeLaunch({root,packagedRoot,requiredGuards:['godotPerformanceTool','HEADLESS_PERFORMANCE_REGISTERED_TOOL_REQUIRED']});
const manifest=JSON.parse(fs.readFileSync(path.join(packagedRoot,'resources/source/build-manifest.json')));assert.equal(manifest.commit,expected);
const out=createCompleteOutput(root),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const report={format:'craftmine.performance-product/1',passed:false,out,packageIdentity:client.identity,commit:manifest.commit,
  scope:'Sealed desktop ordinary world/session creation and Core-backed save/cold reopen; protected no-model invocation of actual registered plugin performance tool',
  modelRequestsStarted:0,sourceEdits:0,worldId:null,sessionId:null,launches:[],calls:[],checks:[],notVerified:['Ordinary model selection/use of performance tool','Player-scale optimization','Engine frame/physics/GPU/object metrics']};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
let child,ready=false,ended=true,exitPromise,exitAudit,cancelled=false;const pending=new Map();
function validate(method,fields){
  assert.ok(['status','primaryMode','worldNavigationReady','worldNavigation','worldPanel','playerCreateSession','godotObserve','godotSnapshot','godotPerformanceTool','quit'].includes(method));
  if(method==='worldNavigation')assert.ok(['world.createOptions','world.create','world.list'].includes(fields.channel));
  if(method==='worldPanel'){assert.equal(fields.channel,'godot.runtimeSave');assert.deepEqual(fields.payload,{worldId:report.worldId,freeze:true});}
  if(method==='godotPerformanceTool')assert.deepEqual(fields.payload,{worldId:report.worldId,sessionId:report.sessionId});
}
function rpc(method,fields={},timeout=120000){
  validate(method,fields);report.calls.push({method,fields});save();
  if(ended||(cancelled&&method!=='quit'))return Promise.reject(Error('TEST_STOPPED'));
  return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('TIMEOUT '+method));},timeout);pending.set(id,{timer,resolve,reject});child.send({type:'craftmine-headless',id,method,...fields});});
}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
async function until(read,accept,label,timeout=120000){
  const deadline=Date.now()+timeout;let last;
  while(Date.now()<deadline){if(ended||cancelled)throw Error('STOPPED '+label);
    try{last=await read();if(accept(last))return last;}catch(error){if(!/not ready|UNAVAILABLE|WORLD_BUSY|No world runtime is running|World view unavailable/i.test(error.message))throw error;}
    await delay(500);
  }throw Error('TIMEOUT '+label+': '+JSON.stringify(last));
}
async function boot(){
  client.assertUnchanged();ready=false;ended=false;exitAudit=null;const launch={number:report.launches.length+1};report.launches.push(launch);
  const env=adoptionEnvironment(client,{out,profile,token});assert.ok(!Object.keys(env).some(k=>/CREATION_EVAL|EVAL_|LIVE_|API_KEY|SECRET|AUTHORIZATION/i.test(k)));
  child=spawn(client.executable,client.args,{cwd:client.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});launch.pid=child.pid;
  for(const name of ['stdout','stderr'])child[name].on('data',bytes=>fs.appendFileSync(path.join(out,launch.number+'-'+name+'.log'),bytes));
  exitPromise=new Promise(resolve=>{child.once('error',error=>{launch.error=String(error);ended=true;resolve();});child.once('exit',(code,signal)=>{ended=true;launch.exit={code,signal};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('CLIENT_EXITED'));}pending.clear();resolve();});});
  child.on('message',message=>{if(message?.type==='craftmine-headless-ready')ready=true;if(message?.type==='craftmine-headless-exit'){exitAudit=message;launch.audit=message;}const task=pending.get(message?.id);if(task){clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(Error(message.error)):task.resolve(message.result);}});
  await until(async()=>ready,Boolean,'controller');
  const status=await until(()=>rpc('status'),r=>r.windows?.length,'offscreen window');launch.status=status;
  assert.deepEqual(status.violations,[]);assert.ok(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
  await rpc('primaryMode',{payload:{action:'create'}});await until(()=>rpc('worldNavigationReady'),r=>r.ready,'navigation');
}
async function stop(){if(!ended){await rpc('quit').catch(()=>{});await Promise.race([exitPromise,delay(15000)]);if(!ended){child.kill();await exitPromise;throw Error('UNCLEAN_EXIT');}}
  for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(exitAudit?.[field],[]);assert.equal(report.launches.at(-1).exit?.code,0);client.assertUnchanged();save();}
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);save();console.log('PASS '+label);};
async function observePhase(){
  const before=await until(()=>rpc('godotObserve'),r=>r.worldId===report.worldId&&r.instanceId,'current Godot');
  const saved=await rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId:report.worldId,freeze:true}});
  assert.ok(['craftmine.progress-receipt/1','craftmine.godot-progress-receipt/1'].includes(saved.format));
  assert.equal(saved.worldId,before.worldId);assert.equal(saved.buildId,before.buildId);assert.match(saved.contentHash,/^[a-f0-9]{64}$/);
  const snapshotBefore=await rpc('godotSnapshot');
  const probe=await rpc('godotPerformanceTool',{payload:{worldId:report.worldId,sessionId:report.sessionId}});
  const snapshotAfter=await rpc('godotSnapshot'),after=await rpc('godotObserve');
  assert.equal(probe.toolName,'godot_performance_observe');assert.equal(probe.pluginId,'craftmine.world');assert.equal(probe.result.available,true,JSON.stringify(probe.result));
  assert.equal(probe.modelRequestsStarted,0);
  for(const key of ['worldId','buildId','instanceId']){assert.equal(probe.result.scope[key],before[key]);assert.equal(after[key],before[key]);}
  const measured=probe.result.measured;assert.equal(measured.memoryWorkingSetMb.status,'measured');assert.ok(measured.memoryWorkingSetMb.value>0);assert.equal(measured.memoryWorkingSetMb.unit,'MiB');
  assert.equal(measured.memoryWorkingSetMb.measurementScope,'renderer-process');
  for(const key of ['frameTimeMs','physicsStepMs','objectCount','gpuTimeMs'])assert.equal(measured[key].status,'unknown');
  assert.deepEqual(snapshotAfter,snapshotBefore);check('registered IPC tool preserves world/build/instance and snapshot',true);
  return {before,saved,snapshotBefore,probe,snapshotAfter,after};
}
async function cancel(reason){if(cancelled)return;cancelled=true;report.cancelled=reason;save();if(!ended)await rpc('quit',{},5000).catch(()=>{});}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void cancel(signal));
const monitor=setInterval(()=>{if(fs.existsSync(path.join(out,'cancel.request')))void cancel('cancel.request');},250);monitor.unref();
save();console.log('EVIDENCE_DIRECTORY='+out);
try{
  await boot();await until(()=>nav('world.createOptions'),r=>r.bases?.some(b=>b.id==='creation-sandbox'&&b.delivered),'creation catalog');
  const world=await nav('world.create',{title:'性能工具正式产品验收',baseId:'creation-sandbox',starterId:'blank',operationId:randomUUID()});report.worldId=world.id;save();
  await until(()=>nav('world.list'),r=>{const row=r.worlds?.find(w=>w.id===world.id);if(row?.state==='failed')throw Error('WORLD_INITIALIZATION_FAILED');return row?.state==='ready';},'ordinary world actual build',900000);
  await until(()=>rpc('godotObserve'),r=>r.worldId===world.id&&r.instanceId,'actual Godot runtime');
  const session=await rpc('playerCreateSession',{payload:{worldId:world.id,title:'性能工具只读产品验收'}});report.sessionId=session.sessionId;report.sessionCreation=session;save();
  report.first=await observePhase();await stop();
  await boot();report.reopened=await observePhase();
  check('cold reopen retains formal world/build and creates a new instance',report.reopened.before.worldId===report.first.before.worldId&&report.reopened.before.buildId===report.first.before.buildId&&report.reopened.before.instanceId!==report.first.before.instanceId);
  assert.deepEqual(report.reopened.snapshotBefore,report.first.snapshotAfter);check('actual Core-backed saved snapshot survives process cold reopen',true);
  await stop();report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;console.error(error.message);}
finally{clearInterval(monitor);if(!ended)try{await stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;}for(const task of pending.values())clearTimeout(task.timer);save();console.log('REPORT='+path.join(out,'report.json'));}
