// Test-only operator mailbox over the application's existing offscreen controller.
// Nothing sends a prompt, answers a question, installs or adopts automatically.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {reserveLoopbackPort} from './helpers/ordinary-world-ui.mjs';
import {readProductAgentCommand,atomicProductAgentJson,measureProductAgentFiles,checkProductAgentIntegrity} from './helpers/product-agent-mailbox.mjs';
import {publishOperatorTemplate} from './helpers/product-agent-publication.mjs';
import {prepareProductFeedbackRepair} from './helpers/product-feedback-repair.mjs';
import {exportOperatorTemplate,templateExportReadScript,templateExportSubmitScript} from './helpers/product-template-export.mjs';

const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(args.includes('--help')){console.log('node tests/product-agent-operator-native.mjs --application-root ABS --runtime-resources ABS --codex ABS --output-root ABS [--resume ABS_REPORT] [--packaged-root ABS]\nNo prompts are sent until an explicit inbox command. See docs/PRODUCT_AGENT_OPERATOR_DRIVER.md.');process.exit(0);}
const applicationRoot=option('--application-root'),resources=option('--runtime-resources'),codex=option('--codex'),outputRoot=option('--output-root');
const checkReplayHash=option('--check-replay-sha256');
if(checkReplayHash!==undefined)assert(/^[a-f0-9]{64}$/.test(checkReplayHash),'CHECK_REPLAY_PARENT_PIN_REQUIRED');
assert([applicationRoot,resources,codex,outputRoot].every(value=>typeof value==='string'&&path.isAbsolute(value)),'ABSOLUTE_APPLICATION_RESOURCES_CODEX_OUTPUT_REQUIRED');
assert.equal(path.basename(path.resolve(outputRoot)),'test-results','HEADLESS_OUTPUT_PARENT_MUST_BE_TEST_RESULTS');
const previousFile=option('--resume'),previous=previousFile?JSON.parse(fs.readFileSync(previousFile,'utf8')):null;
if(previous){assert.equal(previous.format,'craftmine.product-agent-operator/1');assert.equal(path.dirname(path.resolve(previousFile)),path.resolve(previous.out));assert.equal(path.dirname(path.resolve(previous.out)),path.resolve(outputRoot));assert(path.basename(previous.out).startsWith('desktop-native-product-'));assert(previous.worldId);assert(previous.sessionId===undefined||typeof previous.sessionId==='string'&&previous.sessionId.length>0);}
fs.mkdirSync(outputRoot,{recursive:true});const out=previous?.out??fs.mkdtempSync(path.join(outputRoot,'desktop-native-product-')),profile=path.join(out,'profile');
if(!previous){fs.mkdirSync(profile);fs.mkdirSync(path.join(out,'legacy'));atomicProductAgentJson(path.join(profile,'headless-profile.json'),{format:'craftmine.headless-profile/1',token:randomUUID(),legacySource:path.join(out,'legacy')});}
const marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'));assert.equal(marker.format,'craftmine.headless-profile/1');
for(const name of ['inbox','responses','turns','captures'])fs.mkdirSync(path.join(out,name),{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex'),launch=resolveCreationNativeLaunch({root:applicationRoot,inherited:process.env});
if(launch.packaged)assert.equal(path.resolve(resources).toLowerCase(),path.join(launch.packaged,'resources').toLowerCase(),'PACKAGED_RESOURCES_MUST_BELONG_TO_PACKAGE');
const report={format:'craftmine.product-agent-operator/1',out,applicationRoot,resources,codex,model:'gpt-6-astra',effort:'xhigh',sourceTemplate:'promo-city',recipeVersion:2,launches:[],turns:[],commands:[],...(previous?{worldId:previous.worldId,sessionId:previous.sessionId,turns:previous.turns,commands:previous.commands,previousReport:previousFile}:{}),acceptance:'not-assessed-by-driver'};
const reportFile=path.join(out,previous?'continuation-'+randomUUID()+'.json':'report.json'),save=()=>atomicProductAgentJson(reportFile,report);
if(checkReplayHash)report.checkReplayPacketSha256=checkReplayHash;
// launch.main contains the UTF-8 bundle contents, not its filesystem path.
report.driverSha256=hash(fs.readFileSync(import.meta.filename));report.mainSha256=hash(launch.main);report.packageIdentity=launch.identity?{inventorySha256:launch.identity.inventorySha256,mainSha256:launch.identity.mainSha256}:null;
const native=launch.packaged?{core:path.join(launch.packaged,'resources/bin/craftmine-core.exe'),host:path.join(launch.packaged,'resources/bin/pi-desktop-host-core.exe')}:{core:process.env.CRAFTMINE_EVAL_CORE??path.join(applicationRoot,'vendor/pi-desktop/target/release/craftmine-core.exe'),host:process.env.CRAFTMINE_EVAL_HOST??path.join(applicationRoot,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe')};
report.artifacts=measureProductAgentFiles({...native,codex,...(!launch.packaged?{main:path.join(applicationRoot,'vendor/pi-desktop/apps/desktop/out/main/index.js'),preload:path.join(applicationRoot,'vendor/pi-desktop/apps/desktop/out/preload/craftmine-headless.cjs')}:{})});
report.binaries=Object.fromEntries(Object.keys(native).map(key=>[key,report.artifacts[key]]));
if(!launch.packaged){assert.equal(report.mainSha256,report.artifacts.main.sha256);report.preloadSha256=report.artifacts.preload.sha256;}else report.preloadSha256=launch.identity.preloadSha256;
report.integrityScope=launch.packaged?'complete-packaged-inventory-and-reported-cli':'reported-main-preload-core-host-and-cli-files';
if(previous)for(const item of report.commands)if(item.status==='running'){item.previousStatus='running';item.status='interrupted-on-resume';item.interruptedAt=new Date().toISOString();}
const checkArtifacts=()=>checkProductAgentIntegrity(report.artifacts,()=>launch.assertUnchanged());
const cancelFile=path.join(out,'cancel-'+randomUUID()),abort=new AbortController(),pending=new Map();report.cancelFile=cancelFile;
let child,ended=true,ready=false,exit,socket,sequence=0,run,quitting=false,activeInput=null;
process.on('SIGINT',()=>abort.abort());process.on('SIGTERM',()=>abort.abort());
const watcher=setInterval(()=>{if(fs.existsSync(cancelFile))abort.abort();if(activeInput&&fs.existsSync(activeInput.cancelFile)&&!activeInput.cancelRequested){activeInput.cancelRequested=true;void rpc('cancelInputs',{payload:{identity:activeInput.identity}}).then(receipt=>{report.lastInputCancellation=receipt;save();},error=>{report.inputCancellationError=String(error);save();});}},300);
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{if(ended)return reject(Error('DESKTOP_EXITED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
async function until(read,accept){while(!abort.signal.aborted){if(ended)throw Error('DESKTOP_EXITED');try{const value=await read();if(accept(value))return value;}catch(error){if(!/Window is not ready|No world runtime is running|World view is not ready|WORLD_BUSY|GODOT_CANDIDATE_ACTIVE|GODOT_VIEW_CAPTURE_BUSY/.test(String(error)))throw error;}await delay(200);}throw Error('OPERATOR_CANCELLED');}
async function evaluate(expression){const current=socket;return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{current.removeEventListener('message',listener);reject(Error('PAGE_RPC_TIMEOUT'));},120000),listener=event=>{const value=JSON.parse(event.data);if(value.id!==id)return;clearTimeout(timer);current.removeEventListener('message',listener);value.error||value.result?.exceptionDetails?reject(Error(value.result?.exceptionDetails?.exception?.description??JSON.stringify(value.error))):resolve(value.result?.result?.value);};current.addEventListener('message',listener);current.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});}
const invoke=(name,...values)=>evaluate(`(async()=>{if(!globalThis.__craftmineHeadless)throw Error('OWNED_HEADLESS_PAGE_REQUIRED');const r=await piDesktop.invoke(piDesktop.channels.invoke[${JSON.stringify(name)}],...${JSON.stringify(values)});if(!r.ok)throw Error(r.error?.code+': '+r.error?.message);return r.data;})()`);
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload});
const brief=payload=>evaluate(`piDesktop.pluginPanelInvoke('craftmine.world','world.brief',${JSON.stringify({...payload,worldId:report.worldId})})`);
const panel=(channel,payload={})=>rpc('worldPanel',{channel,payload:{worldId:report.worldId,...payload}});
const submit=selector=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('FORM_NOT_FOUND');const form=n.tagName==='FORM'?n:n.closest('form');if(!form)throw Error('FORM_REQUIRED');if([...form.querySelectorAll('button[type="submit"]')].some(n=>n.disabled))throw Error('FORM_DISABLED');form.requestSubmit();return true;})()`);
const field=(selector,value)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('FIELD_NOT_FOUND');const p=n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))];if(!p?.onChange)throw Error('FIELD_HANDLER_REQUIRED');if(n.type==='checkbox'||n.type==='radio')n.checked=${JSON.stringify(value)};else n.value=${JSON.stringify(value)};p.onChange({target:n,currentTarget:n});return true;})()`);
async function start(){const integrity=checkArtifacts();report.integrityChecks??=[];report.integrityChecks.push({...integrity,phase:'before-launch'});save();assert.equal(integrity.status,'passed',integrity.error);ready=false;ended=false;const port=await reserveLoopbackPort();run={at:new Date().toISOString(),port};report.launches.push(run);child=spawn(launch.executable,[...launch.args,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{cwd:applicationRoot,env:{...launch.environment({out,profile,token:marker.token}),CRAFTMINE_RUNTIME_RESOURCES:resources,...(checkReplayHash?{CRAFTMINE_CHECK_REPLAY_PACKET_SHA256:checkReplayHash}:{})},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});run.pid=child.pid;
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,report.launches.length+'-'+stream+'.log'),bytes));
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')run.audit=message;const task=pending.get(message.id);if(task){pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error)):task.resolve(message.result);}});
  exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;run.exit={code,signal};for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('DESKTOP_EXITED'));}pending.clear();resolve();});child.once('error',error=>{ended=true;run.error=String(error);resolve();});});
  await until(async()=>ready,Boolean);const status=await rpc('status');assert.deepEqual(status.violations,[]);assert(status.windows.every(w=>!w.visible&&!w.focused&&!w.focusable&&w.offscreen));
  const tabs=await until(async()=>{try{return(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).filter(t=>t.type==='page'&&t.url.includes('/out/renderer/index.html')&&!new URL(t.url).searchParams.has('surface'));}catch{return[];}},value=>value.length===1);
  const url=new URL(tabs[0].webSocketDebuggerUrl);assert(['localhost','127.0.0.1'].includes(url.hostname)&&url.port===String(port));socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  await until(()=>evaluate('!!globalThis.__craftmineHeadless&&!!globalThis.piDesktop'),Boolean);await evaluate('globalThis.operatorEvents=[];piDesktop.on(piDesktop.channels.event.agentMessage,event=>operatorEvents.push(event));true');save();
}
async function stop(){if(!ended){await rpc('quit').catch(()=>{});await Promise.race([exit,delay(60000)]);if(!ended){child.kill();await exit;throw Error('NORMAL_SHUTDOWN_REQUIRED');}}socket?.close();socket=null;assert(run.audit,'NORMAL_SHUTDOWN_AUDIT_REQUIRED');assert.deepEqual(run.audit.violations,[]);assert.deepEqual(run.audit.shutdownFailures,[]);save();}
async function workbench(){await until(()=>evaluate(`!!document.querySelector('[data-craftmine-layout] > form')`),Boolean);await submit('[data-craftmine-layout] > form');await until(()=>evaluate(`!!document.querySelector('[data-world-assets-open]')`),Boolean);}
async function waitWorld(){await until(()=>rpc('godotObserve'),value=>value.worldId===report.worldId&&value.instanceId);await until(()=>rpc('worldNavigationReady'),value=>value.worldId===report.worldId&&value.ready);await workbench();if(!await evaluate(`!!document.querySelector('[data-world-session]')`)){await until(()=>evaluate(`!!document.querySelector('[data-world-start-creation]')`),Boolean);await submit('[data-world-start-creation]');}const sessionId=await until(()=>evaluate(`document.querySelector('[data-world-session]')?.dataset.worldSession`),Boolean);if(report.sessionId)assert.equal(sessionId,report.sessionId,'COLD_REOPEN_SESSION_CHANGED');report.sessionId=sessionId;await invoke('notificationSetViewingSession',{sessionId});save();}
async function setup(){const connection=await invoke('codexConnection',{action:'verify',path:codex});assert.equal(connection.code,'ready');assert.equal(connection.model,'gpt-6-astra');assert.equal(connection.effort,'xhigh');report.connection={code:connection.code,model:connection.model,effort:connection.effort,version:connection.version,accountType:connection.account?.type};await invoke('settingsSet',{worldAgentBackend:'codex-cli',codexCliPath:codex});
  await rpc('primaryMode',{payload:{action:'entry'}});
  if(report.worldId){await until(()=>evaluate(`!!document.querySelector(${JSON.stringify('[data-world-open="'+report.worldId+'"]')})`),Boolean);await submit('[data-world-open="'+report.worldId+'"]');}
  else{const existingIds=new Set((await nav('world.list')).worlds.map(row=>row.id));await until(()=>evaluate(`!!document.querySelector('[data-world-entry-tab-form="examples"]')`),Boolean);await submit('[data-world-entry-tab-form="examples"]');await until(()=>evaluate(`!!document.querySelector('[data-world-example-create="promo-city"]:not(:disabled)')`),Boolean);await submit('[data-world-example-create="promo-city"]');const worlds=await until(()=>nav('world.list'),value=>value.activeWorldId&&!existingIds.has(value.activeWorldId)&&value.worlds.find(row=>row.id===value.activeWorldId)?.state==='ready');report.worldId=worlds.activeWorldId;report.initialWorld=worlds.worlds.find(row=>row.id===report.worldId);save();}
  await waitWorld();const session=await invoke('sessionGet',report.sessionId);assert.equal(session.session.worldAgentBackend,'codex-cli');assert.deepEqual(session.session.supportedThinkingLevels,['xhigh']);report.sessionConfiguration={worldAgentBackend:session.session.worldAgentBackend,supportedThinkingLevels:session.session.supportedThinkingLevels,permissionMode:session.session.permissionMode};report.initialObservation??=await rpc('godotObserve');save();
}
async function assets(section){await workbench();if(!await evaluate(`!!document.querySelector('[data-asset-sheet]')`))await submit('[data-world-assets-open]');await until(()=>evaluate(`!!document.querySelector(${JSON.stringify('[data-library-tab="'+section+'"]')})`),Boolean);await submit('[data-library-tab="'+section+'"]');}
async function composition({wish='保留完整城市、已有建筑与操作方式。使用素材库中已做过的博美和可驾驶飞机，收集三件物品后解锁登机，保留真实起飞与降落。场地不足时增加真实跑道，不得把城市缩成地标或把飞行改为静态展示。'}={}){
  assert.equal((await invoke('agentGetStatus',report.sessionId)).status.isRunning,false);await assets('composition');await until(()=>evaluate(`!!document.querySelector('[data-composition-recipe]')`),Boolean);await field('[data-composition-recipe]','collect-unlock-flight');await field('[data-composition-scenery]','keep');await field('[data-composition-companion]',true);await field('[data-composition-weather]','keep');await field('[data-composition-count]',3);await field('[data-composition-wish]',wish);await submit('[data-composition-plan-form]');
  const plan=await until(async()=>{const value=await evaluate(`({error:document.querySelector('[data-composition-error]')?.textContent,plan:document.querySelector('[data-composition-plan] pre')?.textContent})`);if(value.error)throw Error(value.error);return value.plan?JSON.parse(value.plan):null;},Boolean);assert.equal(plan.request.recipeVersion,2);assert.equal(plan.worldId,report.worldId);report.composition=plan;save();
  await submit('[data-composition-handoff-form]');const draft=await until(async()=>{const value=await evaluate(`({error:document.querySelector('[data-composition-error]')?.textContent,open:!!document.querySelector('[data-asset-sheet]'),text:document.querySelector('.composer-input')?.innerText})`);if(value.error)throw Error(value.error);return !value.open&&value.text?.includes(plan.planHash)?value.text:null;},Boolean);report.compositionDraft=draft;save();return {planHash:plan.planHash,request:plan.request,composerText:draft,sent:false};
}
async function assertModel(){const configured=await invoke('sessionGet',report.sessionId);assert.equal(configured.session.worldAgentBackend,'codex-cli');assert.deepEqual(configured.session.supportedThinkingLevels,['xhigh']);assert.equal((await invoke('settingsGet')).worldAgentBackend,'codex-cli');return configured;}
async function prompt(text){assert(typeof text==='string'&&text.trim());await assertModel();assert.equal((await invoke('agentGetStatus',report.sessionId)).status.isRunning,false);const target=await evaluate(`piDesktop.pluginPanelInvoke('craftmine.world','godot.creationTarget',{sessionId:${JSON.stringify(report.sessionId)}})`);assert.equal(target.worldId,report.worldId);const messageId=randomUUID(),entry={messageId,text,startedAt:new Date().toISOString(),submission:'ordinary-agentPrompt',status:'submitting'};report.turns.push(entry);save();const accepted=await invoke('agentPrompt',{sessionId:report.sessionId,viewingSessionId:report.sessionId,messageId,content:text,...(target.captureId?{requestContext:{creationTarget:{captureId:target.captureId}}}:{})});entry.turnId=accepted.turnId;entry.status='accepted';save();return {messageId,turnId:entry.turnId};}
async function sendComposer(){
  const prior=await assertModel(),ids=new Set(prior.session.messages.map(row=>row.id));
  assert.equal((await invoke('agentGetStatus',report.sessionId)).status.isRunning,false);
  const text=await evaluate("document.querySelector('.composer-input')?.innerText");assert(text?.trim(),'COMPOSER_DRAFT_REQUIRED');
  await evaluate("(()=>{const n=document.querySelector('.send-btn'),p=n&&n[Object.keys(n).find(k=>k.startsWith('__reactProps'))];if(!n||n.disabled||!p?.onClick)throw Error('COMPOSER_SEND_UNAVAILABLE');p.onClick();return true;})()");
  const message=await until(async()=>{const record=await invoke('sessionGet',report.sessionId);return record.session.messages.find(row=>!ids.has(row.id)&&row.role==='user');},Boolean);
  const metrics=await until(()=>invoke('sessionTurnMetrics',{sessionId:report.sessionId,messageId:message.id}),value=>!!value.turnId);
  const entry={messageId:message.id,turnId:metrics.turnId,text,startedAt:new Date().toISOString(),submission:'ordinary-Composer-send-handler',status:'accepted'};
  report.turns.push(entry);save();return {messageId:entry.messageId,turnId:entry.turnId};
}
async function inspect(){const events=await evaluate('operatorEvents.splice(0)');if(events.length)fs.appendFileSync(path.join(out,'agent-events.ndjson'),events.map(row=>JSON.stringify(row)).join('\n')+'\n');for(const event of events){if(event.event?.type==='status'&&event.event.status?.backend){assert.equal(event.event.status.backend,'codex-cli');assert.equal(event.event.status.modelId,'gpt-6-astra');assert.equal(event.event.status.reasoningEffort,'xhigh');const turn=report.turns.find(row=>row.turnId===event.turnId);if(turn)turn.effectiveModel={backend:event.event.status.backend,model:event.event.status.modelId,effort:event.event.status.reasoningEffort};}}
  const session=await invoke('sessionGet',report.sessionId);atomicProductAgentJson(path.join(out,'session.json'),session);const status=await invoke('agentGetStatus',report.sessionId);
  for(const turn of report.turns.filter(row=>row.turnId&&!row.finishedAt)){const metrics=await invoke('sessionTurnMetrics',{sessionId:report.sessionId,messageId:turn.messageId});turn.metrics=metrics;if(metrics.turnId===turn.turnId&&metrics.status!=='running'&&!status.status.isRunning){turn.status=metrics.status;turn.finishedAt=new Date().toISOString();turn.transcriptFile=path.join(out,'turns',turn.turnId+'.json');atomicProductAgentJson(turn.transcriptFile,{turn,session});}}
  const safe=async read=>{try{return await read();}catch(error){return {error:String(error)};}};
  const snapshot={at:new Date().toISOString(),worldId:report.worldId,sessionId:report.sessionId,status,asks:await rpc('headlessAskPending',{payload:{sessionId:report.sessionId}}),permissions:await rpc('headlessPermissionPending',{payload:{sessionId:report.sessionId}}),brief:await safe(()=>brief({action:'read'})),application:await safe(()=>nav('godot.creationTaskStatus',{sessionId:report.sessionId})),proposals:await safe(()=>nav('package.request',{worldId:report.worldId,method:'sourceProposals',params:{worldId:report.worldId}})),observation:await safe(()=>rpc('godotObserve')),page:await evaluate(`document.body.innerText`),composerText:await evaluate(`document.querySelector('.composer-input')?.innerText??''`)};
  atomicProductAgentJson(path.join(out,'status.json'),snapshot);report.lastStatusAt=snapshot.at;save();return snapshot;
}
async function capture(){const binding=await until(()=>rpc('godotCaptureBoundState'),value=>value.formal?.worldId===report.worldId),frame=await rpc('godotCaptureBoundView',{payload:binding.formal}),bytes=Buffer.from(frame.pngBase64,'base64'),file=path.join(out,'captures',Date.now()+'-'+randomUUID()+'.png');fs.writeFileSync(file,bytes);return {file,sha256:hash(bytes),width:frame.width,height:frame.height,identity:binding.formal,observation:frame.viewportObservation};}
async function command(name,input){
  if(name==='status')return inspect();
  if(name==='replay-check'){assert(checkReplayHash,'CHECK_REPLAY_PARENT_PIN_REQUIRED');assert.equal(Object.keys(input).length,0);assert.equal((await invoke('agentGetStatus',report.sessionId)).status.isRunning,false,'FINISH_ACTIVE_TURN_BEFORE_REPLAY');return rpc('godotCheckReplay',{payload:{diagnosticOnly:true}});}
  if(name==='brief')return brief({action:'read'});
  if(name==='goal-add'){assert(['goal','preserve'].includes(input.kind));assert(Number.isSafeInteger(input.expectedRevision));return brief({action:'add',operationId:input.operationId??randomUUID(),expectedRevision:input.expectedRevision,kind:input.kind,text:input.text});}
  if(name==='goal-review'){assert(Number.isSafeInteger(input.expectedRevision));assert(typeof input.accepted==='boolean');return brief({action:'review',operationId:input.operationId??randomUUID(),expectedRevision:input.expectedRevision,id:input.id,buildId:input.buildId,accepted:input.accepted});}
  if(name==='prompt')return prompt(input.text);
  if(name==='send-composer')return sendComposer();
  if(name==='feedback-repair-draft'){assert(!activeInput,'FINISH_INPUT_SEGMENT_BEFORE_FEEDBACK');return prepareProductFeedbackRepair(input,{report,out,evaluate,invoke,nav,assets,submit,field,until});}
  if(name==='composition')return composition(input);
  if(name==='answer'){const ask=await rpc('headlessAskPending',{payload:{sessionId:report.sessionId}});assert(ask&&ask.requestId===input.requestId,'CURRENT_ASK_REQUIRED');assert(Array.isArray(input.answers)&&input.answers.length===ask.questions.length);return invoke('askToolResolve',{sessionId:report.sessionId,requestId:ask.requestId,answers:input.answers});}
  if(name==='permission'){const permission=await rpc('headlessPermissionPending',{payload:{sessionId:report.sessionId}});assert(permission&&permission.requestId===input.requestId,'CURRENT_PERMISSION_REQUIRED');return rpc('headlessPermissionResolve',{payload:{sessionId:report.sessionId,requestId:input.requestId,decision:input.decision}});}
  if(name==='install-proposal'){assert(/^source-[a-f0-9]{48}$/.test(input.proposalId));await workbench();await until(()=>evaluate(`!!document.querySelector(${JSON.stringify('[data-source-proposal="'+input.proposalId+'"] form')})`),Boolean);await submit('[data-source-proposal="'+input.proposalId+'"] form');return {requested:true,proposalId:input.proposalId,applied:false};}
  if(name==='candidate'){assert(['preview','apply'].includes(input.action));const status=await nav('godot.creationTaskStatus',{sessionId:report.sessionId});assert(input.candidateId&&status.candidateId===input.candidateId,'CURRENT_CANDIDATE_REQUIRED');return panel(input.action==='preview'?'godot.candidatePreview':'godot.candidateApply',{candidateId:input.candidateId});}
  if(name==='input-segment'){
    assert(!activeInput,'INPUT_SEGMENT_ALREADY_ACTIVE');assert.equal(input.identity?.worldId,report.worldId);
    const matching=async()=>{const current=await rpc('godotObserve');for(const key of ['worldId','buildId','instanceId'])assert.equal(current[key],input.identity[key],'INPUT_CURRENT_IDENTITY_REQUIRED');};
    await matching();
    const selected={identity:input.identity,cancelFile:path.join(out,'cancel-input-'+randomUUID()),cancelRequested:false};activeInput=selected;report.activeInput=selected;save();
    let result,frozen=false;
    const stopAndSave=async()=>{
      report.lastInputRelease=await rpc('cancelInputs',{payload:{identity:selected.identity}});
      await matching();
      const receipt=await panel('godot.runtimeSave',{freeze:true}),snapshot=await rpc('godotSnapshot');
      assert.equal(snapshot?.worldId,report.worldId);frozen=true;
      report.lastInputCheckpoint={receipt,snapshot,via:'ordinary-runtimeSave-freeze',continuousHumanPlay:false};
      if(result)result.operatorCheckpoint=report.lastInputCheckpoint;
      save();
    };
    try{await panel('godot.runtimeResume');result=await rpc('inputSegment',{payload:{identity:input.identity,segment:input.segment}});await stopAndSave();
      for(const samples of [result,result.partialEvidence].filter(Boolean))for(const phase of ['before','during','after']){const frame=samples[phase]?.frame;if(!frame?.pngBase64)continue;const bytes=Buffer.from(frame.pngBase64,'base64');if(frame.sha256)assert.equal(hash(bytes),frame.sha256);const file=path.join(out,'captures','input-'+phase+'-'+Date.now()+'-'+randomUUID()+'.png');fs.writeFileSync(file,bytes);const {pngBase64,...metadata}=frame;samples[phase].frame={...metadata,file,sha256:hash(bytes)};}
      report.lastInputResult=result;save();return result;
    }finally{try{if(!frozen)await stopAndSave();}catch(error){report.inputReleaseError=String(error);throw error;}finally{activeInput=null;report.activeInput=null;save();}}
  }
  if(name==='cancel-inputs'){assert.equal(input.identity?.worldId,report.worldId);return rpc('cancelInputs',{payload:{identity:input.identity}});}
  if(name==='explore'){const identity=await rpc('godotObserve');assert.equal(identity.worldId,report.worldId);return rpc('godotExplore',{payload:{worldId:report.worldId,buildId:identity.buildId,instanceId:identity.instanceId,steps:input.steps}});}
  if(name==='capture')return capture();
  if(name==='history')return nav('godot.historyLoad',{...input,worldId:report.worldId});
  if(name==='source-read')return nav('godot.historyReadSource',{...input,worldId:report.worldId});
  if(name==='save'){assert(Object.keys(input).every(key=>key==='freeze')&&(input.freeze===undefined||typeof input.freeze==='boolean'));return panel('godot.runtimeSave',{freeze:input.freeze??false});}
  if(name==='resume'){assert.equal(Object.keys(input).length,0);return panel('godot.runtimeResume');}
  if(name==='snapshot'){assert.equal(Object.keys(input).length,0);const result=await rpc('godotSnapshot');assert.equal(result?.worldId,report.worldId);return result;}
  if(name==='reopen'){assert.equal((await invoke('agentGetStatus',report.sessionId)).status.isRunning,false);const before=await rpc('godotObserve'),saved=await panel('godot.runtimeSave',{freeze:true}),savedSnapshot=await rpc('godotSnapshot');await stop();await start();await setup();return {before,saved,savedSnapshot,after:await rpc('godotObserve'),snapshot:await rpc('godotSnapshot'),brief:await brief({action:'read'}),sessionId:report.sessionId};}
  if(name==='publish')return publishOperatorTemplate({assets,field,submit,until,
    read:()=>evaluate(`(()=>{const n=document.querySelector('[data-library-publish="world"]');return {worldId:n?.dataset.publicationWorld,error:n?.querySelector('[role="alert"]')?.textContent,id:n?.querySelector('[data-publication-result]')?.dataset.publicationResult,hasForm:!!n?.querySelector('[data-library-publish-form]'),formReady:!!n?.querySelector('[data-library-publish-form] fieldset:not(:disabled)'),checkpoint:n?.querySelector('[data-publication-checkpoint]')?.checked};})()`),
    continuePublication:()=>evaluate(`(()=>{const result=document.querySelector('[data-library-publish="world"] [data-publication-result]');const n=[...result.querySelectorAll('button')].find(n=>['继续保存其他内容','Save more content'].includes(n.textContent.trim()));const p=n&&n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))];if(!n||n.disabled||!p?.onClick)throw Error('PUBLICATION_CONTINUE_UNAVAILABLE');p.onClick();return true;})()`),
  },input,report.worldId);
  if(name==='open-world'){assert.equal(Object.keys(input).length,0);assert.equal((await invoke('agentGetStatus',report.sessionId)).status.isRunning,false);if(await evaluate(`!!document.querySelector('[data-asset-close-form]')`))await submit('[data-asset-close-form]');await rpc('primaryMode',{payload:{action:'entry'}});await until(()=>evaluate(`!!document.querySelector('[data-world-entry-tab-form="worlds"]')`),Boolean);await submit('[data-world-entry-tab-form="worlds"]');const selector='[data-world-open="'+report.worldId+'"]';await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),Boolean);await submit(selector);await waitWorld();return {worldId:report.worldId,sessionId:report.sessionId,observation:await rpc('godotObserve')};}
  if(name==='export-template'){
    assert(/^player\.world\.[a-z0-9_-]+$/.test(input.assetId));
    if(input.version!==undefined)assert(Number.isSafeInteger(input.version)&&input.version>0);
    if(await evaluate(`!!document.querySelector('[data-asset-close-form]')`))await submit('[data-asset-close-form]');
    await rpc('primaryMode',{payload:{action:'entry'}});
    await until(()=>evaluate(`!!document.querySelector('[data-world-entry-tab-form="worlds"]')`),Boolean);
    // Real tab navigation unmounts an old completion notice before re-export.
    await submit('[data-world-entry-tab-form="worlds"]');await until(()=>evaluate(`!document.querySelector('[data-local-world-templates]')`),Boolean);
    await submit('[data-world-entry-tab-form="templates"]');
    const selector='[data-local-template="'+input.assetId+'"]'+(input.version===undefined?'':'[data-template-version="'+input.version+'"]');
    await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),Boolean);await submit(selector);
    await until(()=>evaluate(templateExportReadScript),state=>state.assetId===input.assetId&&!state.busy);
    const file=path.join(out,'player-world-template.zip');
    return exportOperatorTemplate({read:()=>evaluate(templateExportReadScript),submit:()=>evaluate(templateExportSubmitScript),until,readBytes:()=>fs.readFileSync(file),archive:bytes=>{
      const archived=path.join(out,'captures','world-template-'+Date.now()+'-'+randomUUID()+'.zip');fs.writeFileSync(archived,bytes,{flag:'wx'});return {file:archived,pickerFile:file};
    }},input);
  }
  if(name==='abort')return invoke('agentAbort',{sessionId:report.sessionId});
  if(name==='quit'){if((await invoke('agentGetStatus',report.sessionId)).status.isRunning)throw Error('ABORT_OR_FINISH_TURN_BEFORE_QUIT');quitting=true;return {requested:true};}
  throw Error('MAILBOX_COMMAND_UNKNOWN');
}
abort.signal.addEventListener('abort',()=>{if(!ended&&activeInput)void rpc('cancelInputs',{payload:{identity:activeInput.identity}}).catch(error=>{report.inputCancellationError=String(error);save();});if(!ended&&report.sessionId&&socket)void invoke('agentAbort',{sessionId:report.sessionId}).catch(()=>{});});
try{save();console.log(JSON.stringify({out,reportFile,inbox:path.join(out,'inbox'),status:path.join(out,'status.json'),cancelFile}));await start();await setup();if(!previous||!previous.ready&&previous.turns.length===0)await composition();report.ready=true;save();console.log('OPERATOR_READY '+out);
  while(!quitting&&!abort.signal.aborted){await inspect();for(const file of fs.readdirSync(path.join(out,'inbox')).filter(name=>name.endsWith('.json')).sort()){
    const existing=report.commands.find(row=>row.id===file.slice(0,-5));if(existing){
      try{const duplicate=readProductAgentCommand(path.join(out,'inbox'),file);if(existing.sha256&&duplicate.sha256!==existing.sha256){report.mailboxConflicts??=[];if(!report.mailboxConflicts.some(row=>row.id===duplicate.id&&row.observedSha256===duplicate.sha256)){const conflict={id:duplicate.id,expectedSha256:existing.sha256,observedSha256:duplicate.sha256,error:'MAILBOX_ID_REUSED_WITH_DIFFERENT_BYTES',at:new Date().toISOString()};report.mailboxConflicts.push(conflict);atomicProductAgentJson(path.join(out,'responses',duplicate.id+'-conflict-'+duplicate.sha256.slice(0,12)+'.json'),conflict);save();}}}catch{}
      continue;
    }
    let item,entry;try{item=readProductAgentCommand(path.join(out,'inbox'),file);entry={id:item.id,command:item.command,sha256:item.sha256,startedAt:new Date().toISOString(),status:'running'};report.commands.push(entry);save();const result=await command(item.command,item.args);entry.status='completed';entry.finishedAt=new Date().toISOString();atomicProductAgentJson(path.join(out,'responses',item.id+'.json'),{...entry,result});}
    catch(error){entry??={id:file.slice(0,-5),command:item?.command};if(!report.commands.includes(entry))report.commands.push(entry);entry.status='failed';entry.error=String(error.stack??error);atomicProductAgentJson(path.join(out,'responses',entry.id+'.json'),entry);}save();if(quitting||abort.signal.aborted)break;
  }await delay(1500);}
  if(abort.signal.aborted){report.cancelled=true;if(!ended&&report.sessionId){await invoke('agentAbort',{sessionId:report.sessionId}).catch(()=>{});while(!ended&&(await invoke('agentGetStatus',report.sessionId)).status.isRunning)await delay(250);}}
  if(!ended&&report.sessionId)await inspect();report.operatorFinished=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{if(!ended&&report.sessionId&&report.error)await invoke('agentAbort',{sessionId:report.sessionId}).catch(()=>{});try{if(run)await stop();}catch(error){report.shutdownError=String(error.stack??error);process.exitCode=1;}clearInterval(watcher);report.normalShutdown=!!run?.audit&&!report.shutdownError;report.finalIntegrity=checkArtifacts();if(report.finalIntegrity.status!=='passed')process.exitCode=1;save();console.log(JSON.stringify({out,reportFile,normalShutdown:report.normalShutdown,integrity:report.finalIntegrity.status,error:report.error,integrityError:report.finalIntegrity.error}));}
