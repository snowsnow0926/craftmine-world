// Two ordinary creator entrances, original model configurations and natural Auto default.
// No evaluator, source fixture, synthetic model reply, or forced ray capture.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {playwright} from '../app/browser-tools.mjs';
import {loadPackageAsar} from '../desktop/package-asar.mjs';
import {loadLocalConfig} from '../app/local-config.mjs';
import {createFileClarificationExchange} from './helpers/promo-file-clarification.mjs';
import {enterRetainedPlayerWorld} from './helpers/player-world-entry.mjs';

const repo=path.resolve(import.meta.dirname,'..');
const originalFile=path.resolve(process.argv[2]),originalBytes=fs.readFileSync(originalFile),original=JSON.parse(originalBytes);assert.ok(['REPRODUCED','PASSED_PRODUCT_FLOW','READY_FOR_DIAGNOSTIC_RESUME'].includes(original.status));
const packageOption=process.argv.indexOf('--package');
const config=JSON.parse(fs.readFileSync(path.resolve(process.argv[process.argv.indexOf('--config')+1]),'utf8')),pack=packageOption>=0?path.resolve(process.argv[packageOption+1]):original.package,development=false,sourceProfile=original.originalProfile??original.sourceProfile,flow='retained',retainedWorldId=original.worldId,profile=original.profile;
const text=fs.readFileSync(path.resolve(process.argv[3]),'utf8').trim();assert.ok(text);
if(process.argv.includes('--plan')||!process.argv.includes('--live')){console.log(JSON.stringify({mode:'prepare-only',package:pack,continuedFrom:originalFile,profile,worldId:retainedWorldId,sessionId:original.sessionId,modelId:config.modelId,thinkingLevel:config.thinkingLevel,text,entry:'Normal F2 recovers its durable world conversation; no forced store or sidebar fallback',nativeLaunches:0,modelRequests:0,secretsRead:false,limits:{roundDeadline:null,modelCallLimit:null,automaticRepairLimit:null}},null,2));process.exit(0);}
const marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'))),token=marker.token;
const directory=fs.mkdtempSync(path.join(original.directory,'ordinary-followup-'));
const secrets={};loadLocalConfig('D:/Craftmine World/.craftmine/secrets.json',secrets);const secret=secrets.CRAFTMINE_DEEPSEEK_API_KEY??secrets.DEEPSEEK_API_KEY??secrets.CRAFTMINE_EVAL_KEY;assert.ok(secret);
const redact=value=>{let text=typeof value==='string'?value:JSON.stringify(value,null,2);for(const item of [secret,token])text=text.split(item).join('[redacted]');return text;};
const asar=loadPackageAsar(path.join(repo,'vendor/pi-desktop/apps/desktop'));const main=asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();const mainBundleSha256=createHash('sha256').update(main).digest('hex');
if(packageOption<0)assert.equal(mainBundleSha256,original.mainBundleSha256);
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance'])assert.ok(main.includes(guard),'UNSAFE_APP:'+guard);
assert.ok(main.includes('offscreen: isOffscreenAcceptance()')||main.includes('offscreen: !!headlessAcceptance'),'UNSAFE_APP: offscreen guard');
const controller=new AbortController(),signal=controller.signal,cancelFile=path.join(directory,'cancel');
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort());
const cancelWatch=setInterval(()=>{if(fs.existsSync(cancelFile))controller.abort();},250);
const report={format:'craftmine.godot-player-natural-followup/1',continuedFrom:originalFile,originalReportSha256:createHash('sha256').update(originalBytes).digest('hex'),sourceProfile,flow,package:pack,development,mainBundleSha256,productTransition:{previousPackage:original.package,previousMainSha256:original.mainBundleSha256,changed:mainBundleSha256!==original.mainBundleSha256},directory,profile,config,text,startedAt:new Date().toISOString(),status:'PREPARING',
  inputPath:flow==='dialogue'?'preparation text + explicit queue + ordinary prompt':'retained world F2 + ordinary Composer input and send',creationEvaluation:false,harnessSourceEdits:0,permissionDecisions:0,manualAdoptions:0,
  limits:{roundDeadline:null,modelCallLimit:null,automaticRepairLimit:null},cancelFile,launches:[],clarifications:[],checks:[]};
