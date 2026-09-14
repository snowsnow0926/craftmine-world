// Parent-run native recovery probe. This file never calls an Agent or game input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from '../helpers/creation-native-launch.mjs';
import {reserveLoopbackPort} from '../helpers/ordinary-world-ui.mjs';
import {operatorRedactor,redactedOperatorLog} from '../helpers/operator-provider-config.mjs';
import {retryHash,validateOperatorRetryProfile,retainedInitializationEvidence,assertRetainedInitializationRecovery,initializationRetryUiScript,initializationRecoveryMode,waitForRetryStartup} from '../helpers/operator-initialization-retry.mjs';
import {compareGodotPersistentProgress} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-godot-bases-acceptance.ts';
import {isTransientReadTimeout,terminalState} from '../player-feedback/P8/initialization-poll.mjs';

const argv=process.argv.slice(2),allowed=['--application-root','--packaged-root','--original-report','--world-id','--output-root'];
if(argv.includes('--help')){console.log('node tests/godot-final/operator-initialization-retry.mjs --application-root ABS --packaged-root ABS --original-report ABS --world-id ID --output-root ABS/test-results\nRuns only when explicitly launched; original stopped zero-model operator profile, same world, no model/input.');process.exit(0);}
assert(argv.length===allowed.length*2&&argv.every((value,i)=>i%2||allowed.includes(value)),'RETRY_EXACT_ARGUMENTS_REQUIRED');
const options=Object.fromEntries(allowed.map(name=>{assert.equal(argv.filter(value=>value===name).length,1,'RETRY_DUPLICATE_ARGUMENT');return [name,argv[argv.indexOf(name)+1]];}));
for(const name of allowed.filter(name=>name!=='--world-id'))assert(path.isAbsolute(options[name]),'RETRY_ABSOLUTE_PATH_REQUIRED');
const owned=validateOperatorRetryProfile(options['--original-report'],options['--world-id']),worldId=owned.worldId;
const outputRoot=path.resolve(options['--output-root']);assert.equal(path.basename(outputRoot),'test-results');fs.mkdirSync(outputRoot,{recursive:true});
const out=fs.mkdtempSync(path.join(outputRoot,'desktop-native-operator-retry-')),redact=operatorRedactor();
const launch=resolveCreationNativeLaunch({root:options['--application-root'],packagedRoot:options['--packaged-root']});assert(launch.packaged,'RETRY_SEALED_PACKAGE_REQUIRED');
const report={format:'craftmine.operator-initialization-retry/1',startedAt:new Date().toISOString(),out,worldId,originalFile:owned.originalFile,originalReportSha256:owned.originalReportSha256,
  packageIdentity:launch.identity,driverSha256:retryHash(fs.readFileSync(import.meta.filename)),profile:owned.profile,launches:[],calls:[],steps:[],retryClicks:0,modelCalls:0,passed:false};
