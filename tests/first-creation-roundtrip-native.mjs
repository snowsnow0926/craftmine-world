// Real PI client, ordinary chooser forms, native world services, disposable data.
// CDP only evaluates page scripts; it never enables focus emulation or sends input.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {completeCreationProgress} from './helpers/creation-model-evaluation.mjs';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {reserveLoopbackPort} from './helpers/ordinary-world-ui.mjs';

const [applicationRoot,resources]=process.argv.slice(2);
assert(applicationRoot&&resources&&[applicationRoot,resources].every(path.isAbsolute),'ABSOLUTE_CHECKOUT_AND_RUNTIME_REQUIRED');
const root=path.resolve(import.meta.dirname,'..');
const resultsRoot=path.resolve(process.env.CRAFTMINE_CREATION_OUTPUT_ROOT??path.join(root,'test-results'));fs.mkdirSync(resultsRoot,{recursive:true});
const resumeIndex=process.argv.indexOf('--resume-author'),frameIndex=process.argv.indexOf('--frame-report'),framesOnly=frameIndex>=0,previousFile=framesOnly?process.argv[frameIndex+1]:resumeIndex>=0?process.argv[resumeIndex+1]:null;
const previous=previousFile?JSON.parse(fs.readFileSync(previousFile)):null;
if(previous){assert.equal(previous.format,'craftmine.first-creation-roundtrip/1');if(framesOnly)assert(previous.passed&&previous.authorWorldId&&previous.importedWorldId&&previous.companionEntityId,'FRAME_ONLY_ACCEPTED_WORLDS');else assert(!previous.passed&&!previous.templateRef&&previous.operations?.[0]?.applied?.status==='applied'&&(!previous.editedEntityId||previous.editedEntity?.id===previous.editedEntityId),'RESUME_ONLY_KNOWN_AUTHOR_STAGE');assert.equal(path.basename(path.dirname(previous.out)),'test-results');assert(path.basename(previous.out).startsWith('desktop-native-rt-'));}
const out=previous?.out??fs.mkdtempSync(path.join(resultsRoot,'desktop-native-rt-'));let profile=path.join(out,'profile');const token=previous?JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'))).token:randomUUID();
if(!previous){fs.mkdirSync(profile);fs.mkdirSync(path.join(out,'legacy'));fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:path.join(out,'legacy')}));}
const launch=resolveCreationNativeLaunch({root:applicationRoot,inherited:process.env});
const report={format:'craftmine.first-creation-roundtrip/1',out,applicationRoot,resources,buildMainSha256:createHash('sha256').update(launch.main).digest('hex'),modelCalls:null,launches:[],worlds:[],operations:[],steps:[],limits:['One fresh isolated developer-machine profile; external clean Windows and human acceptance pending.','Actual PI forms and offscreen native checks; no physical input or Pointer Lock.']};
report.driverSha256=createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex');
report.limits.push('The supported edit changes an ordinarily placed stock tree. The catalog companion is retained as its exact model; arbitrary GLB recoloring is not claimed.');
report.packageIdentity=launch.identity?{inventorySha256:launch.identity.inventorySha256,mainSha256:launch.identity.mainSha256,version:launch.identity.version}:null;
const nativePaths=launch.packaged?{core:path.join(launch.packaged,'resources/bin/craftmine-core.exe'),host:path.join(launch.packaged,'resources/bin/pi-desktop-host-core.exe')}:{core:process.env.CRAFTMINE_EVAL_CORE??path.join(applicationRoot,'vendor/pi-desktop/target/release/craftmine-core.exe'),host:process.env.CRAFTMINE_EVAL_HOST??path.join(applicationRoot,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe')};
report.nativeBinaries=Object.fromEntries(Object.entries(nativePaths).map(([name,file])=>[name,{file:path.resolve(file),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}]));
if(previous){const identity={applicationRoot,resources,buildMainSha256:report.buildMainSha256,driverSha256:report.driverSha256,nativeBinaries:report.nativeBinaries,packageIdentity:report.packageIdentity,limits:report.limits};Object.assign(report,previous,identity,{previousReport:previousFile,previousError:previous.error,previousJourneyPassed:previous.passed});delete report.passed;delete report.error;delete report.shutdownError;delete report.failurePage;}
const reportFile=path.join(out,previous?'continuation-'+randomUUID()+'.json':'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
const abort = new AbortController(), pending = new Map();
const cancelFile=path.join(out,previous?'cancel-'+randomUUID():'cancel');report.cancelFile=cancelFile;
let child, ended = true, ready = false, exit, socket, sequence = 0, current, port;
process.on('SIGINT', () => abort.abort()); process.on('SIGTERM', () => abort.abort());
const watcher = setInterval(() => {if(fs.existsSync(cancelFile)) abort.abort();}, 300);
const rpc = (method, fields={}) => new Promise((resolve,reject) => {
  if(ended) return reject(Error('DESKTOP_EXITED'));
  const id = randomUUID(), timer = setTimeout(() => {pending.delete(id); reject(Error('RPC_TIMEOUT:'+method));}, 120000);
  pending.set(id, {resolve,reject,timer}); child.send({type:'craftmine-headless',id,method,...fields});
});
async function until(read, accept) {
  while(!abort.signal.aborted) {
    if(ended) throw Error('DESKTOP_EXITED');
    try {const value = await read(); if(accept(value)) return value;}
    catch(error) {if(!/Window is not ready|Actual Godot host unavailable|No world runtime is running|World view is not ready|WORLD_BUSY|GODOT_CANDIDATE_ACTIVE|GODOT_VIEW_CAPTURE_BUSY/.test(String(error))) throw error;}
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
  await until(()=>rpc('godotSnapshot'),Boolean);
  await until(()=>rpc('worldNavigationReady'),value=>value.worldId===worldId&&value.ready);
  return until(()=>rpc('godotSnapshot'),value=>value?.worldId===worldId);
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
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId,...payload}});
const pkg=(method,params={})=>panel('package.request',{method,params:{worldId,...params}});
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
async function workbench(){
  const layout=await evaluate(`JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1'))`);
  if(layout?.mode==='play'){
    if(layout.overlay!=='full')await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',code:'F2',shiftKey:true,bubbles:true,cancelable:true}));true`);
    await until(()=>evaluate(`!!document.querySelector('[data-craftmine-layout] form')`),Boolean);
    await submit('[data-craftmine-layout] form');
  }
  await until(()=>evaluate(`!!document.querySelector('[data-world-assets-open]')`),Boolean);
}
async function assets(tab='browse'){
  await workbench();
  if(!await evaluate(`!!document.querySelector('[data-asset-sheet]')`))await submit('[data-world-assets-open]');
  await until(()=>evaluate(`!!document.querySelector('[data-library-tab="${tab}"]')`),Boolean);
  await submit(`[data-library-tab="${tab}"]`);
  if(tab!=='browse')await until(()=>evaluate(`!!document.querySelector('[data-library-publish="${tab}"]')`),Boolean);
  const bounds=await evaluate(`(()=>{const sheet=document.querySelector('[data-asset-sheet]'),rect=sheet.getBoundingClientRect();return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,bodyLevel:sheet.parentElement===document.body};})()`);
  assert(bounds.bodyLevel&&bounds.width>bounds.viewportWidth*0.6&&bounds.height>bounds.viewportHeight*0.6&&bounds.left>=0&&bounds.top>=0,'ASSET_SHEET_CLIPPED:'+JSON.stringify(bounds));
  report.sheetBounds??=[];report.sheetBounds.push(bounds);save();
}
async function closeAssets(){if(await evaluate(`!!document.querySelector('[data-asset-close-form]')`))await submit('[data-asset-close-form]');await until(()=>evaluate(`!document.querySelector('[data-asset-sheet]')`),Boolean);}
async function capture(name){
 const state=await until(()=>rpc('godotCaptureBoundState'),Boolean);assert.equal(state.formal?.worldId,worldId);
 const frame=await until(async()=>{try{return await rpc('godotCaptureBoundView',{payload:state.formal});}catch(error){if(String(error).includes('GODOT_VIEW_CAPTURE_DETACHED'))return null;throw error;}},Boolean);assert.equal(frame.worldId,worldId);assert.equal(frame.scope,'formal');
 const bytes=Buffer.from(frame.pngBase64,'base64');assert(bytes.length>1000);const file=path.join(out,name+'-'+report.launches.length+'-'+randomUUID()+'.png');fs.writeFileSync(file,bytes,{flag:'wx'});
 const proof={file,worldId,buildId:frame.buildId,sha256:createHash('sha256').update(bytes).digest('hex'),width:frame.width,height:frame.height};save();return proof;
}
async function look(pitch){
 await panel('godot.runtimeResume');const observation=await rpc('godotObserve');
 const input={worldId,buildId:observation.buildId,instanceId:observation.instanceId,steps:[{op:'look',args:{yaw:0,pitch}}]};
 const receipt=await rpc('godotExplore',{payload:input});report.viewActions??=[];report.viewActions.push({input,receipt});save();
}
async function selectAsset(assetId){
 await assets();await field('[data-filter="scope"]','local-library');await field('[data-filter="query"]',assetId);
 await evaluate(`document.querySelector('[data-filter="query"]').closest('form').requestSubmit();true`);
 await until(()=>evaluate(`!!document.querySelector('[data-asset-id="${assetId}"]')`),Boolean);
 await evaluate(`document.querySelector('[data-asset-id="${assetId}"]').closest('form').requestSubmit();true`);
 await until(()=>evaluate(`!!document.querySelector('[data-direct-use="${assetId}"]')`),Boolean);
}
async function startDirect(assetId,position){
 await selectAsset(assetId);
 await until(async()=>{const r=await evaluate(`({ready:!!document.querySelector('[data-direct-start-form]'),error:document.querySelector('[data-direct-use] [role="alert"], [data-direct-unavailable]')?.textContent})`);if(r.error)throw Error(r.error);return r.ready;},Boolean);
 await field('[data-direct-custom-position]',true);for(const [axis,value]of Object.entries(position))await field(`[data-direct-position-axis="${axis}"]`,String(value));
 const existing=await evaluate(`Array.from(document.querySelectorAll('[data-direct-operation]'),x=>x.dataset.directOperation)`);
 const started=performance.now();await submit('[data-direct-start-form]');
 const id=await until(()=>evaluate(`Array.from(document.querySelectorAll('[data-direct-operation]'),x=>x.dataset.directOperation).find(id=>!${JSON.stringify(existing)}.includes(id))`),Boolean);
 const row={worldId,operationId:id,assetId,position,startedAt:new Date().toISOString()};report.operations.push(row);save();
 // Close/reopen through actual forms while the durable native job is running.
 await closeAssets();await assets();
 const op=()=>nav('library.direct',{action:'status',worldId,operationId:id});
 row.ready=await until(op,r=>['ready','failed','cancelled','interrupted'].includes(r.status));assert.equal(row.ready.status,'ready',JSON.stringify(row.ready));row.prepareMs=performance.now()-started;
 await until(()=>evaluate(`document.querySelector('[data-direct-operation="${id}"]')?.dataset.directStatus==='ready'`),Boolean);
 row.renderer=await rpc('capture',{name:'direct-ready-'+report.operations.length});save();return row;
}
async function applyDirect(row){
 const started=performance.now();await submit(`[data-direct-operation="${row.operationId}"] [data-direct-action="apply"]`);
 row.applied=await until(()=>nav('library.direct',{action:'status',worldId,operationId:row.operationId}),r=>['applied','failed','cancelled'].includes(r.status));
 assert.equal(row.applied.status,'applied',JSON.stringify(row.applied));assert.equal(row.applied.modelCalls,0);row.applyMs=performance.now()-started;
 const repeated=await nav('library.direct',{action:'start',worldId,operationId:row.operationId,ref:row.applied.ref,position:row.position});assert.deepEqual(repeated.instanceIds,row.applied.instanceIds);assert.equal(repeated.status,'applied');
 await closeAssets();row.snapshot=await rpc('godotSnapshot');await look(-0.45);row.capture=await capture('direct-'+report.operations.length);save();
}

// Invoke the actual component handlers in the actual PI renderer, never a
// replacement test editor. Ordinary creation uses the session created by the
// New World form and the host's pinned target/source/check/adoption pipeline.
const button=(label,scope='.creation-target-context')=>evaluate(`(()=>{const button=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(n=>n.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('BUTTON_UNAVAILABLE:'+${JSON.stringify(label)});const props=button[Object.keys(button).find(k=>k.startsWith('__reactProps$'))];if(typeof props?.onClick!=='function')throw Error('BUTTON_HANDLER_REQUIRED');props.onClick();return true;})()`);
async function desktopInvoke(name,payload){
 return evaluate(`(async()=>{const api=globalThis.piDesktop;const result=await api.invoke(api.channels.invoke[${JSON.stringify(name)}],${JSON.stringify(payload)});if(!result?.ok)throw Error(result?.error?.message??'DESKTOP_READ_FAILED');return result.data;})()`);
}
async function modelEvidence(label){
 const sessions=await desktopInvoke('sessionList',{});const rows=[];
 for(const session of sessions.sessions){
  const detail=await desktopInvoke('sessionGet',{id:session.id}),messages=detail.session?.messages;assert(Array.isArray(messages));
  const metrics=[];
  // Read every persisted message's owning turn, rather than assuming latest
  // metrics prove anything about earlier edits. Empty new sessions have no turn.
  for(const message of messages){const result=await desktopInvoke('sessionTurnMetrics',{sessionId:session.id,messageId:message.id});if(result&&!metrics.some(m=>m.turnId===result.turnId)){assert.equal(result.calls.observed,0,'NO_MODEL_CALLS_IN_ORDINARY_DIRECT_FLOW');metrics.push(result);}}
  if(messages.length)assert(metrics.length>0,'NONEMPTY_SESSION_REQUIRES_TURN_EVIDENCE');
  rows.push({sessionId:session.id,messageCount:messages.length,metrics});
 }
 assert(rows.length>0,'ORDINARY_WORLD_FORM_SESSION_REQUIRED');report.modelEvidence??=[];report.modelEvidence.push({label,profile,rows});save();
}
async function refreshTarget(){
 await button('更新指向');
 await until(()=>evaluate(`document.querySelector('[data-creation-target]')?.dataset.creationTarget`),value=>value&&value!=='loading');
}
async function aimGround(){
  await workbench();await panel('godot.runtimeResume');
  if(!await evaluate(`!!document.querySelector('[data-world-session]')`)){
   await until(()=>evaluate(`!!document.querySelector('[data-world-start-creation]')`),Boolean);
   await submit('[data-world-start-creation]');
   await until(()=>evaluate(`!!document.querySelector('[data-world-session]')`),Boolean);
  }
  await until(()=>evaluate(`!!document.querySelector('.creation-target-context')`),Boolean);
  await until(()=>evaluate(`document.querySelector('[data-creation-target]')?.dataset.creationTarget`),value=>value&&value!=='loading');
  await refreshTarget();
  if(await evaluate(`Array.from(document.querySelectorAll('.creation-object-editor button')).some(n=>n.textContent==='更新世界观察组件并检查'&&!n.disabled)`)){
   report.observerBefore=await rpc('godotObserve');await button('更新世界观察组件并检查');await waitEdit('Ordinary previous sampler upgrade');report.observerAfter=await rpc('godotObserve');save();
  }
 for(const yaw of [.65,-.65,1.1,-1.1,2,-2]){
  const observed=await rpc('godotObserve');
  await rpc('godotExplore',{payload:{worldId,buildId:observed.buildId,instanceId:observed.instanceId,steps:[{op:'look',args:{yaw,pitch:-.45}}]}});
  const sample=await rpc('godotObserve');if(sample.payload.creation.target.surface==='ground'){await refreshTarget();return sample;}
 }
 throw Error('NO_ACTUAL_GROUND_TARGET');
}
async function waitEdit(label){
 const terminal=await until(()=>evaluate(`({status:document.querySelector('.creation-object-editor [role="status"]')?.textContent,error:document.querySelector('.creation-object-editor [role="alert"]')?.textContent})`),value=>{
  if(value.error||/编辑未完成|待核对|failed|interrupted/.test(value.status??''))throw Error(JSON.stringify(value));
  return /编辑已应用|^applied$/.test(value.status??'');
 });
 await until(()=>rpc('worldNavigationReady'),value=>value.worldId===worldId&&value.ready);
 report.edits??=[];report.edits.push({label,terminal,observation:await rpc('godotObserve')});await modelEvidence(label);save();return report.edits.at(-1).observation;
}
const visualEditing=process.argv.includes('--visual-edit');
async function selectEditedTree(id){
 await until(()=>evaluate(`Array.from(document.querySelectorAll('.creation-recent-results button'),n=>({title:n.title,disabled:n.disabled,text:n.textContent})).find(n=>n.title===${JSON.stringify(id)}&&!n.disabled)`),Boolean);
 const label=await evaluate(`Array.from(document.querySelectorAll('.creation-recent-results button')).find(n=>n.title===${JSON.stringify(id)}).textContent`);
 await button(label,'.creation-recent-results');
 await until(()=>evaluate(`Array.from(document.querySelectorAll('.creation-object-editor button')).some(n=>n.textContent==='编辑对象'&&!n.disabled)`),Boolean);
 await button('编辑对象');await until(()=>evaluate(`!!document.querySelector('[aria-label="尺寸 X"]')`),Boolean);
}
function previewPixels(beforeFile,afterFile){
 const require=createRequire(import.meta.url);let PNG;try{({PNG}=require('pngjs'));}catch{({PNG}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs')));}
 const before=PNG.sync.read(fs.readFileSync(beforeFile)),after=PNG.sync.read(fs.readFileSync(afterFile));assert.equal(after.width,before.width);assert.equal(after.height,before.height);
 let cyanChanged=0;for(let i=0;i<after.data.length;i+=4){const b=before.data,a=after.data;if(a[i]+10<b[i]&&a[i+1]>b[i+1]+10&&a[i+2]>b[i+2]+15)cyanChanged++;}return cyanChanged;
}
async function previewVisible(){
 return until(()=>evaluate(`({statuses:Array.from(document.querySelectorAll('.creation-object-editor [role="status"]'),n=>n.textContent),notes:document.querySelector('.creation-object-editor')?.innerText})`),value=>{if(value.statuses.some(t=>/当前世界暂不支持预览|预览位置存在/.test(t)))throw Error('PREVIEW_UNAVAILABLE:'+value.notes);return value.statuses.includes('预览位置可用');});
}
async function previewAndCancel(label){
 const beforeFrame=await capture(label+'-baseline');
 // The actual preview button pauses the runtime. Close this first preview so
 // the snapshot baseline and later preview share that ordinary paused state.
 await button('预览摆放');await previewVisible();
 await button('关闭预览');await until(()=>evaluate(`!Array.from(document.querySelectorAll('.creation-object-editor button')).some(n=>n.textContent==='关闭预览')`),Boolean);
 const before=completeCreationProgress(await rpc('godotSnapshot'));
 await button('预览摆放');await previewVisible();
 const deadline=performance.now()+10000;const visible=await until(async()=>{
  const frame=await capture(label+'-visible'),changedPixels=previewPixels(beforeFrame.file,frame.file);report.visualFrameAttempts??=[];report.visualFrameAttempts.push({label,frame,changedPixels});save();
  if(changedPixels<256&&performance.now()>deadline)throw Error('NATIVE_PREVIEW_PIXELS_NOT_VISIBLE:'+JSON.stringify({label,changedPixels,frame}));return {frame,changedPixels};
 },v=>v.changedPixels>=256);const frame=visible.frame;await button('关闭预览');
 await until(()=>evaluate(`!Array.from(document.querySelectorAll('.creation-object-editor button')).some(n=>n.textContent==='关闭预览')`),Boolean);
 const after=completeCreationProgress(await rpc('godotSnapshot'));assert.deepEqual(after,before,'PREVIEW_CANCEL_PRESERVES_COMPLETE_PROGRESS');
 report.visualPreviews??=[];report.visualPreviews.push({label,frame,beforeFrame,changedPixels:visible.changedPixels,before,after});save();
}
async function startAndWaitEdit(label){
 await button('检查并应用');await until(()=>evaluate(`document.querySelector('.creation-object-editor [role="status"]')?.textContent`),s=>!/编辑已应用|^applied$/.test(s??''));return waitEdit(label);
}
async function placeAndEdit(){
 report.ground=await aimGround();await button('在此放置');
 await until(()=>evaluate(`!!document.querySelector('[aria-label="放置类型"]')`),Boolean);
 await field('[aria-label="放置类型"]','tree');if(visualEditing)await previewAndCancel('placement-preview');await button('放置并检查');
 const placed=await waitEdit('Actual Place here tree');const tree=placed.payload.creation.entities.find(e=>e.kind==='tree');assert(tree,'ACTUAL_PLACEMENT_REQUIRED');report.editedEntityId=tree.id;
 await selectEditedTree(tree.id);
 let transformedPosition;
 if(visualEditing){
  transformedPosition=tree.position.map((n,i)=>i===0?n+.5:n);assert(transformedPosition[0]<27,'NATIVE_TEST_MOVE_WITHIN_WORLD');
  await field('[aria-label="位置 X"]',String(transformedPosition[0]));await field('[aria-label="朝向角度"]','45');
  await previewAndCancel('move-rotation-preview');
  const moved=await startAndWaitEdit('Actual move and yaw edit');const movedTree=moved.payload.creation.entities.find(e=>e.id===tree.id);
  assert.deepEqual(movedTree.position,transformedPosition);assert(Math.abs(movedTree.rotationY-45)<.005);
  await refreshTarget();await button('撤销上次操作');await until(()=>evaluate(`document.querySelector('.creation-object-editor [role="status"]')?.textContent`),s=>!/编辑已应用|^applied$/.test(s??''));
  const undone=await waitEdit('Actual transform undo');const original=undone.payload.creation.entities.find(e=>e.id===tree.id);
  assert.deepEqual(original.position,tree.position);assert(Math.abs(original.rotationY-tree.rotationY)<.005);
  report.visualTransformUndo={before:tree,moved:movedTree,restored:original};save();await selectEditedTree(tree.id);
  await field('[aria-label="位置 X"]',String(transformedPosition[0]));await field('[aria-label="朝向角度"]','45');
 }
 for(const axis of ['X','Y','Z'])await field(`[aria-label="尺寸 ${axis}"]`,'1.25');
 await field('[aria-label="对象颜色"]','#88bb44');await button('检查并应用');
 // Wait until the existing applied status has actually transitioned away.
 await until(()=>evaluate(`document.querySelector('.creation-object-editor [role="status"]')?.textContent`),s=>!/编辑已应用|^applied$/.test(s??''));
 const modified=await waitEdit('Actual scale and color edit');const actual=modified.payload.creation.entities.find(e=>e.id===tree.id);
 assert(actual.scale.every(n=>Math.abs(n-1.25)<.00001)&&actual.color==='#88bb44');if(visualEditing){assert.deepEqual(actual.position,transformedPosition);assert(Math.abs(actual.rotationY-45)<.005);}
 report.editedEntity=actual;report.editorCapture=await rpc('capture',{name:'ordinary-edited-tree'});report.editCapture=await capture('edited-world');save();
}
async function publishWorld(){
 await frameContents('author-template-content');
 await assets('world');await until(()=>evaluate(`!document.querySelector('[data-library-publish-form] fieldset').disabled`),Boolean);
 await field('[data-publication-name]','我的首次创作');await field('[data-publication-description]','素材库伙伴与亲手放置、修改的树。');
 await field('[data-publication-tags]','伙伴,树,首次创作');await field('[data-publication-aliases]','首次创作完整闭环');await field('[data-publication-checkpoint]',true);
 await submit('[data-library-publish-form]');
 const assetId=await until(async()=>{await failIfError();return evaluate(`document.querySelector('[data-publication-result]')?.getAttribute('data-publication-result')`);},Boolean);
 const card=(await nav('asset.search',{ownerWorldId:worldId,scope:'local-library',query:'首次创作完整闭环',latestOnly:true,offset:0,limit:50})).items.find(row=>row.assetId===assetId);assert(card);
 report.templateRef={assetId,version:card.version,contentHash:card.contentHash};await closeAssets();
 await chooser('templates');await until(()=>evaluate(`!!document.querySelector('[data-local-template="${assetId}"]')`),Boolean);await submit(`[data-local-template="${assetId}"]`);
 await until(()=>evaluate(`!!document.querySelector('[data-local-template-selected="${assetId}"]')`),Boolean);await submit('[data-template-export]');
 const picker=path.join(out,'player-world-template.zip');await until(async()=>{await failIfError();return fs.existsSync(picker);},Boolean);
 const bytes=fs.readFileSync(picker);report.templateArchive={path:picker,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};save();
}
async function importWorld(){
 await chooser('templates');await submit('[data-template-import]');
 await until(async()=>{await failIfError();return evaluate(`!!document.querySelector('[data-local-template-selected="${report.templateRef.assetId}"]')`);},Boolean);
 await field('[data-template-world-title]','独立玩家导入首次创作');await submit('[data-local-template-create]');
 await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);
 worldId=(await nav('world.list')).activeWorldId;assert.notEqual(worldId,report.authorWorldId);await waitWorld(worldId);report.importedWorldId=worldId;
}
async function assertContents(label){
 const observed=await rpc('godotObserve'),snapshot=await rpc('godotSnapshot');
 const tree=observed.payload.creation.entities.find(e=>e.id===report.editedEntityId);
 assert(tree&&tree.color==='#88bb44'&&tree.scale.every(n=>Math.abs(n-1.25)<.00001));if(visualEditing){assert.deepEqual(tree.position,report.editedEntity.position);assert(Math.abs(tree.rotationY-report.editedEntity.rotationY)<.005);}
 const components=Object.keys(snapshot.state.body.components);assert(components.includes(report.companionEntityId));
 assert.deepEqual(snapshot.state.body.inventory,report.initialSnapshot.state.body.inventory);
 assert.deepEqual(snapshot.state.body.openedChests,report.initialSnapshot.state.body.openedChests);
 report.retention??=[];report.retention.push({label,profile,worldId,observed,snapshot});save();
}
async function play(){
 await panel('godot.runtimeResume');const observed=await rpc('godotObserve');
 const receipt=await rpc('godotExplore',{payload:{worldId,buildId:observed.buildId,instanceId:observed.instanceId,steps:[{op:'look',args:{yaw:2,pitch:-.3}},{op:'walk',args:{forward:1,right:0,frames:18}}]}});
 report.play={receipt,before:observed,after:await rpc('godotObserve')};assert.notDeepEqual(report.play.before.payload.player.position,report.play.after.payload.player.position);report.playCapture=await frameContents('imported-playing-content');save();
}
async function frameContents(label){
 await closeAssets();await until(()=>rpc('worldNavigationReady'),value=>value.worldId===worldId&&value.ready);await until(()=>panel('godot.runtimeResume'),()=>true);
 const before=await rpc('godotObserve'),tree=before.payload.creation.entities.find(e=>e.id===report.editedEntityId);assert(tree?.meshBounds,'ACTUAL_TREE_BOUNDS_REQUIRED');
 const actions=[],player=before.payload.player.position,dx=tree.position[0]-player[0],dz=tree.position[2]-player[2],yaw=Math.atan2(-dx,-dz);
 // Native player movement gives the tall tree and following companion room
 // in the stock camera. Its horizontal/vertical FOV depends on viewport aspect;
 // do not assume the configured 75 degrees is the vertical field of view.
 {
  const input={worldId,buildId:before.buildId,instanceId:before.instanceId,steps:[{op:'look',args:{yaw,pitch:-.15}},{op:'walk',args:{forward:-1,right:0,frames:Math.hypot(dx,dz)<12?120:60}}]};
  actions.push({input,receipt:await rpc('godotExplore',{payload:input})});
 }
 const sample=await rpc('godotObserve'),snapshot=await rpc('godotSnapshot'),pet=snapshot.state.body.components[report.companionEntityId];assert(pet?.format==='craftmine.pet-companion-state/1'&&Array.isArray(pet.position),'ACTUAL_COMPANION_POSITION_REQUIRED');
 const actualTree=sample.payload.creation.entities.find(e=>e.id===report.editedEntityId),eye=sample.payload.player.position;
 const midpoint=[(actualTree.position[0]+pet.position[0])/2,(actualTree.position[1]+pet.position[1])/2+.65,(actualTree.position[2]+pet.position[2])/2];
 const mx=midpoint[0]-eye[0],mz=midpoint[2]-eye[2],eyeHeight=sample.payload.controllerEvidence.cameraTransform.rigPosition[1];
 const eyeY=eye[1]+eyeHeight,bounds=actualTree.meshBounds;
 const treeDistance=Math.max(.1,Math.hypot(Math.max(bounds.min[0]-eye[0],0,eye[0]-bounds.max[0]),Math.max(bounds.min[2]-eye[2],0,eye[2]-bounds.max[2])));
 const petDistance=Math.max(.1,Math.hypot(pet.position[0]-eye[0],pet.position[2]-eye[2]));
 const verticalBounds={top:Math.atan2(bounds.max[1]-eyeY,treeDistance),bottom:Math.atan2(pet.position[1]-eyeY,petDistance)};
 const angles={yaw:Math.atan2(-mx,-mz),pitch:(verticalBounds.top+verticalBounds.bottom)/2};
 const input={worldId,buildId:sample.buildId,instanceId:sample.instanceId,steps:[{op:'look',args:angles}]};actions.push({input,receipt:await rpc('godotExplore',{payload:input})});
 const frame=await capture(label);report.framing??=[];report.framing.push({label,worldId,treeId:actualTree.id,treeBounds:actualTree.meshBounds,companionEntityId:pet.entityId,companionPosition:pet.position,midpoint,verticalBounds,angles,actions,frame});save();return frame;
}
try{
 console.log(JSON.stringify({out,cancel:cancelFile}));
 if(framesOnly){
  report.framingOnly=true;report.fullJourneyReexecuted=false;await start('frame-author');worldId=report.authorWorldId;await openExistingWorld(worldId);await frameContents('author-content-review');await stop();
  profile=path.join(out,'independent-profile');await start('frame-import');worldId=report.importedWorldId;await openExistingWorld(worldId);await frameContents('imported-content-review');
  report.passed=true;report.framingPassed=true;
 }else{
 await start('author');
 if(previous){worldId=report.authorWorldId;await openExistingWorld(worldId);}
 else{worldId=await createWorld('我的首次自主创作');report.authorWorldId=worldId;report.initialSnapshot=await rpc('godotSnapshot');
 const companion=await startDirect('cw.module.approved-pomeranian',{x:-2,y:0,z:4.3});await applyDirect(companion);}
 mark('Actual catalog companion directly installed without AI');
 const installedSource=await pkg('sourceList'),componentIds=Object.keys(report.operations[0].snapshot.state.body.components);
 assert.equal(componentIds.length,1,'ONE_ACTUAL_COMPANION_STATE_REQUIRED');
 const installedComponent=installedSource.items.find(row=>row.entityId===componentIds[0]);assert(installedComponent?.supported,'FORMAL_COMPONENT_DECLARATION_REQUIRED');
 report.companionEntityId=installedComponent.entityId;report.companionSource=installedComponent;save();
 if(!previous){
  const sessionId=await evaluate(`document.querySelector('[data-world-session]')?.dataset.worldSession`);assert(sessionId,'NEW_WORLD_OWNS_REAL_EMPTY_CONVERSATION');
  const detail=await desktopInvoke('sessionGet',{id:sessionId});assert.equal(detail.session.messages.length,0,'DIRECT_LIBRARY_USE_MUST_NOT_FABRICATE_AUTHOR_TURNS');
  await stop();await start('zero-turn-cold');await openExistingWorld(worldId);await workbench();
  const restored=await until(()=>evaluate(`document.querySelector('[data-world-session]')?.dataset.worldSession`),Boolean);assert.equal(restored,sessionId,'ZERO_TURN_WORLD_RESTORES_SAME_CONVERSATION');
  const restoredDetail=await desktopInvoke('sessionGet',{id:restored});assert.equal(restoredDetail.session.messages.length,0,'ZERO_TURN_REOPEN_MUST_KEEP_CONVERSATION_EMPTY');
  await until(()=>evaluate(`!!document.querySelector('[data-creation-target]')`),Boolean);
  report.zeroTurnReopen={sessionId,restored,worldId,messages:restoredDetail.session.messages.length,creationEditorVisible:true};await modelEvidence('zero-turn-cold-reopen');save();
 }
 if(!previous?.editedEntity)await placeAndEdit();await modelEvidence('author-after-edit');
 await panel('godot.runtimeSave',{freeze:false});await assertContents('author-saved');await stop();
 await start('author-cold');await openExistingWorld(worldId);await assertContents('author-cold-reopen');
 await publishWorld();await modelEvidence('author-after-publish');await stop();
 report.authorProfile=profile;profile=path.join(out,'independent-profile');fs.mkdirSync(profile);
 const legacySource=path.join(out,'independent-legacy');fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
 await start('independent-import');assert.deepEqual((await nav('world.list')).worlds,[],'INDEPENDENT_PROFILE_MUST_START_EMPTY');
 await importWorld();await assertContents('independent-import');await play();await panel('godot.runtimeSave',{freeze:false});await modelEvidence('independent-after-play');await stop();
 await start('independent-cold');await openExistingWorld(worldId);await assertContents('independent-cold-reopen');await modelEvidence('independent-cold');
 report.modelCalls=0;report.passed=true;mark('Real catalog use, ordinary supported edit, save, template export/import, gameplay and both cold reopens passed');
 }
}catch(error){report.passed=false;report.error=String(error.stack??error);process.exitCode=1;try{report.failurePage=await evaluate(`({text:document.body.innerText.slice(-12000),notes:Array.from(document.querySelectorAll('.creation-target-note'),n=>({text:n.textContent,title:n.title})),buttons:Array.from(document.querySelectorAll('.creation-target-context button'),n=>({text:n.textContent,disabled:n.disabled})),layout:localStorage.getItem('craftmine.desktop.layout.v1')})`);}catch{} }
finally{
 try{await stop();}catch(error){report.passed=false;report.shutdownError=String(error);process.exitCode=1;}
 try{launch.assertUnchanged();}catch(error){report.passed=false;report.integrityError=String(error);process.exitCode=1;}
 clearInterval(watcher);save();
}
console.log(JSON.stringify({passed:report.passed===true,report:reportFile,error:report.error,shutdownError:report.shutdownError,integrityError:report.integrityError}));
