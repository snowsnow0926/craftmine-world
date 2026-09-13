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
const root=path.resolve(import.meta.dirname,'..');
const resultsRoot=path.resolve(process.env.CRAFTMINE_CREATION_OUTPUT_ROOT??path.join(root,'test-results'));fs.mkdirSync(resultsRoot,{recursive:true});
const out=fs.mkdtempSync(path.join(resultsRoot,'desktop-native-feedback-'));let profile=path.join(out,'author-profile');const token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(path.join(out,'legacy'));fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:path.join(out,'legacy')}));
const launch=resolveCreationNativeLaunch({root:applicationRoot,inherited:process.env});
const report={format:'craftmine.playtest-client-roundtrip/1',out,applicationRoot,resources,buildMainSha256:createHash('sha256').update(launch.main).digest('hex'),modelCalls:null,launches:[],worlds:[],operations:[],steps:[],limits:['Two fresh isolated developer-machine profiles; external clean Windows and human acceptance pending.','Actual PI forms and offscreen native checks; no physical input or Pointer Lock.','Repair action is a draft-only handoff. No actual AI repair or gameplay fix is claimed.']};
report.driverSha256=createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex');

report.packageIdentity=launch.identity?{inventorySha256:launch.identity.inventorySha256,mainSha256:launch.identity.mainSha256,version:launch.identity.version}:null;
const nativePaths=launch.packaged?{core:path.join(launch.packaged,'resources/bin/craftmine-core.exe'),host:path.join(launch.packaged,'resources/bin/pi-desktop-host-core.exe')}:{core:process.env.CRAFTMINE_EVAL_CORE??path.join(applicationRoot,'vendor/pi-desktop/target/release/craftmine-core.exe'),host:process.env.CRAFTMINE_EVAL_HOST??path.join(applicationRoot,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe')};
report.nativeBinaries=Object.fromEntries(Object.entries(nativePaths).map(([name,file])=>[name,{file:path.resolve(file),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}]));
const reportFile=path.join(out,'report.json'),save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
const abort=new AbortController(),pending=new Map();const cancelFile=path.join(out,'cancel');report.cancelFile=cancelFile;
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
    catch(error) {if(String(error).includes('PLAYER_UI_TERMINAL:')||!/Window is not ready|Actual Godot host unavailable|No world runtime is running|World view is not ready|WORLD_BUSY|GODOT_CANDIDATE_ACTIVE|GODOT_VIEW_CAPTURE_BUSY/.test(String(error))) throw error;}
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
async function failIfError(){const error=await evaluate(`document.querySelector('[data-world-entry-error], [data-library-publish] [role="alert"], [data-local-world-templates] [role="alert"], [data-playtest-panel] [role="alert"]')?.textContent`);if(error)throw Error('PLAYER_UI_TERMINAL:'+error);}
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
async function publishWorld(){
 await assets('world');await until(()=>evaluate(`!document.querySelector('[data-library-publish-form] fieldset').disabled`),Boolean);
 await field('[data-publication-name]','试玩反馈模板');await field('[data-publication-description]','原生示例世界，用于独立朋友试玩反馈。');
 await field('[data-publication-tags]','试玩,反馈');await field('[data-publication-aliases]','试玩反馈往返');await field('[data-publication-checkpoint]',true);
 await submit('[data-library-publish-form]');
 const assetId=await until(async()=>{await failIfError();return evaluate(`document.querySelector('[data-publication-result]')?.getAttribute('data-publication-result')`);},Boolean);
 const card=(await nav('asset.search',{ownerWorldId:worldId,scope:'local-library',query:'试玩反馈往返',latestOnly:true,offset:0,limit:50})).items.find(row=>row.assetId===assetId);assert(card);
 report.templateRef={assetId,version:card.version,contentHash:card.contentHash};await closeAssets();
 await chooser('templates');await until(()=>evaluate(`!!document.querySelector('[data-local-template="${assetId}"]')`),Boolean);await submit(`[data-local-template="${assetId}"]`);
 await until(()=>evaluate(`!!document.querySelector('[data-local-template-selected="${assetId}"]')`),Boolean);await submit('[data-template-export]');
 const picker=path.join(out,'player-world-template.zip');await until(async()=>{await failIfError();return fs.existsSync(picker);},Boolean);
 const bytes=fs.readFileSync(picker);report.templateArchive={path:picker,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};save();
}
async function importWorld(){
 await chooser('templates');await submit('[data-template-import]');
 await until(async()=>{await failIfError();return evaluate(`!!document.querySelector('[data-local-template-selected="${report.templateRef.assetId}"]')`);},Boolean);
 await field('[data-template-world-title]','朋友独立试玩世界');await submit('[data-local-template-create]');
 await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);
 worldId=(await nav('world.list')).activeWorldId;assert.notEqual(worldId,report.authorWorldId);await waitWorld(worldId);report.importedWorldId=worldId;
}

const feedbackPath=path.join(out,'player-feedback.json');
const feedbackCall=(channel,args={})=>nav(`playtest.${channel}`,{worldId,...args});
const press=selector=>evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled)throw Error('BUTTON_NOT_READY');const props=node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))];if(typeof props?.onClick!=='function')throw Error('ACTUAL_BUTTON_HANDLER_REQUIRED');props.onClick();return true;})()`);
async function feedbackOpen(){
 await assets();await until(()=>evaluate(`!!document.querySelector('[data-playtest-panel]')`),Boolean);
 await evaluate(`document.querySelector('[data-playtest-panel]').open=true;true`);
 await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-playtest-description]').disabled`);},Boolean);
}
async function feedbackPreview(description,expected,includeScreenshot){
 await field('[data-playtest-description]',description);await field('[data-playtest-expected]',expected);await field('[data-playtest-screenshot]',includeScreenshot);
 let before=await rpc('godotObserve');
 for(let attempt=0;;attempt++){
  await submit('[data-playtest-create]');
  try{await until(async()=>{await failIfError();return evaluate(`!!document.querySelector('[data-playtest-confirm]')`);},Boolean);break;}
  catch(error){
   if(attempt!==0||!String(error).includes('LIBRARY_PREVIEW_PREPARE_REQUIRED'))throw error;
   report.capturePreparationRetries??=[];report.capturePreparationRetries.push({worldId,at:new Date().toISOString(),error:String(error),action:'ordinary-close-and-reopen-library'});save();
   await closeAssets();await feedbackOpen();
   const retained=await evaluate(`({description:document.querySelector('[data-playtest-description]').value,expected:document.querySelector('[data-playtest-expected]').value,screenshot:document.querySelector('[data-playtest-screenshot]').checked})`);
   assert.deepEqual(retained,{description,expected,screenshot:includeScreenshot},'ORDINARY_REOPEN_RETAINS_UNSAVED_FEEDBACK');before=await rpc('godotObserve');
  }
 }
 const preview=await evaluate(`(()=>{const node=document.querySelector('[data-playtest-record]');return {id:node.dataset.playtestRecord,text:node.innerText,image:node.querySelector('img')?.getAttribute('src')??null};})()`);
 assert(preview.text.includes(description)&&preview.text.includes(expected),'REVIEWED_PLAYER_TEXT_REQUIRED');
 if(includeScreenshot){
  assert(preview.image?.startsWith('data:image/png;base64,'),'ACTUAL_SCREENSHOT_PREVIEW_REQUIRED');
  const bytes=Buffer.from(preview.image.slice('data:image/png;base64,'.length),'base64');assert(bytes.length>1000);
  const file=path.join(out,`reviewed-${preview.id}.png`);fs.writeFileSync(file,bytes,{flag:'wx'});
  preview.png={file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 }else assert.equal(preview.image,null);
 preview.renderer=await rpc('capture',{name:'feedback-reviewed-'+preview.id.slice(9,21)});
 return {...preview,expectedWorldId:worldId,expectedBuildId:before.buildId};
}
async function confirmExport(preview,label){
 // Exercise real autosave after preview. It must not recapture the image or
 // replace the report's timestamp, progress identity or reviewed player text.
 await nav('godot.runtimeSave',{worldId,freeze:false});
 await submit('[data-playtest-confirm]');
 await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-playtest-confirm]')`);},Boolean);
 const bytes=fs.readFileSync(feedbackPath),record=JSON.parse(bytes);assert.equal(record.id,preview.id);
 assert.equal(record.context.worldId,preview.expectedWorldId);assert.equal(record.context.buildId,preview.expectedBuildId);
 if(preview.png){assert.equal(record.screenshot.sha256,preview.png.sha256);assert.equal(record.screenshot.pngBase64,preview.image.slice('data:image/png;base64,'.length));}
 else assert.equal(record.screenshot,null);
 const file=path.join(out,label+'.json');fs.writeFileSync(file,bytes,{flag:'wx'});
 const persisted=await feedbackCall('read',{id:record.id});assert.deepEqual(persisted,record);
 report.feedback??=[];report.feedback.push({label,file,id:record.id,context:record.context,client:record.client,replyTo:record.replyTo,sha256:createHash('sha256').update(bytes).digest('hex'),reviewedPng:preview.png??null});save();return record;
}
async function importFeedback(expected){
 await feedbackOpen();const before=await feedbackCall('list');
 await submit('[data-playtest-import]');await until(async()=>{await failIfError();return evaluate(`!!document.querySelector('[data-playtest-confirm]')`);},Boolean);
 assert.equal(await evaluate(`document.querySelector('[data-playtest-record]').dataset.playtestRecord`),expected.id);
 assert.deepEqual(await feedbackCall('list'),before,'IMPORT_PREVIEW_MUST_NOT_PERSIST');
 await submit('[data-playtest-confirm]');await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-playtest-confirm]')`);},Boolean);
 assert.deepEqual(await feedbackCall('read',{id:expected.id}),expected);
 const after=await feedbackCall('list');assert.equal(after.items.filter(row=>row.id===expected.id).length,1);
 report.imports??=[];report.imports.push({profile,worldId,id:expected.id,before:before.items.length,after:after.items.length});save();
}
async function readThroughUi(expected){
 await feedbackOpen();await until(()=>evaluate(`!!document.querySelector('[data-playtest-open="${expected.id}"]')`),Boolean);
 await press(`[data-playtest-open="${expected.id}"]`);await until(()=>evaluate(`document.querySelector('[data-playtest-record]')?.dataset.playtestRecord`),id=>id===expected.id);
 assert.deepEqual(await feedbackCall('read',{id:expected.id}),expected);
}
async function reviewDraft(expected){
 await until(()=>evaluate(`!!document.querySelector('[data-playtest-repair]')`),Boolean);
 await press('[data-playtest-repair]');
 const draft=await until(async()=>{await failIfError();return evaluate(`document.querySelector('[contenteditable="true"][role="textbox"]')?.textContent??''`);},value=>value.includes(expected.id));
 assert(draft.includes(expected.context.worldId)&&draft.includes(expected.context.buildId));
 assert(/不可信玩家数据|untrusted player data/.test(draft));
 await modelEvidence('repair-handoff-draft-only');
 report.repairDraft={worldId,id:expected.id,characters:draft.length,submitted:false};save();
}
try{
 console.log(JSON.stringify({out,cancel:cancelFile}));
 await start('author-create');await chooser('examples');await submit('[data-world-example="promo-mainline"] form');
 await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);
 worldId=(await nav('world.list')).activeWorldId;report.authorWorldId=worldId;await waitWorld(worldId);
 await publishWorld();await modelEvidence('author-template-export');await stop();mark('Actual example saved and exported as a world template');
 const authorProfile=profile;profile=path.join(out,'friend-profile');fs.mkdirSync(profile);
 const legacySource=path.join(out,'friend-legacy');fs.mkdirSync(legacySource);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
 await start('friend-import');assert.deepEqual((await nav('world.list')).worlds,[]);await importWorld();report.friendWorldId=worldId;
 await feedbackOpen();const preview=await feedbackPreview('试玩时希望庭院入口更容易识别。','从出生点走向庭院，预期入口有清晰标记；请核对这一版本后再修改。',true);
 const original=await confirmExport(preview,'friend-original-feedback');await modelEvidence('friend-feedback-export');await stop();mark('Friend exported explicitly reviewed native PNG and actual world identity');
 const friendProfile=profile;profile=authorProfile;worldId=report.authorWorldId;await start('author-import-feedback');await openExistingWorld(worldId);
 await importFeedback(original);await importFeedback(original);await modelEvidence('author-import-no-model');await stop();
 await start('author-feedback-cold');await openExistingWorld(worldId);await readThroughUi(original);await reviewDraft(original);
 await readThroughUi(original);await press('[data-playtest-reply]');
 const replyPreview=await feedbackPreview('已收到试玩反馈，下一版会核对入口标记。','这是作者回复，尚未声称修复或通过验收。',false);
 const reply=await confirmExport(replyPreview,'author-linked-reply');assert.equal(reply.replyTo,original.id);await modelEvidence('author-reply-no-model');await stop();
 profile=friendProfile;worldId=report.friendWorldId;await start('friend-receive-reply');await openExistingWorld(worldId);await importFeedback(reply);await stop();
 await start('friend-reply-cold');await openExistingWorld(worldId);await readThroughUi(reply);assert.equal((await feedbackCall('read',{id:reply.id})).replyTo,original.id);await modelEvidence('friend-reply-cold');
 report.modelCalls=0;report.passed=true;mark('Native feedback preview/export/import/idempotency/reply/cold reopen and Composer draft passed');
}catch(error){report.passed=false;report.error=String(error.stack??error);process.exitCode=1;try{report.failurePage=await evaluate(`({text:document.body.innerText.slice(-12000),layout:localStorage.getItem('craftmine.desktop.layout.v1')})`);}catch{}}
finally{
 try{await stop();}catch(error){report.passed=false;report.shutdownError=String(error);process.exitCode=1;}
 try{launch.assertUnchanged();}catch(error){report.passed=false;report.integrityError=String(error);process.exitCode=1;}
 clearInterval(watcher);save();
}
console.log(JSON.stringify({passed:report.passed===true,report:reportFile,error:report.error,shutdownError:report.shutdownError,integrityError:report.integrityError}));
