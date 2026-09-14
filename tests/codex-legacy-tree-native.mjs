// Ordinary PI Desktop creation and Composer, real selected Codex, isolated data.
// Explicit --live only. No evaluator, model/token/whole-turn deadline or OS input.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import{spawn}from'node:child_process';import{randomUUID}from'node:crypto';import{setTimeout as delay}from'node:timers/promises';
import{resolveCreationNativeLaunch}from'./helpers/creation-native-launch.mjs';
import{createCompleteOutput}from'./godot-final/complete-contract.mjs';import{reserveLoopbackPort}from'./helpers/ordinary-world-ui.mjs';
import{LEGACY_TREE_REQUEST,LEGACY_TREE_BASE,requireLegacyTree,requireSameLegacySave}from'./helpers/legacy-tree-contract.mjs';

const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
for(let i=0;i<args.length;i++){
  if(args[i]==='--live')continue;
  assert(['--runtime-resources','--codex','--output-root','--packaged-root'].includes(args[i]),'UNKNOWN_DRIVER_OPTION:'+args[i]);
  assert(args[i+1]&&!args[i+1].startsWith('--'),'OPTION_VALUE_REQUIRED');i++;
}
assert(args.includes('--live'),'Explicit --live required; preparation uses node --check and the pure contract test');
const root=path.resolve(import.meta.dirname,'..'),resources=option('--runtime-resources'),binary=option('--codex');
assert(resources&&binary&&[resources,binary].every(path.isAbsolute),'Absolute --runtime-resources and --codex required');
const launch=resolveCreationNativeLaunch({root,inherited:process.env,requiredGuards:['CodexCheckpointHost','CODEX_PATH_REQUIRED']});
if(launch.packaged)assert.equal(path.resolve(resources),path.join(launch.packaged,'resources'),'PACKAGED_RESOURCES_MUST_MATCH');
const out=createCompleteOutput(root,option('--output-root')),profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacy);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const report={format:'craftmine.codex-legacy-tree-native/1',out,request:LEGACY_TREE_REQUEST,model:'gpt-6-astra',effort:'xhigh',launches:[],stages:[],
  package:launch.identity?{packaged:launch.packaged,inventorySha256:launch.identity.inventorySha256,mainSha256:launch.identity.mainSha256}:null,
  limits:['No physical mouse/keyboard, focus or Pointer Lock','No authored state assignment or fake review','Static tree render/application/save coverage; aesthetics need player review']};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const mark=(phase,detail={})=>{report.stages.push({phase,at:new Date().toISOString(),...detail});save();console.log(phase);};