const reportFile=path.join(directory,'ordinary-player-report.json');
const save=()=>fs.writeFileSync(reportFile,redact(report));
const check=(name,condition)=>{assert.ok(condition,name);report.checks.push(name);save();console.log('PASS '+name);};
const cancelled=()=>{if(signal.aborted)throw Error('PLAYER_CANCELLED');};
const until=async(read,accept)=>{for(;;){cancelled();const value=await read();if(accept(value))return value;await delay(300,undefined,{signal});}};
const exchange=createFileClarificationExchange({directory:path.join(directory,'questions'),signal});
report.questionDirectory=exchange.directory;save();console.log(JSON.stringify({directory,reportFile,cancelFile,questionDirectory:exchange.directory}));
const channels={providersCreate:'pi-desktop/providers/create',settingsGet:'pi-desktop/settings/get',settingsSet:'pi-desktop/settings/set',sessionList:'pi-desktop/session/list',sessionGet:'pi-desktop/session/get',sessionTurnMetrics:'pi-desktop/session/turnMetrics',agentAbort:'pi-desktop/agent/abort'};
let sessionId=original.sessionId,worldId=original.worldId,active,queuedByPreparation=false;
function retainedDraftFacts(){
  if(flow!=='retained')return null;
  const repos=path.join(profile,'plugins/data/craftmine.world/content-history/repos');
  const entry=fs.readdirSync(repos).find(name=>{const file=path.join(repos,name,'repo.json');return fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).legacyWorld===retainedWorldId;});assert.ok(entry,'retained content repository exists');
  const gitDir=path.join(repos,entry,'repo.git'),git=(...args)=>execFileSync('git',['--git-dir='+gitDir,...args],{windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','pipe']});
  const files=['scripts/pomeranian_pet.gd','scenes/creation.tscn','scripts/creation_world.gd'].map(name=>{try{const bytes=git('show','main:'+name);return {path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...(name.endsWith('creation.tscn')?{containsPomeranian:/name="Pomeranian"/.test(bytes.toString())}:{})};}catch{return {path:name,missing:true};}});
  return {gitDir,mainHead:git('rev-parse','refs/heads/main').toString().trim(),applied:git('rev-parse','refs/craftmine/applied/'+retainedWorldId).toString().trim(),files};
}
report.retainedDraftBefore=retainedDraftFacts();save();

async function launch(label){
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:original.directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
  for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_CREATION|CRAFTMINE_EVAL|CRAFTMINE_TEST_|CRAFTMINE_P8_|PI_DESKTOP_(CAPTURE|BOOT_PROBE))/.test(key))delete env[key];
  const executable=development?createRequire(path.join(pack,'package.json'))('electron'):path.join(pack,'Craftmine World.exe');
  const child=spawn(executable,[...(development?[pack]:[]),'--inspect=0','--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
  const record={label};report.launches.push(record);const pending=new Map(),inspectorPending=new Map();let ready=false,exited=false,nodeWs,chromeWs,socket,browser,appPage,next=0;
  const log=fs.createWriteStream(path.join(directory,label+'-electron.log'));
  child.stdout.on('data',bytes=>log.write(redact(bytes.toString())));child.stderr.on('data',bytes=>{const value=bytes.toString();log.write(redact(value));nodeWs??=value.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];chromeWs??=value.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')record.exitAudit=message;const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(Error(message.error)):waiter.resolve(message.result);}});
  const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;record.exit={code,signal};for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('APP_EXITED'));}pending.clear();resolve();}));
  const rpc=(method,fields={})=>new Promise((resolve,reject)=>{if(exited)return reject(Error('APP_EXITED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
  const inspect=expression=>new Promise((resolve,reject)=>{const id=++next;inspectorPending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
  const native=()=>inspect(`(()=>{const e=process.mainModule.require('electron'),windows=e.BaseWindow.getAllWindows();if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||windows.some(w=>w.isVisible()||w.isFocusable()))throw Error('HEADLESS_OWNERSHIP');return {windows:windows.map(w=>({visible:w.isVisible(),focusable:w.isFocusable(),fullscreen:w.isFullScreen()})),pages:e.webContents.getAllWebContents().map(w=>({id:w.id,url:w.getURL(),offscreen:w.isOffscreen()}))};})()`);
  const stop=async()=>{socket?.close();if(!exited)await rpc('quit').catch(()=>{});await Promise.race([exit,delay(20000,undefined,{ref:false})]);if(!exited){child.kill();await exit;record.forced=true;}await browser?.close().catch(()=>{});log.end();save();};
  try{
    await until(async()=>{if(exited)throw Error('APP_STARTUP_EXITED');return ready&&nodeWs&&chromeWs;},Boolean);
    socket=new WebSocket(nodeWs);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=event=>{const message=JSON.parse(event.data),waiter=inspectorPending.get(message.id);if(!waiter)return;inspectorPending.delete(message.id);message.error||message.result?.exceptionDetails?waiter.reject(Error(redact(message))):waiter.resolve(message.result.result.value);};
    // Required: defaults enable focus emulation in ALL verifier pages.
    browser=await playwright().chromium.connectOverCDP(chromeWs,{noDefaults:true});
    appPage=await until(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html')),Boolean);
    appPage.setDefaultTimeout(0);appPage.setDefaultNavigationTimeout(0);
    await until(()=>appPage.evaluate(()=>!!window.piDesktop&&!!document.querySelector('#root')?.children.length),Boolean);
    record.native=await native();assert.ok(record.native.windows.length>0,'actual native owner exists before any setup or model work');
    const api=(method,...args)=>appPage.evaluate(async({channel,args})=>{const result=await window.piDesktop.invoke(channel,...args);if(!result?.ok)throw Error(result?.error?.message??'DESKTOP_REQUEST_FAILED');return result.data;},{channel:channels[method],args});
    const panel=(channel,payload={})=>appPage.evaluate(({channel,payload})=>window.piDesktop.pluginPanelInvoke('craftmine.world',channel,payload),{channel,payload});
    const shortcut=async key=>{
      await native();
      if(key==='F2'||key==='ShiftF2')return inspect(`(()=>{const e=process.mainModule.require('electron');if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||e.BaseWindow.getAllWindows().some(w=>w.isVisible()||w.isFocusable()))throw Error('HEADLESS_OWNERSHIP');const page=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));if(!page?.isOffscreen())throw Error('HEADLESS_MAIN_REQUIRED');let prevented=0;page.emit('before-input-event',{preventDefault(){prevented++;}},{type:'keyDown',key:'F2',code:'F2',shift:${key==='ShiftF2'}});return {prevented};})()`);
      if(key==='Escape')return appPage.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true})));
      throw Error('UNSUPPORTED_VERIFICATION_SHORTCUT');
    };
    const worldPanel=async(channel,payload={})=>{const product=await until(async()=>browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().includes('/views/world.html')),Boolean);return product.evaluate(({channel,payload})=>window.pluginBridge.invoke(channel,payload),{channel,payload});};
    const react=selector=>appPage.evaluate(selector=>{const node=[...document.querySelectorAll(selector)].find(el=>el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]'));if(!node||node.disabled)throw Error('CONTROL_UNAVAILABLE:'+selector);const props=node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))];if(typeof props?.onClick!=='function')throw Error('CONTROL_CALLBACK_MISSING');return props.onClick();},selector);
    const submitText=async content=>{
      await appPage.evaluate(({text,expectedSessionId})=>{
        const selected=document.querySelector('[data-session-pane][data-visible="true"]')?.dataset.sessionPane??document.querySelector('[data-sidebar-session-row].active')?.dataset.sidebarSessionRow;
        if(selected!==expectedSessionId)throw Error('FOLLOWUP_SESSION_CHANGED_BEFORE_INPUT');
        const editor=[...document.querySelectorAll('.composer-input')].find(el=>el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]'));
        if(!editor||editor.getAttribute('aria-readonly')==='true')throw Error('COMPOSER_BLOCKED');
        editor.textContent=text;
        editor[Object.keys(editor).find(key=>key.startsWith('__reactProps$'))].onInput({currentTarget:editor,target:editor,nativeEvent:{inputType:'insertText'},preventDefault(){}});
      },{text:content,expectedSessionId:sessionId});
      await until(()=>appPage.evaluate(()=>[...document.querySelectorAll('.send-btn')].some(el=>el.getClientRects().length&&!el.disabled)),Boolean);
      await appPage.evaluate(expectedSessionId=>{
        const selected=document.querySelector('[data-session-pane][data-visible="true"]')?.dataset.sessionPane??document.querySelector('[data-sidebar-session-row].active')?.dataset.sidebarSessionRow;
        if(selected!==expectedSessionId)throw Error('FOLLOWUP_SESSION_CHANGED_BEFORE_SEND');
        const node=[...document.querySelectorAll('.send-btn')].find(el=>el.getClientRects().length&&!el.disabled&&!el.closest('[hidden],[inert],[aria-hidden="true"]'));
        if(!node)throw Error('FOLLOWUP_SEND_UNAVAILABLE');
        node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onClick();
      },sessionId);
    };
    const surface=()=>appPage.evaluate(()=>({chatError:document.querySelector('.chat-error-notice span')?.getAttribute('title')??document.querySelector('.chat-error-notice')?.textContent??null,dialogue:document.querySelector('[data-dialogue-phase]')?.dataset.dialoguePhase??null,conversationRestoring:!!document.querySelector('[data-world-conversation-restoring]'),conversationError:document.querySelector('[data-world-conversation-error]')?.textContent??null,dialogueError:document.querySelector('[data-dialogue-phase="error"] p:last-of-type')?.textContent??null,layout:JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')??'null'),sessionId:document.querySelector('[data-sidebar-session-row].active')?.dataset.sidebarSessionRow??document.querySelector('[data-session-pane][data-visible="true"]')?.dataset.sessionPane??null,stopVisible:!![...document.querySelectorAll('.stop-btn')].find(el=>el.getClientRects().length),results:[...document.querySelectorAll('.craftmine-creation-result[data-phase]')].map(el=>{const rect=el.getBoundingClientRect();return {text:el.textContent,title:el.querySelector('strong')?.textContent,phase:el.dataset.phase,worldId:el.dataset.worldId,sessionId:el.dataset.sessionId,buildId:el.dataset.buildId,visible:rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&!el.closest('[hidden],[inert],[aria-hidden="true"]'),bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};})}));
    const installPromptTrace=async()=>{
      await native();
      return inspect(`(()=>{const e=process.mainModule.require('electron'),fs=process.mainModule.require('node:fs');if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||e.BaseWindow.getAllWindows().some(w=>w.isVisible()||w.isFocusable()))throw Error('HEADLESS_OWNERSHIP');const name='pi-desktop/agent/prompt',handlers=e.ipcMain._invokeHandlers,original=handlers?.get(name);if(typeof original!=='function')throw Error('PROMPT_HANDLER_UNAVAILABLE');handlers.set(name,function(...args){return Promise.resolve(Reflect.apply(original,this,args)).then(result=>{fs.appendFileSync(${JSON.stringify(path.join(directory,'prompt-ipc-results.jsonl'))},JSON.stringify({at:new Date().toISOString(),ok:result?.ok,error:result?.error??null})+'\\n');return result;},error=>{fs.appendFileSync(${JSON.stringify(path.join(directory,'prompt-ipc-results.jsonl'))},JSON.stringify({at:new Date().toISOString(),thrown:{message:String(error.message),code:error.code??error.errorCode??null}})+'\\n');throw error;});});return {installed:true,channel:name};})()`);
    };
    return {record,rpc,native,api,panel,worldPanel,react,submitText,shortcut,surface,appPage,stop,installPromptTrace};
  }catch(error){await stop().catch(()=>{});throw error;}
}
try{
  active=await launch('first');
  const providerId=config.providerId;report.providerId=providerId;await active.appPage.evaluate(async({id,secret})=>{const result=await window.piDesktop.invoke('pi-desktop/providers/update',{id,secretValue:secret});if(!result?.ok)throw Error(result?.error?.message??'PROVIDER_UPDATE_FAILED');},{id:providerId,secret});report.settings=await active.api('settingsGet');await active.stop();active=await launch('configured');report.promptTrace=await active.installPromptTrace();save();
  report.playerEntry=await enterRetainedPlayerWorld(active.appPage,worldId,until);save();
  await until(()=>active.rpc('godotObserve').catch(()=>null),value=>value?.worldId===worldId);
  await active.shortcut('F2');
  await until(()=>active.appPage.evaluate(()=>[...document.querySelectorAll('.composer-input')].some(el=>el.getClientRects().length&&!el.closest('[hidden],[inert]'))),Boolean);
  await until(async()=>{const value=await active.surface();if(value.conversationError)throw Error(value.conversationError);return value;},value=>value.sessionId===sessionId&&value.layout?.mode==='play'&&value.layout?.overlay==='compact'&&!value.conversationRestoring);
  report.restoredConversation=await active.surface();
  check('normal F2 restores the original world-bound conversation without manual selection',report.restoredConversation.sessionId===sessionId);
  report.worldId=worldId;
  report.status='AWAITING_NATIVE_WORLD';save();
  report.initialObservation=await until(async()=>{
    const state=await active.surface();if(state.dialogueError)throw Error(state.dialogueError);
    try{return await active.rpc('godotObserve');}catch(error){report.runtimeWaitingError=redact(String(error));save();return null;}
  },value=>value?.worldId===worldId&&typeof value.buildId==='string'&&typeof value.instanceId==='string');
  delete report.runtimeWaitingError;report.initialNative=await active.native();
  check('retained submission waits for the real initialized native Godot world',report.initialNative.pages.some(page=>page.url.startsWith('http://127.0.0.1:')));
  report.initialFormal=await active.worldPanel('world.read',{id:worldId});
  check('visible dialogue target and real runtime share the exact formal build',report.initialFormal.world?.build?.id===report.initialObservation.buildId);
  await active.appPage.screenshot({path:path.join(directory,'retained-before-submit.png')});
  report.previousApplication=await active.panel('godot.creationTaskStatus',{sessionId});report.previousConversation=await active.surface();save();
  report.submittedAt=new Date().toISOString();report.status='ORDINARY_MODEL_RUNNING';save();if(!queuedByPreparation)await active.submitText(text);
  sessionId??=(await until(()=>active.surface(),value=>!!value.sessionId)).sessionId;report.sessionId=sessionId;
  report.before=await active.api('sessionGet',{id:sessionId});const bound=report.before.session;
  report.effectiveBinding={providerId:bound.providerId??report.settings.defaultProviderId,modelId:bound.modelId??report.settings.defaultModelId,thinkingLevel:bound.thinkingLevel,permissionMode:!bound.permissionMode||bound.permissionMode==='inherit'?(report.settings.defaultPermissionMode??'ask'):bound.permissionMode};
  check('ordinary entry preserves its original model and thinking while the product resolves permission',report.effectiveBinding.providerId===providerId&&report.effectiveBinding.modelId===config.modelId&&report.effectiveBinding.thinkingLevel===config.thinkingLevel&&report.effectiveBinding.permissionMode==='auto');
  check('followup preserves the original global permission preference',(report.settings.defaultPermissionMode??null)===(config.sourceGlobalPermissionMode??null));save();
  await until(async()=>{const record=await active.api('sessionGet',{id:sessionId});return record.session.messages?.find(message=>message.role==='user'&&message.content===text);},message=>{if(message){report.messageId=message.id;save();return true;}return false;});
  let lastPhase='',lastNotice=0;const answeredTextQuestions=new Set();
  for(;;){
    cancelled();const permission=await active.rpc('headlessPermissionPending',{payload:{sessionId}});
    if(permission){report.permissionFailure=permission;save();throw Error('DEFAULT_CREATION_DISPLAYED_PERMISSION_CARD');}
    const ask=await active.rpc('headlessAskPending',{payload:{sessionId}});
    if(ask){const ticket=exchange.publish(ask,sessionId);report.pendingQuestion=ticket;report.status='AWAITING_REVIEWED_CLARIFICATION';save();console.log('PLAYER_CLARIFICATION '+ticket.requestFile);const answer=await exchange.waitForResponse(ticket);const receipt=await active.rpc('headlessAskResolve',{payload:{sessionId,requestId:ask.requestId,choices:answer.choices}});report.clarifications.push({ticket,answer,receipt});delete report.pendingQuestion;}
    const [record,metrics,application,surface]=await Promise.all([active.api('sessionGet',{id:sessionId}),active.api('sessionTurnMetrics',{sessionId}),active.panel('godot.creationTaskStatus',{sessionId}),active.surface()]);
    const queueDirectory=path.join(profile,'creation-auto-queue');
    const automatic=fs.existsSync(queueDirectory)?fs.readdirSync(queueDirectory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>JSON.parse(fs.readFileSync(path.join(queueDirectory,name),'utf8'))).find(item=>item.jobId===application?.jobId&&item.context?.sessionId===sessionId):null;
    report.latest={record,metrics,application,surface,automatic};report.status='ORDINARY_MODEL_RUNNING';
    const phase=JSON.stringify([metrics?.status,application?.phase,surface.dialogue]);
    if(phase!==lastPhase||Date.now()-lastNotice>30000){lastPhase=phase;lastNotice=Date.now();console.log(redact({at:new Date().toISOString(),sessionId,worldId,turnStatus:metrics?.status,phase:application?.phase,dialogue:surface.dialogue}));}
    save();
    if(application?.phase==='applied'&&metrics?.status==='completed'&&(!surface.dialogue&&surface.layout?.mode==='play'&&surface.layout?.overlay==='closed'))break;
    if(['error','aborted'].includes(metrics?.status)&&(!application?.jobId||['manual','failed','cancelled'].includes(automatic?.status)))throw Error('ORDINARY_MODEL_'+metrics.status.toUpperCase());
    if(metrics?.status==='completed'&&application?.phase==='idle'){
      const last=record.session.messages.filter(message=>message.role==='assistant').at(-1);
      if(last&&/[?？]|请问|哪种|需要你确认|would you|could you/i.test(last.content??'')){
        if(!answeredTextQuestions.has(last.id)){
          const requestFile=path.join(directory,'text-question-'+last.id+'.json'),responseFile=requestFile+'.response.json';
          fs.writeFileSync(requestFile,redact({sessionId,message:last,responseFile}));report.pendingTextQuestion={requestFile,responseFile};report.status='AWAITING_REVIEWED_CLARIFICATION';save();console.log('PLAYER_TEXT_CLARIFICATION '+requestFile);
          await until(async()=>fs.existsSync(responseFile),Boolean);const answer=JSON.parse(fs.readFileSync(responseFile,'utf8'));
          assert.ok(typeof answer.text==='string'&&answer.text.trim(),'Reviewed clarification must provide text');
          await active.submitText(answer.text);await until(()=>active.api('sessionGet',{id:sessionId}),value=>value.session.messages.some(message=>message.role==='user'&&message.content===answer.text));
          report.clarifications.push({requestFile,answer});delete report.pendingTextQuestion;answeredTextQuestions.add(last.id);save();
        }
        await delay(500,undefined,{signal});continue;
      }
      report.status='AWAITING_PRODUCT_RECOVERY';report.incompleteTurn={reason:'ORDINARY_CREATION_ENDED_WITHOUT_CHECK',metrics,lastAssistant:last};save();if(Date.now()-lastNotice>5000)console.log('PLAYER_INCOMPLETE_TURN '+reportFile);await delay(1000,undefined,{signal});continue;
    }
    if(['manual','failed','cancelled'].includes(automatic?.status)&&metrics?.status!=='running')throw Error('ORDINARY_CREATION_FAILED_WITHOUT_AUTOMATIC_RECOVERY');
    await delay(1000,undefined,{signal});
  }
  report.directPlayableRuntime=await until(()=>active.rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}}),value=>value.state==='ready');
  check('automatic completion leaves the actual world directly playable with no chat overlay',report.latest.surface.layout.overlay==='closed'&&report.directPlayableRuntime.state==='ready');
  report.verificationUiActions=[{purpose:'Inspect the saved result after creation already completed',key:'F2',receipt:await active.shortcut('F2')}];
  report.visibleResult=await until(()=>active.surface(),value=>value.results.some(card=>card.visible&&card.phase==='applied'&&card.worldId===worldId&&card.sessionId===sessionId));
  const resultCard=report.visibleResult.results.find(card=>card.visible&&card.phase==='applied'&&card.worldId===worldId&&card.sessionId===sessionId);
  check('actual visible result card identifies the complete world title and adopted outcome',resultCard.title.startsWith('已采用')&&typeof report.latest.application.worldTitle==='string'&&report.latest.application.worldTitle.length>0&&resultCard.text.includes('目标世界：'+report.latest.application.worldTitle)&&(resultCard.text.includes('结果已进入正式世界')||resultCard.text.includes('结果已采用，当前世界还包含后续更新')));
  report.verificationUiActions.push({purpose:'Return to the already generated playable world',key:'Escape',receipt:await active.shortcut('Escape')});
  await until(()=>active.surface(),value=>value.layout?.overlay==='closed');
  await until(()=>active.rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}}),value=>value.state==='ready');
  check('actual runtime metrics used exactly the selected model',report.latest.metrics.models.length>0&&report.latest.metrics.models.every(model=>model.modelId===config.modelId&&model.providerId===providerId));
  report.retainedDraftAfter=retainedDraftFacts();
  if(report.retainedDraftBefore){
    const pet=report.retainedDraftBefore.files.find(file=>file.path==='scripts/pomeranian_pet.gd');
    if(pet&&!pet.missing)check('the retained Pomeranian script remains byte-identical after ordinary creation',report.retainedDraftAfter.files.find(file=>file.path===pet.path)?.sha256===pet.sha256);
    if(report.retainedDraftBefore.files.find(file=>file.path==='scenes/creation.tscn')?.containsPomeranian)check('the original scene still contains its retained Pomeranian node',report.retainedDraftAfter.files.find(file=>file.path==='scenes/creation.tscn')?.containsPomeranian===true);
  }
  const migrationDir=path.join(profile,'creation-migrations');report.sourceMigrations=fs.existsSync(migrationDir)?fs.readdirSync(migrationDir).filter(name=>name.endsWith('.json')).map(name=>{const value=JSON.parse(fs.readFileSync(path.join(migrationDir,name),'utf8'));return {worldId:value.worldId,migrationId:value.migrationId,sourceBaseline:value.sourceBaseline,expectedFiles:value.expectedFiles,advance:value.advance};}):[];
  report.after={formal:await active.worldPanel('world.read',{id:worldId}),snapshot:await active.rpc('godotSnapshot'),observation:await active.rpc('godotObserve'),native:await active.native(),guards:await active.rpc('guards')};
  check('ordinary model result was formally applied without permission acceptance or manual adopt',report.after.formal.world?.build?.id!==report.initialFormal.world?.build?.id&&report.permissionDecisions===0&&report.manualAdoptions===0);
  check('ordinary creation finishes in actual native fullscreen',report.after.native.windows.some(window=>window.fullscreen));
  await active.appPage.screenshot({path:path.join(directory,'automatic-result.png')});
  report.captureFreeze=await active.rpc('worldPanel',{channel:'godot.runtimeSave',payload:{worldId,freeze:true}});
  const captureBefore=await active.rpc('godotCaptureBoundState'),image=await active.rpc('godotCaptureBoundView',{payload:captureBefore.formal}),captureAfter=await active.rpc('godotCaptureBoundState');
  assert.deepEqual(captureAfter,captureBefore,'Read-only bound capture leaves native owner and world unchanged');
  const png=Buffer.from(image.pngBase64,'base64');assert.equal(createHash('sha256').update(png).digest('hex'),image.sha256);fs.writeFileSync(path.join(directory,'generated-world.png'),png);report.capture={...image,pngBase64:undefined,before:captureBefore,after:captureAfter};
  await active.stop();check('first normal save and quit has no guard or shutdown failure',active.record.exit?.code===0&&!active.record.forced&&!active.record.exitAudit?.violations?.length&&!active.record.exitAudit?.shutdownFailures?.length);active=null;
  active=await launch('reopen');report.reopenEntry=await enterRetainedPlayerWorld(active.appPage,worldId,until);await until(()=>active.rpc('godotObserve').catch(()=>null),value=>value?.worldId===worldId&&value?.buildId===report.after.formal.world.build.id);
  report.reopened={formal:await active.worldPanel('world.read',{id:worldId}),snapshot:await active.rpc('godotSnapshot'),observation:await active.rpc('godotObserve'),native:await active.native(),guards:await active.rpc('guards')};
  report.reopened.metrics=await active.api('sessionTurnMetrics',{sessionId});check('reopening adds no model calls',report.reopened.metrics.calls.observed===report.latest.metrics.calls.observed);
  check('save and reopen retains the exact generated formal build',report.reopened.formal.world?.build?.id===report.after.formal.world?.build?.id);
  report.semanticAcceptance={status:'pending-independent-gameplay',scope:'This report proves the ordinary creation/apply/reopen flow. Weapon firing/ammunition or forest exploration require actual generated-world follow-up.'};
  report.status='PASSED_PRODUCT_FLOW';report.completedAt=new Date().toISOString();save();
}catch(error){if(active)report.failureUi=await active.surface().catch(()=>null);report.error=redact(String(error.stack??error));if(signal.aborted)report.status='CANCELLED';else report.status='FAILED';process.exitCode=1;console.log(report.error);}
finally{
  clearInterval(cancelWatch);
  if(active){if(sessionId&&report.submittedAt&&report.status!=='PASSED_PRODUCT_FLOW')await active.api('agentAbort',{sessionId}).catch(()=>{});await active.stop().catch(error=>{report.shutdownError=redact(String(error));process.exitCode=1;});}
  assert.ok(fs.readFileSync(originalFile).equals(originalBytes),'Original reproduction report remains immutable');save();console.log(reportFile);
}
