// Real PI client, ordinary chooser forms, native world services, disposable data.
// CDP only evaluates page scripts; it never enables focus emulation or sends input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {reserveLoopbackPort} from './helpers/ordinary-world-ui.mjs';

const [applicationRoot, resources] = process.argv.slice(2);
assert(applicationRoot && resources && [applicationRoot, resources].every(path.isAbsolute),
  'Usage: node tests/player-fluency-client-native.mjs ABS_BUILT_CHECKOUT ABS_RUNTIME_RESOURCES [--packaged-root ABS_PACKAGE]');
const root = path.resolve(import.meta.dirname, '..');
const starters=process.argv.includes('--mainline-only')?['promo-mainline']:['promo-mainline','promo-flight','promo-rain','promo-city'];
fs.mkdirSync(path.join(root, 'test-results'), {recursive:true});
const out = fs.mkdtempSync(path.join(root, 'test-results/desktop-native-fluency-'));
const profile = path.join(out, 'profile'), token = randomUUID();
fs.mkdirSync(profile); fs.mkdirSync(path.join(out, 'legacy'));
fs.writeFileSync(path.join(profile, 'headless-profile.json'), JSON.stringify({
  format:'craftmine.headless-profile/1', token, legacySource:path.join(out, 'legacy'),
}));
const launch = resolveCreationNativeLaunch({root:applicationRoot, inherited:process.env});
const report = {
  format:'craftmine.player-fluency-client/1', out, applicationRoot, resources,
  driverSha256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),
  package:launch.identity && {inventorySha256:launch.identity.inventorySha256, mainSha256:launch.identity.mainSha256},
  buildMainSha256:createHash('sha256').update(launch.main).digest('hex'),
  modelCalls:0, starters, launches:[], worlds:[], switches:[], overlays:[],
  limits:[
    'Single run on this machine; startup means fresh profile, not flushed OS disk cache.',
    'Durations end at a valid native runtime snapshot, not merely chooser dismissal.',
    'Renderer animation frame timing is not Godot engine FPS or visible OS presentation latency.',
    'F2 uses the actual DOM application handler with a synthetic page event; no physical input.',
    'No model requests; AI cancellation and generation time are outside this measurement.',
  ],
};
const reportFile = path.join(out, 'report.json');
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)+'\n');
const abort = new AbortController(), pending = new Map();
let child, ended = true, ready = false, exit, socket, sequence = 0, current, port;
process.on('SIGINT', () => abort.abort()); process.on('SIGTERM', () => abort.abort());
const watcher = setInterval(() => {if(fs.existsSync(path.join(out, 'cancel'))) abort.abort();}, 300);
const rpc = (method, fields={}) => new Promise((resolve,reject) => {
  if(ended) return reject(Error('DESKTOP_EXITED'));
  const id = randomUUID(), timer = setTimeout(() => {pending.delete(id); reject(Error('RPC_TIMEOUT:'+method));}, 120000);
  pending.set(id, {resolve,reject,timer}); child.send({type:'craftmine-headless',id,method,...fields});
});
async function until(read, accept) {
  while(!abort.signal.aborted) {
    if(ended) throw Error('DESKTOP_EXITED');
    try {const value = await read(); if(accept(value)) return value;}
    catch(error) {if(!/Window is not ready|Actual Godot host unavailable|No world runtime is running|World view is not ready|WORLD_BUSY|GODOT_CANDIDATE_ACTIVE/.test(String(error))) throw error;}
    await delay(100);
  }
  throw Error('TEST_CANCELLED');
}
function cdp(target, method, params={}) {
  return new Promise((resolve,reject) => {
    const id = ++sequence, timer = setTimeout(() => {target.removeEventListener('message', listener); reject(Error('CDP_TIMEOUT'));}, 120000);
    const listener = event => {
      const value = JSON.parse(event.data); if(value.id!==id) return;
      clearTimeout(timer); target.removeEventListener('message',listener);
      value.error ? reject(Error(JSON.stringify(value.error))) : resolve(value.result);
    };
    target.addEventListener('message', listener); target.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression, target=socket) {
  const result = await cdp(target,'Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description??'PAGE_ERROR');
  return result.result?.value;
}
async function connect(url) {
  const target = new WebSocket(url);
  await new Promise((resolve,reject) => {target.addEventListener('open',resolve,{once:true}); target.addEventListener('error',reject,{once:true});});
  return target;
}
const tabs = async () => (await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).filter(t=>t.type==='page');
const nav = (channel,payload={}) => rpc('worldNavigation',{channel,payload});
const submit = selector => evaluate(`(()=>{const form=document.querySelector(${JSON.stringify(selector)});if(!form||form.tagName!=='FORM')throw Error('FORM_NOT_FOUND');form.requestSubmit();return true;})()`);
async function chooser(tab) {
  await rpc('primaryMode',{payload:{action:'entry'}});
  await until(()=>evaluate(`!!document.querySelector('[data-world-entry-tab-form="${tab}"]')`),Boolean);
  await submit(`[data-world-entry-tab-form="${tab}"]`);
  await until(()=>evaluate(`!!document.querySelector('#world-entry-${tab}')`),Boolean);
  if(tab==='examples') await until(()=>evaluate(`document.querySelectorAll('[data-world-example]').length`),n=>n===4);
}
async function waitWorld(worldId) {
  await until(()=>nav('world.list'), value => {
    const row=value.worlds.find(w=>w.id===worldId);
    if(row?.state==='failed') throw Error('WORLD_INITIALIZATION_FAILED:'+JSON.stringify(row));
    return row?.state==='ready';
  });
  await until(()=>rpc('godotObserve'),o=>o.worldId===worldId&&!!o.instanceId);
  return rpc('godotSnapshot');
}
async function start(kind) {
  ready=false; ended=false; port=await reserveLoopbackPort();
  current={kind,startedAt:new Date().toISOString()}; report.launches.push(current);
  const started=performance.now();
  child=spawn(launch.executable,[...launch.args,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{
    cwd:applicationRoot,env:{...launch.environment({out,profile,token}),CRAFTMINE_RUNTIME_RESOURCES:resources},
    windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],
  });
  for(const stream of ['stdout','stderr']) child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,kind+'-'+stream+'.log'),bytes));
  child.on('message',m=>{
    if(m.type==='craftmine-headless-ready') ready=true;
    if(m.type==='craftmine-headless-exit') current.audit=m;
    const task=pending.get(m.id); if(task){pending.delete(m.id);clearTimeout(task.timer);m.error?task.reject(Error(m.error)):task.resolve(m.result);}
  });
  exit=new Promise(resolve=>{
    child.once('exit',(code,signal)=>{ended=true;current.exit={code,signal};for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('DESKTOP_EXITED'));}pending.clear();resolve();});
    child.once('error',error=>{ended=true;current.error=String(error);resolve();});
  });
  await until(async()=>ready,Boolean); current.hostReadyMs=performance.now()-started;
  const status=await until(()=>rpc('status'),s=>s.windows.length>0);
  assert.deepEqual(status.violations,[]); assert(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
  const candidates=await until(async()=>{try{return(await tabs()).filter(t=>t.url.includes('/out/renderer/index.html')&&!new URL(t.url).searchParams.has('surface'));}catch{return[];}},v=>v.length===1);
  socket=await connect(candidates[0].webSocketDebuggerUrl);
  await until(()=>evaluate(`!!document.querySelector('[data-mode-entry], .app-shell')`),Boolean);
  current.rendererReadyMs=performance.now()-started;
  current.clockOriginMs=started;
  save();
}
async function stop() {
  socket?.close(); socket=null;
  if(!ended){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(15000)]);if(!ended){child.kill();await exit;throw Error('NORMAL_SHUTDOWN_REQUIRED');}}
  assert(current.audit);assert.deepEqual(current.audit.violations,[]);assert.deepEqual(current.audit.shutdownFailures,[]);save();
}
async function overlayProbe(worldId) {
  const before=await rpc('godotObserve');
  for(const [key,shiftKey,overlay] of [['F2',false,'compact'],['F2',true,'full'],['Escape',false,'closed']]) {
    const metric=await evaluate(`new Promise((resolve,reject)=>{const start=performance.now();const timer=setTimeout(()=>{observer.disconnect();reject(Error('OVERLAY_HANDLER_TIMEOUT'));},10000);const observer=new MutationObserver(check);function check(){const layout=JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1'));if(layout.overlay!==${JSON.stringify(overlay)}||!document.querySelector('.craftmine-overlay-'+${JSON.stringify(overlay)}))return;const dialog=document.querySelector('.main-pane[role="dialog"]');if(${JSON.stringify(overlay)}!=='closed'&&(!dialog||!dialog.getClientRects().length))return;clearTimeout(timer);observer.disconnect();resolve({handlerToDOMMs:performance.now()-start,overlay:layout.overlay,dialogVisible:!!dialog&&dialog.getClientRects().length>0});}observer.observe(document.documentElement,{subtree:true,attributes:true,childList:true});document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},code:${JSON.stringify(key)},shiftKey:${shiftKey},bubbles:true,cancelable:true}));check();})`);
    report.overlays.push({worldId,key,shiftKey,...metric});save();
  }
  const after=await rpc('godotObserve');
  assert.equal(after.worldId,before.worldId);assert.equal(after.instanceId,before.instanceId);assert.equal(after.buildId,before.buildId);
}
async function rendererFrames(worldId) {
  // A fixed observation window is not a gameplay or model deadline.
  return evaluate(`new Promise(resolve=>{const samples=[],started=performance.now();let previous=started,frameId;const tick=now=>{samples.push(now-previous);previous=now;frameId=requestAnimationFrame(tick);};frameId=requestAnimationFrame(tick);setTimeout(()=>{cancelAnimationFrame(frameId);const sorted=samples.slice().sort((a,b)=>a-b);resolve({worldId:${JSON.stringify(worldId)},surface:'PI renderer',elapsedMs:performance.now()-started,frames:samples.length,medianIntervalMs:sorted[Math.floor(sorted.length*.5)]??null,p95IntervalMs:sorted[Math.floor(sorted.length*.95)]??null,longIntervalsOver50Ms:samples.filter(n=>n>50).length});},2000);})`);
}
async function heldInputProbe(worldId) {
  const candidates=(await tabs()).filter(t=>t.url.startsWith('http://127.0.0.1:'));
  let game;
  for(const candidate of candidates){const target=await connect(candidate.webSocketDebuggerUrl);if(await evaluate(`globalThis.craftmineRuntime?.scope?.worldId===${JSON.stringify(worldId)}`,target)){game=target;break;}target.close();}
  assert(game,'ACTIVE_GAME_PAGE_REQUIRED');
  const key=type=>evaluate(`(()=>{if(!globalThis.__craftmineHeadless||document.pointerLockElement||document.hasFocus())throw Error('INPUT_GUARD');const canvas=document.querySelector('canvas');const before=document.activeElement;canvas.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{key:'w',code:'KeyW',bubbles:true,cancelable:true}));if(before!==document.activeElement)throw Error('INPUT_FOCUS_CHANGED');return true;})()`,game);
  const position=async()=>{const result=await rpc('godotSnapshot');return result.state.body.player.position;};
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
  const metric={worldId};report.heldInput=metric;
  try {
    metric.before=await position();await key('keydown');await delay(500);metric.held=await position();
    metric.movedWhileHeld=distance(metric.before,metric.held);assert(metric.movedWhileHeld>0.05,'W_MUST_REACH_REAL_ENGINE');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',code:'F2',bubbles:true,cancelable:true}));true`);
    await until(()=>rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}}),s=>s.state==='paused');
    metric.paused=await position();
    // A player's physical release now belongs to the conversation, not the game.
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keyup',{key:'w',code:'KeyW',bubbles:true,cancelable:true}));true`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));true`);
    await until(()=>rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}}),s=>s.state==='ready');
    // Preserve the player's normal movement deceleration; test sustained input,
    // not the instantaneous velocity already present before the pause.
    metric.decelerationWaitMs=1000;
    await delay(metric.decelerationWaitMs);
    metric.resumed=await position();await delay(600);metric.after=await position();
    metric.driftAfterConversation=distance(metric.resumed,metric.after);
    metric.released=metric.driftAfterConversation<0.03;
    save();
  } finally {await key('keyup').catch(()=>{});game.close();}
}
try {
  console.log(JSON.stringify({out,cancel:path.join(out,'cancel')}));await start('fresh-profile');
  await chooser('examples');await until(()=>evaluate(`document.querySelectorAll('[data-world-example]').length`),n=>n===4);
  current.examplesReadyMs=performance.now()-current.clockOriginMs;save();
  for(const starterId of starters) {
    await chooser('examples');const started=performance.now();
    const record={starterId};report.worlds.push(record);save();
    await submit(`[data-world-example="${starterId}"] form`);
    await until(async()=>{
      const state=await evaluate(`({entry:!!document.querySelector('[data-mode-entry]'),error:document.querySelector('[data-world-entry-error]')?.textContent,pending:document.querySelector('[data-world-entry-pending]')?.textContent})`);
      if(state.error)throw Error(state.error);if(state.pending&&!record.firstPending){record.firstPending={ms:performance.now()-started,text:state.pending};save();}return !state.entry;
    },Boolean);
    record.chooserDismissedMs=performance.now()-started;
    record.worldId=(await nav('world.list')).activeWorldId;
    record.snapshot=await waitWorld(record.worldId);record.createToSnapshotMs=performance.now()-started;
    const saveStarted=performance.now();
    record.save=await rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId:record.worldId,freeze:false}});
    record.saveMs=performance.now()-saveStarted;
    record.rendererFrames=await rendererFrames(record.worldId);
    await overlayProbe(record.worldId);save();console.log(JSON.stringify({starterId,createMs:record.createToSnapshotMs,saveMs:record.saveMs}));
    if(starterId==='promo-mainline') await heldInputProbe(record.worldId);
  }
  for(const world of report.worlds) {
    await chooser('worlds');await until(()=>evaluate(`!!document.querySelector('[data-world-open="${world.worldId}"]')`),Boolean);
    const started=performance.now();await submit(`[data-world-open="${world.worldId}"]`);
    await until(()=>evaluate(`!document.querySelector('[data-mode-entry]')`),Boolean);
    const snapshot=await waitWorld(world.worldId);
    report.switches.push({worldId:world.worldId,starterId:world.starterId,switchToSnapshotMs:performance.now()-started,snapshot});save();
  }
  await stop();await start('warm-profile');
  const active=report.worlds.at(-1);await waitWorld(active.worldId);
  current.activeWorldReopenedMs=performance.now()-current.clockOriginMs;
  report.guards=await rpc('guards');assert.equal(report.heldInput?.released,true,'HELD_KEY_SURVIVED_CONVERSATION');report.passed=true;
} catch(error) {
  report.error=String(error.stack??error);process.exitCode=1;
  try{report.failurePage=await evaluate(`({text:document.body.innerText.slice(-4000),layout:localStorage.getItem('craftmine.desktop.layout.v1')})`);}catch{}
} finally {
  try{await stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;}
  clearInterval(watcher);save();launch.assertUnchanged();
}
console.log(JSON.stringify({passed:report.passed===true,report:reportFile,error:report.error,shutdownError:report.shutdownError}));
