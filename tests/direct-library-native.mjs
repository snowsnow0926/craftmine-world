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
import {unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';

const [applicationRoot,resources]=process.argv.slice(2);
assert(applicationRoot&&resources&&[applicationRoot,resources].every(path.isAbsolute),'ABSOLUTE_CHECKOUT_AND_RUNTIME_REQUIRED');
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/desktop-native-direct-library-'));const profile=path.join(out,'profile'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(path.join(out,'legacy'));fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:path.join(out,'legacy')}));
const launch=resolveCreationNativeLaunch({root:applicationRoot,inherited:process.env});
const report={format:'craftmine.direct-library-native/1',out,applicationRoot,resources,buildMainSha256:createHash('sha256').update(launch.main).digest('hex'),modelCalls:0,launches:[],worlds:[],operations:[],steps:[],limits:['One fresh isolated developer-machine profile; external clean Windows and human acceptance pending.','Actual PI forms and offscreen native checks; no physical input or Pointer Lock.']};
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
  if(layout.mode==='play'){
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
 const state=await rpc('godotCaptureBoundState');assert.equal(state.formal?.worldId,worldId);
 const frame=await until(async()=>{try{return await rpc('godotCaptureBoundView',{payload:state.formal});}catch(error){if(String(error).includes('GODOT_VIEW_CAPTURE_DETACHED'))return null;throw error;}},Boolean);assert.equal(frame.worldId,worldId);assert.equal(frame.scope,'formal');
 const bytes=Buffer.from(frame.pngBase64,'base64');assert(bytes.length>1000);const file=path.join(out,name+'-'+report.launches.length+'.png');fs.writeFileSync(file,bytes);
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
try{
 console.log(JSON.stringify({out,cancel:path.join(out,'cancel')}));await start('first');
 worldId=await createWorld('My first library world');report.before=await rpc('godotObserve');report.initialSource=await pkg('sourceList');report.initialSnapshot=await rpc('godotSnapshot');
 mark('Fresh client created a blank world through the ordinary PI form');
 const first=await startDirect('cw.module.approved-pomeranian',{x:-2,y:0,z:4.3});await applyDirect(first);mark('First exact companion checked and formally added with no AI');
 const second=await startDirect('cw.module.approved-pomeranian',{x:2,y:0,z:4.3});await applyDirect(second);mark('Second companion received a distinct instance without duplicate retry');
 assert(first.applied.instanceIds.length>0&&second.applied.instanceIds.length>0);assert(!first.applied.instanceIds.some(id=>second.applied.instanceIds.includes(id)));
 report.source=await pkg('sourceList');assert(report.source.items.filter(row=>row.supported).length>=2);
 report.after=await rpc('godotObserve');report.finalSave=await panel('godot.runtimeSave',{freeze:false});report.saved=await rpc('godotSnapshot');
 report.guards=await rpc('guards');
 await stop();await start('reopen');await openExistingWorld(worldId);report.reopened=await rpc('godotObserve');report.reopenedSnapshot=await rpc('godotSnapshot');
 assert.equal(report.reopened.buildId,report.after.buildId);assert.notEqual(report.reopened.instanceId,report.after.instanceId);
 report.reopenedSource=await pkg('sourceList');assert.deepEqual(report.reopenedSource.items.map(x=>x.entityId).sort(),report.source.items.map(x=>x.entityId).sort());
 for(const row of report.operations){row.coldStatus=await nav('library.direct',{action:'status',worldId,operationId:row.operationId});assert.equal(row.coldStatus.status,'applied');assert.deepEqual(row.coldStatus.instanceIds,row.applied.instanceIds);}
 await assets();await until(()=>evaluate(`document.querySelectorAll('[data-direct-operation][data-direct-status="applied"]').length`),n=>n===2);await closeAssets();await look(-0.45);report.reopenedCapture=await capture('direct-reopened');
 const body=report.reopenedSnapshot.state.body;assert.deepEqual(body.inventory,report.initialSnapshot.state.body.inventory);assert.deepEqual(body.openedChests,report.initialSnapshot.state.body.openedChests);assert.deepEqual(Object.keys(body.components).sort(),report.source.items.map(x=>x.entityId).sort());
 const proof=[];function scan(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){if(item.isSymbolicLink())continue;const file=path.join(directory,item.name);if(item.isDirectory())scan(file);else if(item.name==='model.glb'||item.name==='player_controller.gd')proof.push({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
 scan(path.join(profile,'plugins/data/craftmine.world/godot-builds'));report.bytes=proof;
 const models=proof.filter(x=>x.file.endsWith('.glb'));assert(models.length>=2&&models.every(x=>x.sha256==='1ab9f354598df75504b061fb06e1e5e386bd59c878afcec3bad8388832dadd0b'));
 assert.equal(new Set(proof.filter(x=>x.file.endsWith('player_controller.gd')).map(x=>x.sha256)).size,1);
 mark('Cold reopen retained formal build, both instances and durable operation history');
 await selectAsset('cw.model.approved-pomeranian');await until(()=>evaluate(`!!document.querySelector('[data-direct-unavailable]')`),Boolean);
 assert.equal(await evaluate(`!!document.querySelector('[data-direct-start-form]')`),false);assert.equal(await evaluate(`!!document.querySelector('[data-asset-use="add"]')`),true);
 const rawCard=(await nav('asset.search',{ownerWorldId:worldId,scope:'local-library',query:'cw.model.approved-pomeranian',latestOnly:true,offset:0,limit:50})).items.find(x=>x.assetId==='cw.model.approved-pomeranian');
 report.rawRef={assetId:rawCard.assetId,version:rawCard.version,contentHash:rawCard.contentHash};report.rawInspection=await nav('library.direct',{action:'inspect',worldId,ref:report.rawRef});assert.equal(report.rawInspection.eligible,false);await closeAssets();
 const retainedWorld=worldId;await createWorld('Cancellation test world');await selectAsset('cw.nature.tree-oak');
 await until(()=>evaluate(`!!document.querySelector('[data-direct-start-form]')`),Boolean);
 await submit('[data-direct-start-form]');const cancelledId=await until(()=>evaluate(`document.querySelector('[data-direct-operation]')?.dataset.directOperation`),Boolean);
 const cancelled={worldId,operationId:cancelledId,assetId:'cw.nature.tree-oak',test:'cancel-just-submitted'};report.operations.push(cancelled);save();
 await submit(`[data-direct-operation="${cancelledId}"] [data-direct-action="cancel"]`);
 cancelled.result=await until(()=>nav('library.direct',{action:'status',worldId,operationId:cancelledId}),r=>['cancelled','failed','applied'].includes(r.status));assert.equal(cancelled.result.status,'cancelled',JSON.stringify(cancelled.result));
 await closeAssets();cancelled.formalSnapshot=await rpc('godotSnapshot');assert.deepEqual(Object.keys(cancelled.formalSnapshot.state.body.components),[]);
 await openExistingWorld(retainedWorld);worldId=retainedWorld;assert.equal((await rpc('godotObserve')).buildId,report.after.buildId);
 await assert.rejects(nav('library.direct',{action:'status',worldId,operationId:'missing-operation-id'}),error=>String(error).includes('DIRECT_LIBRARY_OPERATION_NOT_FOUND')&&!String(error).includes(profile));
 report.passed=true;mark('Just-submitted cancellation retained the empty formal world, and the original two-companion world stayed intact');
}catch(error){report.error=String(error.stack??error);process.exitCode=1;try{report.failurePage=await evaluate(`({text:document.body.innerText.slice(-7000),layout:localStorage.getItem('craftmine.desktop.layout.v1')})`);}catch{} }
finally{try{await stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;}clearInterval(watcher);save();launch.assertUnchanged();}
console.log(JSON.stringify({passed:report.passed===true,report:reportFile,error:report.error,shutdownError:report.shutdownError}));