const abort=new AbortController(),pending=new Map();let child,ended=true,ready=false,exit,port,socket,worldSocket,current,seq=0;
process.on('SIGINT',()=>abort.abort());process.on('SIGTERM',()=>abort.abort());
const watcher=setInterval(()=>{if(fs.existsSync(path.join(out,'cancel')))abort.abort();},250);
console.log(JSON.stringify({out,cancel:path.join(out,'cancel'),request:LEGACY_TREE_REQUEST}));save();
function rpc(method,fields={}){return new Promise((resolve,reject)=>{
  if(ended)return reject(Error('DESKTOP_EXITED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);
  pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});
});}
async function until(read,accept){while(!abort.signal.aborted){if(ended)throw Error('DESKTOP_EXITED');const value=await read();if(accept(value))return value;await delay(250);}throw Error('TEST_CANCELLED');}
async function connect(url){const u=new URL(url);assert(['127.0.0.1','localhost'].includes(u.hostname)&&u.port===String(port));const result=new WebSocket(url);await new Promise((yes,no)=>{result.addEventListener('open',yes,{once:true});result.addEventListener('error',no,{once:true});});return result;}
function evaluate(expression,target=socket){return new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{target.removeEventListener('message',receive);reject(Error('CDP_RPC_TIMEOUT'));},120000);
  const receive=event=>{const value=JSON.parse(event.data);if(value.id!==id)return;clearTimeout(timer);target.removeEventListener('message',receive);
    if(value.error||value.result?.exceptionDetails)reject(Error(value.result?.exceptionDetails?.exception?.description??JSON.stringify(value.error)));else resolve(value.result?.result?.value);};
  target.addEventListener('message',receive);target.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
});}
const invoke=(name,...values)=>evaluate(`(async()=>{if(!globalThis.__craftmineHeadless)throw Error('OWNED_HEADLESS_REQUIRED');const r=await piDesktop.invoke(piDesktop.channels.invoke[${JSON.stringify(name)}],...${JSON.stringify(values)});if(!r.ok)throw Error(r.error?.code+': '+r.error?.message);return r.data;})()`);
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const tabs=async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).filter(row=>row.type==='page');
const worldEvaluate=expression=>evaluate(`(()=>{if(!globalThis.__craftmineHeadless||document.body.dataset.worldId!==${JSON.stringify(report.worldId)})throw Error('OWNED_WORLD_REQUIRED');return (${expression});})()`,worldSocket);
const submit=(selector,target=socket)=>evaluate(`(()=>{const form=document.querySelector(${JSON.stringify(selector)});if(!form||form.tagName!=='FORM')throw Error('FORM_REQUIRED');form.requestSubmit();return true;})()`,target);
const field=(selector,value)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),p=n&&n[Object.keys(n).find(k=>k.startsWith('__reactProps'))];if(!n||n.disabled||!p?.onChange)throw Error('EDITABLE_FIELD_REQUIRED');if(n.type==='radio')n.checked=${JSON.stringify(value)};else n.value=${JSON.stringify(value)};p.onChange({target:n,currentTarget:n});return true;})()`);
async function drainEvents(){if(!socket||ended)return;const events=await evaluate('globalThis.legacyTreeEvents?.splice(0)??[]');if(events.length)fs.appendFileSync(path.join(out,'agent-events.ndjson'),events.map(row=>JSON.stringify(row)).join('\n')+'\n');
  for(const row of events)if(row.event?.type==='status'&&row.event.status?.backend){const status=row.event.status;assert.equal(status.backend,'codex-cli');assert.equal(status.modelId,report.model);assert.equal(status.reasoningEffort,report.effort);if(['resumed','restored-from-transcript'].includes(status.transportState))report.authorHandshakeVerified=true;}}
async function start(label){
  ready=false;ended=false;port=await reserveLoopbackPort();current={label,startedAt:new Date().toISOString()};report.launches.push(current);
  const env={...launch.environment({out,profile,token}),CRAFTMINE_RUNTIME_RESOURCES:resources};assert.equal(env.CRAFTMINE_CREATION_EVAL,undefined);
  child=spawn(launch.executable,[...launch.args,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{cwd:launch.cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});current.pid=child.pid;
  for(const stream of['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,label+'-'+stream+'.log'),bytes));
  child.on('message',m=>{if(m.type==='craftmine-headless-ready')ready=true;if(m.type==='craftmine-headless-exit')current.audit=m;const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
  exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;current.exit={code,signal};for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('DESKTOP_EXITED'));}pending.clear();resolve();});child.once('error',error=>{ended=true;current.error=String(error);resolve();});});
  await until(async()=>ready,Boolean);const status=await rpc('status');assert.deepEqual(status.violations,[]);assert(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
  const list=await until(async()=>{try{return(await tabs()).filter(row=>row.url.includes('/out/renderer/index.html')&&!new URL(row.url).searchParams.has('surface'));}catch{return[];}},rows=>rows.length===1);
  socket=await connect(list[0].webSocketDebuggerUrl);await until(()=>evaluate('!!globalThis.__craftmineHeadless&&!!globalThis.piDesktop'),Boolean);
  await evaluate('globalThis.legacyTreeEvents=[];piDesktop.on(piDesktop.channels.event.agentMessage,event=>legacyTreeEvents.push(event));true');mark(label+'-started');
}
async function bindWorld(){
  await until(()=>rpc('worldState'),state=>state.loaded&&state.id===report.worldId);
  for(const row of await tabs()){
    if(!row.url.includes('/views/world.html'))continue;const candidate=await connect(row.webSocketDebuggerUrl);
    if(await evaluate(`!!globalThis.__craftmineHeadless&&document.body.dataset.worldId===${JSON.stringify(report.worldId)}`,candidate)){worldSocket?.close();worldSocket=candidate;return;}
    candidate.close();
  }
  throw Error('OWNED_WORLD_VIEW_NOT_FOUND');
}
async function chooser(tab){await rpc('primaryMode',{payload:{action:'entry'}});await until(()=>evaluate(`!!document.querySelector('[data-world-entry-tab-form="${tab}"]')`),Boolean);await submit(`[data-world-entry-tab-form="${tab}"]`);await until(()=>evaluate(`!!document.querySelector('#world-entry-${tab}')`),Boolean);}
async function uiError(){const error=await evaluate(`document.querySelector('[data-world-entry-error]')?.textContent`);if(error)throw Error(error);}
async function stop(){
  if(!ended){await drainEvents().catch(()=>{});await rpc('quit').catch(()=>{});await Promise.race([exit,delay(15000)]);if(!ended){child.kill();await exit;throw Error('NORMAL_SHUTDOWN_REQUIRED');}}
  socket?.close();worldSocket?.close();socket=worldSocket=null;
  assert(current.audit,'NORMAL_SHUTDOWN_AUDIT_REQUIRED');assert.deepEqual(current.audit.violations,[]);assert.deepEqual(current.audit.shutdownFailures,[]);assert.equal(current.exit.code,0);save();
}
abort.signal.addEventListener('abort',()=>{if(!ended&&report.sessionId)void invoke('agentAbort',{sessionId:report.sessionId}).catch(()=>{});});
try{
  await start('creation');await chooser('create');await until(()=>evaluate(`!!document.querySelector('[data-world-base-option="${LEGACY_TREE_BASE}"] input')`),Boolean);
  await field(`[data-world-base-option="${LEGACY_TREE_BASE}"] input`,true);await field('[data-world-starter-option="blank"] input',true);await field('[data-world-create="name"]','网页空白世界 · Codex 树验收');await submit('[data-world-create="form"]');
  await until(async()=>{await uiError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);
  report.worldId=(await nav('world.list')).activeWorldId;await bindWorld();report.before=await nav('world.read',{id:report.worldId});assert.equal(report.before.runtimeKind,'legacy');assert.equal(report.before.world.build.scene.objects.length,0);mark('ordinary-blank-web-world-created');
  const connection=await invoke('codexConnection',{action:'verify',path:binary});assert.equal(connection.code,'ready');assert.equal(connection.model,report.model);assert.equal(connection.effort,report.effort);
  report.connection={code:connection.code,model:connection.model,effort:connection.effort,version:connection.version};await invoke('settingsSet',{worldAgentBackend:'codex-cli',codexCliPath:binary,defaultPermissionMode:'auto'});
  if(!await evaluate(`!!document.querySelector('[data-world-session]')`)){await until(()=>evaluate(`!!document.querySelector('[data-world-start-creation]')`),Boolean);await submit('[data-world-start-creation]');}
  report.sessionId=await until(()=>evaluate(`document.querySelector('[data-world-session]')?.dataset.worldSession`),Boolean);
  const session=await invoke('sessionGet',report.sessionId);assert.equal(session.session.worldAgentBackend,'codex-cli');assert.deepEqual(session.session.supportedThinkingLevels,['xhigh']);assert.equal(session.session.messages.length,0);await invoke('notificationSetViewingSession',{sessionId:report.sessionId});
  await rpc('primaryMode',{payload:{action:'full'}});await until(()=>evaluate(`!!document.querySelector('.composer-input')`),Boolean);
  await evaluate(`(()=>{const n=document.querySelector('.composer-input'),p=n&&n[Object.keys(n).find(k=>k.startsWith('__reactProps'))];if(!n||!p?.onInput||n.innerText.trim())throw Error('EMPTY_COMPOSER_REQUIRED');n.textContent=${JSON.stringify(LEGACY_TREE_REQUEST)};p.onInput({currentTarget:n,target:n});return true;})()`);
  await until(()=>evaluate(`!!document.querySelector('.send-btn:not(:disabled)')`),Boolean);
  await evaluate(`(()=>{const n=document.querySelector('.send-btn'),p=n[Object.keys(n).find(k=>k.startsWith('__reactProps'))];if(n.disabled||!p?.onClick)throw Error('SEND_HANDLER_REQUIRED');p.onClick();return true;})()`);mark('ordinary-composer-sent');
  const message=await until(async()=>{const detail=await invoke('sessionGet',report.sessionId);return detail.session.messages.find(row=>row.role==='user');},Boolean);assert.equal(message.content,LEGACY_TREE_REQUEST);report.messageId=message.id;
  const metrics=await until(async()=>{await drainEvents();const value=await invoke('sessionTurnMetrics',{sessionId:report.sessionId,messageId:message.id});report.metrics=value;save();return value;},value=>value.status&&value.status!=='running');
  assert.equal(metrics.status,'completed',JSON.stringify(metrics));assert.equal(report.authorHandshakeVerified,true,'REAL_AUTHOR_MODEL_HANDSHAKE_REQUIRED');await until(()=>invoke('agentGetStatus',report.sessionId),value=>!value.status.isRunning);report.dialogue=await invoke('sessionGet',report.sessionId);mark('author-terminal');
  const check=await until(async()=>{const rows=await nav('verification.list',{worldId:report.worldId});report.checks=rows;save();const active=rows.find(row=>row.current);if(active&&['failed','cancelled','interrupted'].includes(active.status))throw Error('VERIFICATION_FAILED:'+JSON.stringify(active));return active;},value=>value?.status==='passed');report.verification=await nav('verification.read',{id:check.id});mark('machine-verification-passed');
  const review=await until(async()=>{await drainEvents();const rows=await nav('review.list',{verificationId:check.id});report.reviews=rows;save();const latest=rows[0];if(latest&&['failed','cancelled','interrupted'].includes(latest.status))throw Error('REQUEST_REVIEW_FAILED:'+JSON.stringify(latest));return latest;},value=>value?.current&&value.status==='completed');assert.equal(review.modelKey,'codex-cli/gpt-6-astra');assert.equal(review.acceptance.passed,true,JSON.stringify(review));mark('real-request-review-passed');
  await worldEvaluate(`craftmineView.showChecks()`);await until(()=>worldEvaluate(`!!document.querySelector('[data-preview-job="${check.id}"]')`),Boolean);await submit(`[data-preview-job="${check.id}"]`,worldSocket);
  await until(()=>worldEvaluate(`document.body.dataset.previewLoaded==='true'`),Boolean);
  report.previewObservation=await worldEvaluate(`new Promise((resolve,reject)=>{const f=document.querySelector('#preview-panel iframe'),nonce=f.srcdoc.match(/name="craftmine-nonce" content="([^"]+)"/)[1],id=crypto.randomUUID();const timer=setTimeout(()=>{removeEventListener('message',receive);reject(Error('PREVIEW_OBSERVE_TIMEOUT'));},120000);function receive(e){const m=e.data;if(e.source!==f.contentWindow||m?.nonce!==nonce||m.channel!=='craftmine-game/1'||m.requestId!==id)return;clearTimeout(timer);removeEventListener('message',receive);m.type==='error'?reject(Error(m.message)):resolve(m.observation);}addEventListener('message',receive);f.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'request-observe',requestId:id},'*');})`);
  report.previewFrame=await rpc('captureWorld',{name:'legacy-tree-preview'});
  await until(()=>worldEvaluate(`!document.getElementById('apply-world').disabled`),Boolean);await submit('#apply-form',worldSocket);
  await until(()=>worldEvaluate(`document.body.dataset.worldLoaded==='true'&&document.getElementById('preview-panel').hidden`),Boolean);
  report.applied=await nav('world.read',{id:report.worldId});report.treeProof=requireLegacyTree({before:report.before,record:report.applied,observation:report.previewObservation});report.appliedFrame=await rpc('captureWorld',{name:'legacy-tree-applied'});mark('ordinary-preview-and-apply-completed');
  await worldEvaluate(`craftmineView.prepareClose()`);report.saved={record:await nav('world.read',{id:report.worldId}),snapshot:(await rpc('worldState')).snapshot};assert.deepEqual(report.saved.record.world.snapshot,report.saved.snapshot);mark('normal-world-close-save-completed');await stop();
  await start('cold-reopen');await chooser('worlds');await until(()=>evaluate(`!!document.querySelector('[data-world-open="${report.worldId}"]')`),Boolean);await submit(`[data-world-open="${report.worldId}"]`);await until(async()=>{await uiError();return evaluate(`!document.querySelector('[data-mode-entry]')`);},Boolean);await bindWorld();
  await worldEvaluate(`craftmineView.prepareClose()`);report.cold={record:await nav('world.read',{id:report.worldId}),snapshot:(await rpc('worldState')).snapshot};requireSameLegacySave(report.saved,report.cold);report.coldFrame=await rpc('captureWorld',{name:'legacy-tree-cold'});report.coldDialogue=await invoke('sessionGet',report.sessionId);assert.deepEqual(report.coldDialogue.session.messages.map(row=>row.id),report.dialogue.session.messages.map(row=>row.id));mark('cold-build-progress-and-dialogue-preserved');report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{
  if(!ended&&report.sessionId){if(!report.passed)await invoke('agentAbort',{sessionId:report.sessionId}).catch(()=>{});await drainEvents().catch(()=>{});report.finalDialogue=await invoke('sessionGet',report.sessionId).catch(error=>({error:String(error)}));}
  try{await stop();}catch(error){report.shutdownError=String(error);process.exitCode=1;report.passed=false;}
  clearInterval(watcher);try{launch.assertUnchanged();report.packageUnchanged=true;}catch(error){report.packageError=String(error);process.exitCode=1;report.passed=false;}save();
}
console.log(JSON.stringify({out,passed:report.passed===true,error:report.error}));
