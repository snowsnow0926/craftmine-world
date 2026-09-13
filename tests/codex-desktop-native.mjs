// Actual desktop main/preload/conversation IPC, registered plugin and native Core.
// --live sends real tree/flower requests with the exact Codex model and effort.
// New runs create an independent profile. --resume-test continues only this
// driver's own marked fixture after a driver failure, preserving the old report.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {reserveLoopbackPort} from './helpers/ordinary-world-ui.mjs';
import {processEnvironment} from '../scripts/lib/codex-app-server.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const root=path.resolve(import.meta.dirname,'..'),live=args.includes('--live'),binary=option('--codex'),resources=option('--runtime-resources');
assert(resources&&path.isAbsolute(resources),'Pass --runtime-resources with an absolute development component directory containing godot/blender');
if(live)assert(binary&&path.isAbsolute(binary),'--live requires an absolute --codex executable path');
const resumeFile=option('--resume-test'),previous=resumeFile?JSON.parse(fs.readFileSync(resumeFile,'utf8')):null;
if(previous){assert(live);assert.equal(previous.format,'craftmine.codex-desktop-native/1');assert.equal(path.resolve(previous.out,'..'),path.join(root,'test-results'));assert(path.basename(previous.out).startsWith('desktop-native-codex-'));assert.equal(fs.realpathSync(previous.out),previous.out);assert.equal(path.dirname(path.resolve(resumeFile)),previous.out);assert(previous.sessionId&&previous.worldId);}
const out=previous?.out??fs.mkdtempSync(path.join(root,'test-results/desktop-native-codex-')),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy');
const token=previous?JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8')).token:randomUUID();
if(!previous){fs.mkdirSync(profile);fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));}
const report={format:'craftmine.codex-desktop-native/1',out,live,model:'gpt-6-astra',effort:'xhigh',steps:previous?.steps??[],prompts:previous?.prompts??[],launches:[],...(previous?{previousReport:resumeFile,previousFailure:previous.error,worldId:previous.worldId,sessionId:previous.sessionId}: {})};
const reportFile=path.join(out,previous?'continuation-'+randomUUID()+'.json':'report.json');
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));save();
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
const cancel=path.join(out,'cancel');const watch=setInterval(()=>{if(fs.existsSync(cancel))controller.abort();},300);
console.log(JSON.stringify({out,cancel,live}));
let sessionId=previous?.sessionId,worldId=previous?.worldId,child,exit,ended,ready,port,debug,debugSocket,sequence=0;const pending=new Map();
const launch=resolveCreationNativeLaunch({root,inherited:processEnvironment(),requiredGuards:['CodexCheckpointHost','CODEX_PATH_REQUIRED']});
function rpc(method,fields={}) { if(ended)return Promise.reject(Error('DESKTOP_EXITED'));return new Promise((resolve,reject)=>{
  const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('DESKTOP_RPC_TIMEOUT:'+method));},120000);
  pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});
}); }
async function evaluate(expression) {
  const socket=debugSocket;
  return await new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>reject(Error('DESKTOP_PAGE_RPC_TIMEOUT')),120000);
    const listener=event=>{const value=JSON.parse(event.data);if(value.id!==id)return;clearTimeout(timer);socket.removeEventListener('message',listener);
      if(value.error||value.result?.exceptionDetails)reject(Error(value.result?.exceptionDetails?.exception?.description??value.error?.message));else resolve(value.result?.result?.value);};
    socket.addEventListener('message',listener);
    socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  });
}
const invoke=(name,...args)=>evaluate(`(async()=>{if(!globalThis.__craftmineHeadless)throw Error('OWNED_HEADLESS_PAGE_REQUIRED');const r=await piDesktop.invoke(piDesktop.channels.invoke[${JSON.stringify(name)}],...${JSON.stringify(args)});if(!r.ok)throw Error(r.error?.code+': '+r.error?.message);return r.data;})()`);
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload});
async function capture() {
  const state=await until(()=>rpc('godotCaptureBoundState'),value=>!!value.formal);
  assert.equal(state.formal.worldId,worldId);
  return rpc('godotCaptureBoundView',{payload:state.formal});
}
async function until(read,accept) {
  while(!controller.signal.aborted){if(ended)throw Error('DESKTOP_EXITED');const value=await read();if(accept(value))return value;await delay(350);}
  throw Error('TEST_CANCELLED');
}
async function start() {
  port=await reserveLoopbackPort();ready=false;ended=false;
  const env={...launch.environment({out,profile,token}),CRAFTMINE_RUNTIME_RESOURCES:resources};
  child=spawn(launch.executable,[...launch.args,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const record={pid:child.pid,port};report.launches.push(record);
  save();console.log('Starting offscreen desktop '+child.pid);
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,stream+'.log'),bytes));
  child.on('message',message=>{
    if(message.type==='craftmine-headless-ready')ready=true;
    if(message.type==='craftmine-headless-exit')record.audit=message;
    const task=pending.get(message.id);if(task){pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error)):task.resolve(message.result);}
  });
  exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;record.exit={code,signal};resolve();});child.once('error',error=>{ended=true;record.error=error.code;resolve();});});
  await until(async()=>ready,Boolean);
  const status=await rpc('status');assert.deepEqual(status.violations,[]);assert(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
  const candidates=await until(async()=>{
    const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return targets.filter(target=>target.type==='page'&&target.url.includes('/out/renderer/index.html')&&!new URL(target.url).searchParams.get('surface'));
  },targets=>targets.length>0);
  assert.equal(candidates.length,1);debug=candidates[0].webSocketDebuggerUrl;
  assert.equal(new URL(debug).port,String(port));assert(['localhost','127.0.0.1'].includes(new URL(debug).hostname));
  debugSocket=new WebSocket(debug);await new Promise((resolve,reject)=>{debugSocket.addEventListener('open',resolve,{once:true});debugSocket.addEventListener('error',reject,{once:true});});
  await until(()=>evaluate(`!!globalThis.__craftmineHeadless && !!globalThis.piDesktop`),Boolean);
  await evaluate(`globalThis.codexDesktopEvents=[];piDesktop.on(piDesktop.channels.event.agentMessage,e=>codexDesktopEvents.push(e));true`);
  await until(()=>evaluate(`!!document.querySelector('.craftmine-play') || !!document.querySelector('[data-player-world="godot"]:not(:disabled)')`),Boolean);
  const enter=()=>evaluate(`(()=>{const button=document.querySelector('[data-player-world="godot"]');const key=button&&Object.keys(button).find(k=>k.startsWith('__reactProps$'));if(!key||button.disabled)return false;button[key].onClick();return true;})()`);
  if(!await evaluate(`!!document.querySelector('.craftmine-play')`))await enter();
  await until(async()=>{
    const value=await evaluate(`({play:!!document.querySelector('.craftmine-play'),error:document.querySelector('[data-player-world-error]')?.textContent})`);
    if(value.error==='WORLD_BUSY'){await delay(500);await enter();return null;}
    if(value.error)throw Error(value.error);return value.play;
  },Boolean);save();
  await until(()=>rpc('godotCaptureBoundState'),value=>!!value.formal);
  if(sessionId){
    await evaluate(`(()=>{const button=document.querySelector('[data-sidebar-session-row="'+${JSON.stringify(sessionId)}+'"] .thread-item-main');const key=button&&Object.keys(button).find(k=>k.startsWith('__reactProps$'));if(!key)throw Error('OWNED_SESSION_HISTORY_NOT_FOUND');button[key].onClick();return true;})()`);
    await rpc('primaryMode',{payload:{action:'full'}});
    await until(async()=>{
      if(await evaluate(`!!document.querySelector('.craftmine-overlay-closed')`))await rpc('primaryMode',{payload:{action:'full'}});
      return evaluate(`document.querySelector('.composer-model-thinking-model')?.textContent??''`);
    },text=>text.includes('Codex CLI'));
    report.composer=await evaluate(`({model:document.querySelector('.composer-model-thinking-model')?.textContent,effort:document.querySelector('.composer-model-thinking-level')?.textContent})`);
    await invoke('notificationSetViewingSession',{sessionId});save();
  }
}
async function stop() {
  debugSocket?.close();debugSocket=undefined;
  if(!ended){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(15000)]);if(!ended)child.kill();await exit;}
  const audit=report.launches.at(-1).audit;assert(audit,'Normal shutdown audit required');assert.deepEqual(audit.violations,[]);assert.deepEqual(audit.shutdownFailures,[]);save();
}
async function prompt(text,attachments=[]) {
  const messageId=randomUUID(),entry={text,messageId,attachments,startedAt:new Date().toISOString()};report.prompts.push(entry);save();
  console.log('Submitting normal desktop prompt: '+text);
  await invoke('notificationSetViewingSession',{sessionId});
  const accepted=await invoke('agentPrompt',{sessionId,viewingSessionId:sessionId,content:text,messageId,attachments});entry.turnId=accepted.turnId;save();
  if(text!=='Read the current world.') {
    await assert.rejects(invoke('settingsSet',{worldAgentBackend:'pi'}),/AGENT_BUSY/);
    assert.equal((await invoke('settingsGet')).worldAgentBackend,'codex-cli');entry.activeBackendChange='AGENT_BUSY';
  }
  const terminal=await until(async()=>{
    const events=await evaluate(`codexDesktopEvents.filter(e=>e.turnId===${JSON.stringify(accepted.turnId)})`);
    if(events.some(e=>e.event.type==='error'||e.event.type==='agent_end'))return events;
    return null;
  },Boolean);
  await until(()=>invoke('agentGetStatus',sessionId),value=>!value.status.isRunning);
  // Wait for Rust's normal durable-turn finalization, without a model timer.
  await until(()=>invoke('sessionTurnMetrics',{sessionId,messageId}),value=>value.status!=='running');
  entry.events=terminal;entry.finishedAt=new Date().toISOString();entry.record=await invoke('sessionGet',sessionId);save();
  return entry;
}
async function appliedFrame(name) {
  await invoke('notificationSetViewingSession',{sessionId});
  const application=await until(async()=>{
    const status=await nav('godot.creationTaskStatus',{sessionId});
    if(['failed','cancelled','interrupted'].includes(status.phase))throw Error(JSON.stringify(status));
    if(status.phase==='ready'){
      await panel('godot.candidatePreview',{worldId,candidateId:status.candidateId});
      await panel('godot.candidateApply',{worldId,candidateId:status.candidateId});
    }
    return status;
  },status=>status.phase==='applied');
  const frame=await capture(),bytes=Buffer.from(frame.pngBase64,'base64');
  const image=path.join(profile,'scratch',sessionId,name+'.png');fs.mkdirSync(path.dirname(image),{recursive:true});fs.writeFileSync(image,bytes);
  const proof={source:'actual-Godot-frame',worldId,application,image,sha256:createHash('sha256').update(bytes).digest('hex'),width:frame.width,height:frame.height,observation:frame.viewportObservation};
  report[name]=proof;save();return proof;
}
controller.signal.addEventListener('abort',()=>{if(!ended&&sessionId&&debug)void invoke('agentAbort',{sessionId}).catch(()=>{});});
try {
  await start();
  if(!previous){
  const list=await nav('world.list');worldId=list.activeWorldId;assert(worldId);report.worldId=worldId;report.worlds=list;save();
  report.initial=await rpc('godotObserve');assert.equal(report.initial.worldId,worldId);report.steps.push('ordinary native world creation and first-load');save();
  await invoke('settingsSet',{worldAgentBackend:'codex-cli',codexCliPath:path.join(out,'missing-codex.exe')});
  const created=await invoke('sessionCreate',{title:'Codex world conversation',mode:'agent',permissionMode:'auto'});sessionId=created.session.id;report.sessionId=sessionId;
  const projected=await invoke('sessionGet',sessionId);assert.equal(projected.session.worldAgentBackend,'codex-cli');assert.deepEqual(projected.session.supportedThinkingLevels,['xhigh']);
  assert.equal((await invoke('providersList')).providers.length,0,'Codex world prompt must not require an API provider');
  const failed=await prompt('Read the current world.');assert(failed.events.some(e=>e.event.type==='error'&&e.event.error.code==='CODEX_PROCESS_START_FAILED'));
  report.steps.push('normal prompt fails visibly on a missing CLI, with no PI fallback');
  // The interrupted native task remains governed by the normal world UI.
  const recoverable=await nav('task.recoverable',{worldId});
  for(const task of recoverable.items??[])await nav('task.discard',{worldId,taskId:task.taskId,generation:task.generation});
  }
  if(live){
    await invoke('settingsSet',{worldAgentBackend:'codex-cli',codexCliPath:binary});
    const existingFlowers=previous?.prompts.findLast(p=>p.text==='我希望地上有花草。'&&p.finishedAt&&!p.events?.some(e=>e.event.type==='error'));
    if(existingFlowers){
      assert(existingFlowers.events.some(e=>e.event.type==='status'&&e.event.status.transportState==='resumed'));
      report['tree-frame']=previous['tree-frame'];report['flowers-frame']=previous['flowers-frame'];
      const reopened=await appliedFrame('flowers-reopened-frame');
      assert.equal(reopened.application.buildId,previous['flowers-frame'].application.buildId);
      report.steps.push('cold reopen confirms the same applied flower build without another model request');
    } else {
    if(!previous){await stop();await start();}
    const tree=previous?previous.prompts.findLast(p=>p.text==='我想生成一些树。'&&p.finishedAt):await prompt('我想生成一些树。');
    assert(tree,'A completed tree request in this isolated fixture is required');
    assert(!tree.events.some(e=>e.event.type==='error'),JSON.stringify(tree.events.filter(e=>e.event.type==='error')));
    assert(tree.events.some(e=>e.event.type==='tool_start'&&['plugin_craftmine_world_godot_project_patch','plugin_craftmine_world_creation_operation'].includes(e.event.toolName)));
    assert(tree.events.some(e=>e.event.type==='status'&&e.event.status.backend==='codex-cli'&&e.event.status.modelId==='gpt-6-astra'&&e.event.status.reasoningEffort==='xhigh'));
    report.steps.push('actual normal desktop tree prompt called local Codex and registered source tools');
    const feedback=await appliedFrame('tree-frame');
    await stop();await start();
    const flowers=await prompt('我希望地上有花草。',[{path:feedback.image,name:'Actual current world frame',kind:'image',mimeType:'image/png'}]);
    assert(!flowers.events.some(e=>e.event.type==='error'),JSON.stringify(flowers.events.filter(e=>e.event.type==='error')));
    assert(flowers.events.some(e=>e.event.type==='status'&&e.event.status.transportState==='resumed'));
    assert(flowers.record.session.messages.some(message=>message.id===tree.messageId));
    assert(flowers.record.session.messages.find(message=>message.id===flowers.messageId).attachments[0].ref.startsWith('attachments/'));
    await appliedFrame('flowers-frame');
    report.steps.push('cold desktop reopen preserves world/transcript and resumes actual Codex thread for flowers');
    }
  }
  report.final=await rpc('godotObserve');assert.equal(report.final.worldId,worldId);
  const frame=await capture();report.frame=frame;
  report.saved=await panel('godot.runtimeSave',{worldId,freeze:true});report.steps.push('ordinary native save');
  await stop();report.ok=true;
} catch(error) { report.error=String(error.stack??error);process.exitCode=1;console.error(report.error); }
finally {clearInterval(watch);if(!ended)await stop().catch(error=>{report.shutdownError=String(error);});save();console.log(JSON.stringify({out,report:reportFile,ok:report.ok??false}));}
