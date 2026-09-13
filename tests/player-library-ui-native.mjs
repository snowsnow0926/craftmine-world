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
  'Usage: node tests/player-library-ui-native.mjs ABS_BUILT_CHECKOUT ABS_RUNTIME_RESOURCES [--resume ABS_REPORT] [--packaged-root ABS_PACKAGE]');
const root = path.resolve(import.meta.dirname, '..');
const shareIndex=process.argv.indexOf('--share-report'),importIndex=process.argv.indexOf('--import-report'),sharingOnly=shareIndex>=0;
const resumeIndex=process.argv.indexOf('--resume'),previousFile=resumeIndex>=0?process.argv[resumeIndex+1]:sharingOnly?process.argv[shareIndex+1]:null;
const foreignReport=importIndex>=0?JSON.parse(fs.readFileSync(process.argv[importIndex+1])):null;
if(foreignReport){assert.equal(foreignReport.format,'craftmine.player-library-ui-native/1');assert(foreignReport.crossPlayerTemplate?.archive);assert(!previousFile);}
const previous=previousFile?JSON.parse(fs.readFileSync(previousFile)):null;
if(previous){assert.equal(previous.format,'craftmine.player-library-ui-native/1');assert.equal(previous.applicationRoot,applicationRoot);assert.equal(previous.resources,resources);assert.equal(path.dirname(previous.out),path.join(root,'test-results'));assert(path.basename(previous.out).startsWith('desktop-native-library-ui-'));if(!sharingOnly)assert.notEqual(previous.passed,true);}
fs.mkdirSync(path.join(root, 'test-results'), {recursive:true});
const out = previous?.out??fs.mkdtempSync(path.join(root, 'test-results/desktop-native-library-ui-'));
const profile = path.join(out, 'profile'), token = previous?JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'))).token:randomUUID();
if(!previous){fs.mkdirSync(profile); fs.mkdirSync(path.join(out, 'legacy'));
fs.writeFileSync(path.join(profile, 'headless-profile.json'), JSON.stringify({
  format:'craftmine.headless-profile/1', token, legacySource:path.join(out, 'legacy'),
}));}
const launch = resolveCreationNativeLaunch({root:applicationRoot, inherited:process.env});
const report = {
  format:'craftmine.player-library-ui-native/1', out, applicationRoot, resources,
  driverSha256:createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex'),
  package:launch.identity && {inventorySha256:launch.identity.inventorySha256, mainSha256:launch.identity.mainSha256},
  buildMainSha256:createHash('sha256').update(launch.main).digest('hex'),
  modelCalls:0, launches:[], worlds:[], installations:[], steps:[],
  limits:[
    'Single run on this machine; startup means fresh profile, not flushed OS disk cache.',
    'Durations end at a valid native runtime snapshot, not merely chooser dismissal.',
    'Renderer animation frame timing is not Godot engine FPS or visible OS presentation latency.',
    'F2 uses the actual DOM application handler with a synthetic page event; no physical input.',
    'No model requests; AI cancellation and generation time are outside this measurement.',
  ],
};
if(previous){Object.assign(report,previous,{previousReport:previousFile,previousError:previous.error,driverSha256:report.driverSha256,buildMainSha256:report.buildMainSha256});delete report.error;delete report.shutdownError;delete report.failurePage;delete report.passed;}
if(process.argv.includes('--recreate-template')){
 assert(previous&&report.templateWorld&&!report.copiedPublication,'RECREATE_ONLY_FAILED_TEMPLATE_FIXTURE');
 report.retainedTemplateDiagnostics??=[];report.retainedTemplateDiagnostics.push({worldId:report.templateWorld,sourceReport:previousFile,reason:'Retained pre-fix source initialization; create a new copy without repairing prior data.'});
 delete report.templateWorld;delete report.copiedSource;
}
if(process.argv.includes('--refresh-publications')){
 assert(previous&&report.componentPublication&&report.installations.some(row=>row.label==='published-pom'&&row.job?.status==='failed')&&!report.crossPlayerTemplate,'REFRESH_ONLY_FAILED_PUBLICATION_FIXTURE');
 report.retainedPublicationDiagnostics??=[];report.retainedPublicationDiagnostics.push({sourceReport:previousFile,component:report.componentPublication,copied:report.copiedPublication,reuseWorld:report.reuseWorld,reason:'Preserve failed immutable archive and world; publish fresh bytes through the ordinary forms and install in another new world.'});
 delete report.componentPublication;delete report.copiedPublication;delete report.reuseWorld;delete report.reused;
}
const reportFile = path.join(out, previous?'continuation-'+randomUUID()+'.json':'report.json');
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
  if(!ended){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(15000)]);if(!ended){child.kill();await exit;throw Error('NORMAL_SHUTDOWN_REQUIRED');}}
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
async function installZip(bytes,label,position={x:0,y:0,z:4.3}){
 await closeAssets();fs.writeFileSync(path.join(out,'component.zip'),bytes);
 let record=report.installations.find(row=>row.worldId===worldId&&row.label===label);
 if(record?.applied?.status==='applied'){if(record.framedAtLaunch!==report.launches.length){await look(label==='rain-normal'?-0.15:-0.65);record.capture=await capture(label+'-reopened');record.framedAtLaunch=report.launches.length;save();}return record;}
 if(!record){record={label,worldId,operationId:randomUUID(),archiveSha256:createHash('sha256').update(bytes).digest('hex'),path:'ordinary-native-ZIP-picker-import',startedAt:new Date().toISOString()};report.installations.push(record);save();}
 record.installed??=await pkg('importSource',{operationId:record.operationId,position});assert.equal(record.installed.archiveSha256,record.archiveSha256);assert.equal(record.installed.applied,false);save();
 record.job=await until(()=>pkg('sourceJob',{jobId:record.installed.job.id}),s=>['passed','failed','blocked','cancelled','interrupted'].includes(s.status));assert.equal(record.job.status,'passed',JSON.stringify(record.job));
 const matches=(await panel('godot.candidateList',{offset:0,limit:32})).items.filter(c=>c.checkJobId===record.installed.job.id);assert.equal(matches.length,1);
 record.candidate=await panel('godot.candidateRead',{candidateId:matches[0].candidateId});assert.equal(record.candidate.checkStatus,'passed');assert(record.candidate.check.assertions.length&&record.candidate.check.assertions.every(a=>a.passed));
 record.preview=await panel('godot.candidatePreview',{candidateId:matches[0].candidateId});assert.equal(record.preview.status,'preview');
 record.applied=await panel('godot.candidateApply',{candidateId:matches[0].candidateId});assert.equal(record.applied.status,'applied');
 await until(()=>rpc('godotObserve'),s=>s.worldId===worldId&&s.buildId===matches[0].buildId);
 await look(label==='rain-normal'?-0.15:-0.65);record.framed=true;record.snapshot=await rpc('godotSnapshot');record.capture=await capture(label);save();return record;
}
async function publish(kind,name,alias){
 await assets(kind);
 if(kind==='component'){
  const selected=await until(async()=>{await failIfError();return evaluate(`(()=>{const options=[...document.querySelectorAll('[data-publication-object] option')];return options.find(o=>o.value&&!o.disabled)?.value;})()`);},Boolean);
  await field('[data-publication-object]',selected);
 }
 await until(()=>evaluate(`!document.querySelector('[data-library-publish-form] fieldset').disabled`),Boolean);
 await field('[data-publication-name]',name);await field('[data-publication-description]',kind==='component'?'A saved following and petting companion.':'The saved player world as an independent starting point.');
 await field('[data-publication-tags]',kind==='component'?'博美,伙伴':'世界,模板');await field('[data-publication-aliases]',alias);
 if(kind==='world'){
  assert.equal(await evaluate(`document.querySelector('[data-publication-checkpoint]').checked`),false);
  await field('[data-publication-checkpoint]',true);
 }
 await rpc('capture',{name:'publication-'+kind+'-form'});
 const started=performance.now();await submit('[data-library-publish-form]');
 const id=await until(async()=>{await failIfError();return evaluate(`document.querySelector('[data-publication-result]')?.getAttribute('data-publication-result')`);},Boolean);
 const search=await nav('asset.search',{ownerWorldId:worldId,scope:'local-library',query:alias,mediaKind:'package',latestOnly:true,offset:0,limit:50});
 const card=search.items.find(row=>row.assetId===id);assert(card,'NATIVE_ALIAS_SEARCH_MUST_FIND_PUBLICATION');
 const ref={assetId:card.assetId,version:card.version,contentHash:card.contentHash};
 const record=await nav('asset.read',{ownerWorldId:worldId,assetId:id,version:ref.version});
 const result={worldId,ref,alias,elapsedMs:performance.now()-started,record};report[kind+'Publication']=result;save();
 await submit('[data-library-tab="browse"]');await until(()=>evaluate(`!!document.querySelector('[data-filter="query"]')`),Boolean);
 await field('[data-filter="scope"]','local-library');await field('[data-filter="query"]',alias);await evaluate(`document.querySelector('[data-filter="query"]').closest('form').requestSubmit();true`);
 await until(()=>evaluate(`!!document.querySelector('[data-asset-id="${id}"]')`),Boolean);
 await evaluate(`document.querySelector('[data-asset-id="${id}"]').closest('form').requestSubmit();true`);
 if(kind==='component'){
  const preview=await until(()=>evaluate(`(()=>{const region=document.querySelector('.asset-library-preview'),image=region?.querySelector('[data-preview-thumb]');if(!region)return null;if(image)return image.complete&&image.naturalWidth>0?{available:true,width:image.naturalWidth,height:image.naturalHeight,source:image.src.slice(0,30)}:null;const start=region.querySelector('[data-action="asset-preview"]');return start&&!start.disabled?{available:false,text:region.textContent}:null;})()`),Boolean);
  result.previewStatus=preview.available?'source-world-view':'unavailable';result.preview=preview.available?preview:null;
 }
 await rpc('capture',{name:'publication-'+kind+'-saved'});save();await closeAssets();return result;
}
function publishedBytes(publication){
 const directory=path.join(profile,'plugins/data/craftmine.world/player-component-publications');
 const expected=publication.record.version_.files[0].sha256;
 const files=fs.readdirSync(directory).filter(name=>name.endsWith('.zip'));
 const matches=files.map(name=>({name,bytes:fs.readFileSync(path.join(directory,name))})).filter(row=>createHash('sha256').update(row.bytes).digest('hex')===expected);
 assert.equal(matches.length,1,'OWN_PUBLICATION_ARCHIVE_REQUIRED');
 report.publishedArchiveInput={path:path.join(directory,matches[0].name),sha256:expected,scope:'Read immutable ZIP from this isolated run publication output for ordinary native picker import; no asset-sheet export or model selection claimed.'};return matches[0].bytes;
}
async function rainKeys(){
 await evaluate(`(()=>{const form=[...document.querySelectorAll('[data-craftmine-layout] form')].find(f=>f.querySelector('button')?.textContent.match(/游玩|Play/));if(form)form.requestSubmit();return true;})()`);
 const candidates=(await tabs()).filter(t=>t.url.startsWith('http://127.0.0.1:'));let game;
 for(const candidate of candidates){const target=await connect(candidate.webSocketDebuggerUrl);if(await evaluate(`globalThis.craftmineRuntime?.scope?.worldId===${JSON.stringify(worldId)}`,target)){game=target;break;}target.close();}
 assert(game);const key=code=>evaluate(`(()=>{if(!globalThis.__craftmineHeadless||document.pointerLockElement||document.hasFocus())throw Error('GAME_INPUT_GUARD');const canvas=document.querySelector('canvas');for(const type of ['keydown','keyup'])canvas.dispatchEvent(new KeyboardEvent(type,{key:${JSON.stringify(code.toLowerCase())},code:'Key'+${JSON.stringify(code)},bubbles:true,cancelable:true}));return true;})()`,game);
 const state=async()=>{const snapshot=await rpc('godotSnapshot');return Object.values(snapshot.state.body.components).find(value=>value.format==='craftmine.rain-control-state/1');};
 try{
  const before=await state();assert(before);await key('U');const held=await until(state,s=>s.phase===2);await delay(600);const afterHold=await state();assert.deepEqual(afterHold.heights,held.heights);
  const heldFrame=await capture('rain-held');await key('U');const rising=await until(state,s=>s.phase===4);assert(rising.velocity>0);await delay(300);assert.notDeepEqual((await state()).heights,rising.heights);
  const riseFrame=await capture('rain-rising');await key('I');const normal=await until(state,s=>s.phase===0);assert(normal.velocity<0&&!normal.automatic);
  report.rain={before,held,afterHold,rising,normal,heldFrame,riseFrame};save();
 }finally{game.close();}
}
async function selectTemplate(ref){
 await chooser('templates');await until(async()=>{await failIfError();return evaluate(`!!document.querySelector('[data-local-template="${ref.assetId}"]')`);},Boolean);
 await submit(`[data-local-template="${ref.assetId}"]`);await until(()=>evaluate(`!!document.querySelector('[data-local-template-selected="${ref.assetId}"]')`),Boolean);
}
async function exportSelected(label){
 const picker=path.join(out,'player-world-template.zip');
 if(fs.existsSync(picker))fs.renameSync(picker,path.join(out,'retained-template-'+randomUUID()+'.zip'));
 await submit('[data-template-export]');await until(async()=>{await failIfError();return fs.existsSync(picker);},Boolean);
 const bytes=fs.readFileSync(picker),file=path.join(out,label+'.zip');fs.writeFileSync(file,bytes,{flag:'wx'});
 return {path:file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
async function shareReuseWorld(){
 worldId=report.reuseWorld;assert(worldId&&report.componentPublication&&report.rainInstall);await openExistingWorld(worldId);await look(-0.15);
 const original=report.worldPublication,template=await publish('world','我的伙伴和雨魔法世界','跨玩家雨团子');report.worldPublication=original;
 report.crossPlayerTemplate={ref:template.ref,worldId,componentRef:report.componentPublication.ref,rainAssetId:'cw.module.rain-control'};save();
 await selectTemplate(template.ref);report.crossPlayerTemplate.archive=await exportSelected('cross-player-template-'+randomUUID());save();mark('Published and exported a full world containing the custom player component plus controlled rain');
}
async function importForeignTemplate(){
 const input=foreignReport.crossPlayerTemplate,bytes=fs.readFileSync(input.archive.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),input.archive.sha256);
 report.foreignInput={...input,sourceProfileCopied:false};
 report.catalogBefore=await nav('asset.search',{scope:'local-library',query:input.componentRef.assetId,mediaKind:'package',latestOnly:true,offset:0,limit:50});assert(!report.catalogBefore.items.some(row=>row.assetId===input.componentRef.assetId));
 fs.writeFileSync(path.join(out,'player-world-template.zip'),bytes,{flag:'wx'});await chooser('templates');await submit('[data-template-import]');
 await until(async()=>{await failIfError();return evaluate(`!!document.querySelector('[data-local-template-selected="${input.ref.assetId}"]')`);},Boolean);
 report.importedTemplate=await nav('worldTemplate.read',{ref:input.ref});await field('[data-template-world-title]','Another player imported world');await submit('[data-local-template-create]');
 await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);
 worldId=(await nav('world.list')).activeWorldId;assert.notEqual(worldId,input.worldId);report.importWorld=worldId;report.importSnapshot=await waitWorld(worldId);report.worlds.push({worldId,title:'Another player imported world',createdThrough:'actual-import-then-My-templates-form'});
 report.importedSource=await pkg('sourceList');assert(report.importedSource.items.filter(row=>row.supported).length>=2);await look(-0.15);report.importCapture=await capture('foreign-template-loaded');
 await rainKeys();report.importSave=await panel('godot.runtimeSave',{freeze:false});
 report.foreignComponentPublication=await publish('component','其他玩家再次保存的伙伴','外部复用团子');
 report.catalogAfter=await nav('asset.search',{ownerWorldId:worldId,scope:'local-library',query:input.componentRef.assetId,mediaKind:'package',latestOnly:true,offset:0,limit:50});assert(!report.catalogAfter.items.some(row=>row.assetId===input.componentRef.assetId));
 await selectTemplate(input.ref);report.reexport=await exportSelected('foreign-reexport-'+randomUUID());assert.equal(report.reexport.sha256,input.archive.sha256);
 mark('Fresh second profile imported only the shared ZIP, played rain and republished a component without the original custom catalog record');
}
try{
 console.log(JSON.stringify({out,cancel:path.join(out,'cancel')}));await start('first');
 if(foreignReport)await importForeignTemplate();
 else if(sharingOnly)await shareReuseWorld();
 else{
 if(!report.authorWorld){report.authorWorld=await createWorld('Library author');mark('Created author world through actual PI form');}
 else{worldId=report.authorWorld;await openExistingWorld(worldId);}
 const library=path.join(root,'vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/builtin-source-library');
 const pom=await installZip(fs.readFileSync(path.join(library,'cw.module.approved-pomeranian.zip')),'approved-pom');mark('Approved Pom reached native check, preview and adoption');
 const publication=report.componentPublication??await publish('component','我的白色博美','星雪团子');assert.equal(publication.ref.version,1);assert(publication.preview,'AUTHOR_NATIVE_THUMBNAIL_REQUIRED');mark('Actual component publication form saved native preview and alias search found its exact version');
 const bytes=publishedBytes(publication);
 const template=report.worldPublication??await publish('world','我的博美世界','星雪世界');report.savedTemplate=await nav('worldTemplate.read',{ref:template.ref});assert.equal(report.savedTemplate.initialState,'saved-progress');mark('Explicit saved-progress choice published current formal world through actual PI form');
 await chooser('templates');await until(async()=>{await failIfError();return evaluate(`!!document.querySelector('[data-local-template="${template.ref.assetId}"]')`);},Boolean);await submit(`[data-local-template="${template.ref.assetId}"]`);
 await until(async()=>{await failIfError();return evaluate(`!!document.querySelector('[data-local-template-selected]')`);},Boolean);
 report.templateChooserPreview=await until(()=>evaluate(`(()=>{const image=document.querySelector('[data-local-template-selected] img');return image?.complete&&image.naturalWidth>0?{width:image.naturalWidth,height:image.naturalHeight}:null;})()`),Boolean);
 if(!report.templateArchive)await submit('[data-template-export]');
 await until(async()=>{await failIfError();return fs.existsSync(path.join(out,'player-world-template.zip'));},Boolean);report.templateArchive={path:path.join(out,'player-world-template.zip'),sha256:createHash('sha256').update(fs.readFileSync(path.join(out,'player-world-template.zip'))).digest('hex')};
 await submit('[data-template-import]');await until(async()=>{await failIfError();return evaluate(`document.querySelector('[data-local-world-templates]')?.textContent.includes('模板已导入')||document.querySelector('[data-local-world-templates]')?.textContent.includes('Template imported')`);},Boolean);mark('Actual template export/import forms used isolated native file picker');
 if(!report.templateWorld){await field('[data-template-world-title]','Template copy');await submit('[data-local-template-create]');await until(async()=>{await failIfError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);
 worldId=(await nav('world.list')).activeWorldId;assert.notEqual(worldId,report.authorWorld);report.templateWorld=worldId;report.templateSnapshot=await waitWorld(worldId);report.worlds.push({worldId,title:'Template copy',createdThrough:'actual-My-templates-form'});report.templateSave=await panel('godot.runtimeSave',{freeze:false});mark('My templates form created and loaded a distinct native world');}
 else{worldId=report.templateWorld;await openExistingWorld(worldId);}
 report.copiedSource=await pkg('sourceList');assert(report.copiedSource.items.some(row=>row.supported),'COPIED_SOURCE_COMPONENT_MUST_REMAIN_EXPORTABLE');
 if(!report.copiedPublication){report.copiedPublication=await publish('component','副本里的博美','复制团子');report.componentPublication=publication;save();}
 if(!report.reuseWorld)report.reuseWorld=await createWorld('Published component reuse');else{worldId=report.reuseWorld;await openExistingWorld(worldId);}
 report.reused=await installZip(bytes,'published-pom');assert.equal(report.reused.archiveSha256,publication.record.version_.files[0].sha256);mark('Exact player-published ZIP installed and applied in a new world');
 report.rainInstall=await installZip(fs.readFileSync(path.join(library,'cw.module.rain-control.zip')),'rain-normal',{x:0,y:0,z:0});await rainKeys();mark('Actual offscreen rain suspends, reverses and returns through page input without changing player source');
 await shareReuseWorld();
 }
 if(sharingOnly||foreignReport){worldId=foreignReport?report.importWorld:report.reuseWorld;await openExistingWorld(worldId);}
 report.finalSave=await panel('godot.runtimeSave',{freeze:true});await stop();await start('reopen');
 for(const world of report.worlds){worldId=world.worldId;world.reopened=await openExistingWorld(worldId);world.reopenSave=await panel('godot.runtimeSave',{freeze:false});save();}
 report.guards=await rpc('guards');report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;try{report.failurePage=await evaluate(`({text:document.body.innerText.slice(-6000),layout:localStorage.getItem('craftmine.desktop.layout.v1')})`);}catch{} }
finally{try{await stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;}clearInterval(watcher);save();launch.assertUnchanged();}
console.log(JSON.stringify({passed:report.passed===true,report:reportFile,error:report.error,shutdownError:report.shutdownError}));
