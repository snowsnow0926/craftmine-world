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

const [applicationRoot,resources]=process.argv.slice(2);
assert(applicationRoot&&resources&&[applicationRoot,resources].every(path.isAbsolute),'ABSOLUTE_CHECKOUT_AND_RUNTIME_REQUIRED');
const root=path.resolve(process.env.CRAFTMINE_EMPTY_TEST_ROOT??path.resolve(import.meta.dirname,'..'));fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/desktop-native-empty-conversation-'));const profile=path.join(out,'profile'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(path.join(out,'legacy'));fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:path.join(out,'legacy')}));
const launch=resolveCreationNativeLaunch({root:applicationRoot,inherited:process.env});
const report={format:'craftmine.empty-world-conversation-native/1',out,applicationRoot,resources,buildMainSha256:createHash('sha256').update(launch.main).digest('hex'),modelCalls:0,launches:[],worlds:[],operations:[],steps:[],limits:['One fresh isolated developer-machine profile; external clean Windows and human acceptance pending.','Actual PI forms and offscreen native checks; no physical input or Pointer Lock.']};
const reportFile=path.join(out,'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
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
  return until(()=>rpc('godotSnapshot'),Boolean);
}
async function start(kind) {
  ready=false; ended=false; port=await reserveLoopbackPort();
  current={kind,startedAt:new Date().toISOString(),mainSha256:report.buildMainSha256}; report.launches.push(current);
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
  if(!ended){
    if(report.error)for(const row of report.operations){try{await nav('library.direct',{action:'cancel',worldId:row.worldId,operationId:row.operationId});}catch(error){report.cancelErrors??=[];report.cancelErrors.push(String(error));}}
    const deadline=Date.now()+60000;while(!ended&&Date.now()<deadline){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(1000)]);}
    if(!ended){child.kill();await exit;throw Error('NORMAL_SHUTDOWN_REQUIRED');}
  }
  assert(current.audit);assert.deepEqual(current.audit.violations,[]);assert.deepEqual(current.audit.shutdownFailures,[]);save();
}
let worldId;
async function openExistingWorld(id){
 for(let attempt=1;attempt<=3;attempt++){
  await chooser('worlds');await until(()=>evaluate(`!!document.querySelector('[data-world-open="${id}"]')`),Boolean);
  await submit(`[data-world-open="${id}"]`);
  try{await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);return await waitWorld(id);}
  catch(error){
   if(attempt===3||!/对话或输入已改变。世界已保留，请再次打开。|Conversation or input changed.*open.*again/i.test(String(error)))throw error;
   // Startup may restore the conversation after the first form preflight.
   // Follow the visible retry instruction; do not bypass its source guard.
   report.openRetries??=[];report.openRetries.push({worldId:id,attempt,error:String(error)});save();
   await delay(500);
  }
 }
}
const field=(selector,value)=>evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('FIELD_NOT_FOUND:'+${JSON.stringify(selector)});const props=element[Object.keys(element).find(key=>key.startsWith('__reactProps$'))];if(typeof props?.onChange!=='function')throw Error('FIELD_HANDLER_REQUIRED');if(element.type==='checkbox'||element.type==='radio')element.checked=${JSON.stringify(value)};else element.value=${JSON.stringify(value)};props.onChange({target:element,currentTarget:element});return true;})()`);
const mark=message=>{report.steps.push({at:new Date().toISOString(),message});save();console.log(message);};
async function failIfError(){const error=await evaluate(`document.querySelector('[data-world-entry-error], [data-library-publish] [role="alert"], [data-local-world-templates] [role="alert"]')?.textContent`);if(error)throw Error(error);}
async function createWorld(title){
  await chooser('create');await until(()=>evaluate(`!!document.querySelector('[data-world-base-option="creation-sandbox"] input')`),Boolean);
  await field('[data-world-base-option="creation-sandbox"] input',true);
  await field('[data-world-starter-option="blank"] input',true);
  await field('[data-world-create="name"]',title);
  const started=performance.now();await submit('[data-world-create="form"]');
  await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);
  worldId=(await nav('world.list')).activeWorldId;const snapshot=await waitWorld(worldId);
  report.worlds.push({worldId,title,createdThrough:'actual-New-World-form',createMs:performance.now()-started,snapshot});save();return worldId;
}

const readSession = async () => evaluate(`(async()=>{const raw=await piDesktop.invoke(piDesktop.channels.invoke.sessionList);return raw?.data?.sessions??raw?.sessions??raw;})()`);
try {
 console.log(JSON.stringify({out,cancel:path.join(out,'cancel')}));await start('first');
 worldId=await createWorld('Empty conversation cold reopen');
 report.bound=await nav('world.conversation',{worldId});assert(report.bound.sessionId);assert.equal(report.bound.taskId,undefined);
 report.sessionRows=await readSession();const row=report.sessionRows.find(s=>s.id===report.bound.sessionId);assert.equal(row.messageCount,0);mark('Ordinary New World creates and registers an actual empty session without a task');
 await stop();await start('cold');await openExistingWorld(worldId);
 report.restored=await until(()=>evaluate(`document.querySelector('[data-world-session]')?.dataset.worldSession`),id=>id===report.bound.sessionId);
 report.coldBound=await nav('world.conversation',{worldId});assert.equal(report.coldBound.sessionId,report.bound.sessionId);assert.equal(report.coldBound.taskId,undefined);
 report.coldRows=await readSession();assert.equal(report.coldRows.find(s=>s.id===report.bound.sessionId).messageCount,0);
 
 if(!await evaluate(`!!document.querySelector('[data-first-guide-title]')`))await submit('[data-first-guide-toggle]');await submit('[data-first-guide-step="2"]');await until(()=>evaluate(`!!document.querySelector('[data-first-guide-action="create"]')`),Boolean);await submit('[data-first-guide-action="create"]');
 report.creationSurface=await until(()=>evaluate(`(()=>{const node=document.querySelector('.creation-target-context'),editor=document.querySelector('.creation-object-editor'),rect=node?.getBoundingClientRect();return {targetVisible:!!rect&&rect.width>0&&rect.height>0,targetState:node?.dataset.creationTarget,editorText:editor?.innerText,editor:!!editor,sessionId:document.querySelector('[data-world-session]')?.dataset.worldSession,layout:JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1'))};})()`),value=>value.targetVisible&&value.targetState!=='loading'&&value.editor&&value.sessionId===report.bound.sessionId&&value.layout.mode==='create');
 await delay(500);report.creationCapture=await rpc('capture',{name:'cold-empty-creation'});
 report.snapshot=await rpc('godotSnapshot');assert.equal(report.snapshot.worldId,worldId);report.guards=await rpc('guards');mark('Cold chooser reopen restores same zero-message session and actual native world');report.passed=true;
} catch(error){report.error=String(error.stack??error);process.exitCode=1;try{report.failurePage=await evaluate(`({text:document.body.innerText.slice(-7000),workspace:localStorage.getItem('craftmine.desktop.layout.v1')})`);report.actualSessionRows=await readSession();report.hostWorkspace=await evaluate(`(async()=>{const key=Object.keys(piDesktop.channels.invoke).find(k=>/workspaceGet|projectGet/i.test(k));return key?{key,value:await piDesktop.invoke(piDesktop.channels.invoke[key])}:Object.keys(piDesktop.channels.invoke).filter(k=>/project|workspace/i.test(k));})()`);}catch{} }
finally{try{await stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;}clearInterval(watcher);save();launch.assertUnchanged();}
console.log(JSON.stringify({passed:report.passed===true,report:reportFile,error:report.error}));