const file=path.join(out,'report.json'),save=()=>fs.writeFileSync(file,JSON.stringify(redact(report),null,2));
fs.copyFileSync(owned.originalFile,path.join(out,'original-report.json'));
report.priorFailureEvidence=[];
for(const name of ['ordinary-initialization-retry.json','read-only-startup-page.json','initialization-retry-stop-reason.json']){const source=path.join(owned.owner,name);if(fs.existsSync(source)){const bytes=fs.readFileSync(source);fs.writeFileSync(path.join(out,'prior-'+name),bytes);report.priorFailureEvidence.push({file:source,sha256:retryHash(bytes)});}}
report.before=retainedInitializationEvidence(owned.profile,worldId);save();
const cancelled=new AbortController(),cancelFile=path.join(out,'cancel');report.cancelFile=cancelFile;
process.on('SIGINT',()=>cancelled.abort());process.on('SIGTERM',()=>cancelled.abort());
const watcher=setInterval(()=>{if(fs.existsSync(cancelFile))cancelled.abort();},250);
let child,run,ended=true,ready=false,exit,socket,sequence=0;const pending=new Map();
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{
  if(ended)return reject(Error('RETRY_CLIENT_EXITED'));const id=randomUUID(),record={method,fields,launch:run.number,at:new Date().toISOString()};report.calls.push(record);
  const timer=setTimeout(()=>{pending.delete(id);record.error='RPC_TIMEOUT';save();reject(Error('RETRY_RPC_TIMEOUT:'+method));},120000);
  pending.set(id,{resolve:result=>{clearTimeout(timer);record.result=archive(result);save();resolve(result);},reject:error=>{clearTimeout(timer);record.error=redact(String(error));save();reject(error);}});
  child.send({type:'craftmine-headless',id,method,...fields});
});
function archive(value){
  if(Array.isArray(value))return value.map(archive);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>{
    if(key==='pngBase64'){const bytes=Buffer.from(item,'base64'),name='capture-'+randomUUID()+'.png';fs.writeFileSync(path.join(out,name),bytes);return ['image',{file:path.join(out,name),bytes:bytes.length,sha256:retryHash(bytes)}];}
    return [key,archive(item)];
  }));return value;
}
async function until(read,accept){while(!cancelled.signal.aborted){if(ended)throw Error('RETRY_CLIENT_EXITED');const result=await read();if(accept(result))return result;await delay(200);}throw Error('OPERATOR_CANCELLED');}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
async function readWorldList(){try{return await nav('world.list');}catch(error){if(!isTransientReadTimeout(error))throw error;report.transientReadErrors??=[];report.transientReadErrors.push({at:new Date().toISOString(),error:redact(String(error))});save();return null;}}
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}});
async function evaluate(expression){
  assert(socket?.readyState===1,'RETRY_OWNED_PAGE_CONNECTION_REQUIRED');const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(Error('RETRY_PAGE_TIMEOUT')),120000);
    const finish=(error,value)=>{clearTimeout(timer);socket.removeEventListener('message',listener);error?reject(error):resolve(value);};
    const listener=event=>{const value=JSON.parse(event.data);if(value.id!==id)return;const error=value.error??value.result?.exceptionDetails;if(error)finish(Error(redact(error.exception?.description??error.message??JSON.stringify(error))));else finish(null,value.result?.result?.value);};
    socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  });
}
async function start(){
  launch.assertUnchanged();run={number:report.launches.length+1,startedAt:new Date().toISOString()};report.launches.push(run);ready=false;ended=false;
  const port=await reserveLoopbackPort();run.port=port;
  child=spawn(launch.executable,[...launch.args,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{cwd:launch.cwd,
    env:{...launch.environment({out:owned.owner,profile:owned.profile,token:owned.marker.token}),CRAFTMINE_RUNTIME_RESOURCES:path.join(launch.packaged,'resources')},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});run.pid=child.pid;
  for(const stream of ['stdout','stderr']){const log=redactedOperatorLog(redact,text=>fs.appendFileSync(path.join(out,run.number+'-'+stream+'.log'),text));child[stream].on('data',bytes=>log.push(bytes));child[stream].once('end',()=>log.end());}
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')run.audit=message;const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(Error(message.error)):task.resolve(message.result);}});
  exit=new Promise(resolve=>{child.once('error',error=>{run.spawnError=String(error);ended=true;resolve();});child.once('exit',(code,signal)=>{ended=true;run.exit={code,signal};for(const task of pending.values())task.reject(Error('RETRY_CLIENT_EXITED'));pending.clear();resolve();});});
  await until(async()=>ready,Boolean);
  run.startupStatus=await waitForRetryStartup({until,readStatus:()=>rpc('status')});
  const targets=await until(async()=>{try{return (await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).filter(t=>t.type==='page'&&t.url.includes('/out/renderer/index.html')&&!new URL(t.url).searchParams.has('surface'));}catch{return[];}},items=>items.length===1);
  const url=new URL(targets[0].webSocketDebuggerUrl);assert(['127.0.0.1','localhost'].includes(url.hostname)&&url.port===String(port));socket=new WebSocket(url);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  await until(()=>evaluate('!!globalThis.__craftmineHeadless&&!!globalThis.piDesktop&&!!document.querySelector(".app-shell:not(.app-shell-boot)")'),Boolean);
  await rpc('primaryMode',{payload:{action:'entry'}});
  await until(()=>evaluate(`!!document.querySelector('[data-world-entry-tab-form="worlds"]')`),Boolean);
  await evaluate(`(()=>{const form=document.querySelector('[data-world-entry-tab-form="worlds"]');if(!globalThis.__craftmineHeadless||!form)throw Error('RETRY_WORLD_TAB_REQUIRED');form.requestSubmit();return true;})()`);
}
async function stop(){
  if(!ended){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(60000)]);if(!ended){run.forcedStop=true;child.kill();await exit;}}
  socket?.close();socket=null;assert(!run.forcedStop,'RETRY_NORMAL_SHUTDOWN_REQUIRED');assert.equal(run.exit?.code,0);assert(run.audit,'RETRY_SHUTDOWN_AUDIT_REQUIRED');assert.deepEqual(run.audit.violations,[]);assert.deepEqual(run.audit.shutdownFailures,[]);assert.deepEqual(run.audit.pageErrors??[],[],'RETRY_PAGE_ERRORS');save();
}
async function readyWorld(){
  const list=await until(readWorldList,value=>{if(!value)return false;const row=value.worlds.find(row=>row.id===worldId);assert(row,'RETRY_WORLD_MISSING');if(terminalState(row))throw Error('RETRY_TERMINAL_INITIALIZATION_FAILURE: '+JSON.stringify(row.creation));return row.state==='ready';});
  assert(list.worlds.some(row=>row.id===worldId));
  await until(()=>evaluate(`!!document.querySelector('[data-world-open="${worldId}"]')`),Boolean);
  await evaluate(`(()=>{const form=document.querySelector('[data-world-open="${worldId}"]');if(!globalThis.__craftmineHeadless||!form||form.querySelector('button:disabled'))throw Error('RETRY_WORLD_OPEN_UNAVAILABLE');form.requestSubmit();return true;})()`);
  await until(()=>rpc('worldNavigationReady'),state=>state.ready&&state.worldId===worldId);
  return until(()=>rpc('godotObserve'),state=>state.worldId===worldId&&!!state.instanceId);
}
async function captureAndSave(){
  const saved=await panel('godot.runtimeSave',{freeze:true}),snapshot=await rpc('godotSnapshot'),before=await rpc('godotObserve');assert.equal(before.worldId,worldId);
  const frame=await rpc('godotCaptureView');assert(frame.pixelStats?.sampledColors>4,'RETRY_NONBLANK_NATIVE_PIXELS_REQUIRED');
  const after=await rpc('godotObserve');for(const key of ['worldId','buildId','instanceId'])assert.equal(before[key],after[key],'RETRY_CAPTURE_IDENTITY_CHANGED');
  return {saved,snapshot,observation:after,frame:report.calls.findLast(row=>row.method==='godotCaptureView').result};
}
async function step(name,action){try{const result=await action();report.steps.push({name,passed:true,result:archive(result)});save();return result;}catch(error){report.steps.push({name,passed:false,error:redact(String(error.stack??error))});save();throw error;}}
try{
  await step('start sealed package on retained stopped profile',start);
  const initial=await until(readWorldList,Boolean);report.beforeWorldIds=initial.worlds.map(row=>row.id).sort();
  const decision=await until(async()=>{const list=await readWorldList();if(!list)return null;assert(list.worlds.some(row=>row.id===worldId),'RETRY_WORLD_MISSING');return {list,ui:await evaluate(initializationRetryUiScript(worldId))};},value=>!!value&&!!initializationRecoveryMode(value.list.worlds.find(row=>row.id===worldId),value.ui));
  report.recoveryDecision=decision;const row=decision.list.worlds.find(row=>row.id===worldId);assert(row,'RETRY_WORLD_MISSING');
  report.recoveryMode=initializationRecoveryMode(row,decision.ui);
  if(report.recoveryMode==='ordinary-react-retry'){report.retryDispatchAttempted=true;report.retryClicks=null;save();report.retryDispatch=await evaluate(initializationRetryUiScript(worldId,true));assert.equal(report.retryDispatch.submitted,true);report.retryClicks=1;await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
  save();await step('same world becomes an actual running formal instance',readyWorld);
  const afterList=await until(readWorldList,Boolean);assert.deepEqual(afterList.worlds.map(row=>row.id).sort(),report.beforeWorldIds,'RETRY_WORLD_SET_CHANGED');
  const first=await step('native pixels and ordinary frozen save',captureAndSave);report.savedSnapshot=first.snapshot;
  await step('normal shutdown after recovery',stop);
  report.afterRecovery=retainedInitializationEvidence(owned.profile,worldId);report.canonicalRecovery=assertRetainedInitializationRecovery(report.before,report.afterRecovery,worldId);save();
  await step('cold start sealed package on same recovered profile',start);
  const secondRuntime=await step('ordinary open of recovered world after restart',readyWorld);assert.equal(secondRuntime.buildId,first.observation.buildId,'RETRY_COLD_BUILD_CHANGED');assert.notEqual(secondRuntime.instanceId,first.observation.instanceId,'RETRY_NEW_RUNTIME_INSTANCE_REQUIRED');
  const second=await step('cold-reopened native pixels and save',captureAndSave);
  const compared=compareGodotPersistentProgress(first.snapshot,second.snapshot);report.progressComparison=compared;assert(compared.equal,'RETRY_COLD_PROGRESS_CHANGED: '+JSON.stringify(compared.differences));
  await step('normal shutdown after cold reopen',stop);
  report.afterCold=retainedInitializationEvidence(owned.profile,worldId);assertRetainedInitializationRecovery(report.before,report.afterCold,worldId);
  assert.equal(retryHash(fs.readFileSync(owned.originalFile)),owned.originalReportSha256,'RETRY_ORIGINAL_REPORT_CHANGED');
  launch.assertUnchanged();report.finalIntegrity='passed';report.passed=true;
}catch(error){report.fatal=redact(String(error.stack??error));process.exitCode=1;}
finally{
  if(run)try{await stop();}catch(error){report.shutdownError=redact(String(error.stack??error));report.passed=false;process.exitCode=1;}
  try{launch.assertUnchanged();report.finalIntegrity='passed';}catch(error){report.finalIntegrity=redact(String(error));report.passed=false;process.exitCode=1;}
  clearInterval(watcher);report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({out,passed:report.passed,recoveryMode:report.recoveryMode,retryClicks:report.retryClicks,fatal:report.fatal}));
}
