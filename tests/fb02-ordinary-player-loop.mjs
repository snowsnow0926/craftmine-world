// Actual product UI -> ordinary selected-model turn -> checked automatic adopt.
// No evaluator, source fixture, synthetic model reply, or forced ray capture.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {playwright} from '../app/browser-tools.mjs';
import {loadPackageAsar} from '../desktop/package-asar.mjs';
import {loadLocalConfig} from '../app/local-config.mjs';
import {createFileClarificationExchange} from './helpers/promo-file-clarification.mjs';

const repo=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
assert.ok(args[0]&&!args[0].startsWith('--'),'Usage: node tests/fb02-ordinary-player-loop.mjs APP_DIR [--config ABS_JSON] [--secrets ABS_JSON] [--text ABS_TXT] --plan|--live');
const pack=path.resolve(args[0]),configFile=path.resolve(option('--config',path.join(repo,'test-results/fb02-goal-player-baseline/selected/player-config-snapshot.json')));
const secretsFile=path.resolve(option('--secrets',path.join(repo,'.craftmine/secrets.json')));
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const textFile=option('--text',null),text=textFile?fs.readFileSync(path.resolve(textFile),'utf8').trim():'在这个世界里建一扇红色大门，玩家靠近后按 E 可以打开和关上；门打开时能走过去、关闭时会挡住玩家。门旁边种三棵树。保留已有内容和游玩进度，完成后让我直接进入试玩。';
assert.equal(config.format,'craftmine.player-config-snapshot/1');assert.equal(config.credentialsIncluded,false);
assert.equal(config.vendorKey,'deepseek');assert.equal(config.baseUrl,'https://api.deepseek.com');
assert.equal(config.mode,'agent');assert.equal(config.permissionMode,'auto');assert.equal(config.modelBinding.id,config.modelId);
assert.equal(config.modelBinding.defaultThinkingLevel,config.thinkingLevel);
assert.equal(config.modelBinding.contextWindow,config.contextWindow);assert.equal(config.modelBinding.maxTokens,config.maxTokens);
assert.ok(config.thinkingLevels.includes(config.thinkingLevel));assert.ok(text);
if(args.includes('--plan')||!args.includes('--live')){
  console.log(JSON.stringify({mode:'prepare-only',package:pack,configFile,secretsFile,modelId:config.modelId,thinkingLevel:config.thinkingLevel,contextWindow:config.contextWindow,maxTokens:config.maxTokens,
    inputPath:'actual dialogue entry + Composer onInput + send button onClick',text,modelRequests:0,roundDeadline:null,modelCallLimit:null,automaticRepairLimit:null,noSourceEdits:true},null,2));process.exit(0);
}
const directory=fs.mkdtempSync(path.join(repo,'test-results/desktop-native-ordinary-player-')),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacy);fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const secrets={};loadLocalConfig(secretsFile,secrets);const secret=secrets.CRAFTMINE_DEEPSEEK_API_KEY??secrets.DEEPSEEK_API_KEY??secrets.CRAFTMINE_EVAL_KEY;
assert.ok(typeof secret==='string'&&secret.length,'Selected provider credential is unavailable');
const redact=value=>{let text=typeof value==='string'?value:JSON.stringify(value,null,2);for(const item of [secret,token])text=text.split(item).join('[redacted]');return text;};
const development=fs.existsSync(path.join(pack,'package.json'));
const asar=loadPackageAsar(path.join(repo,'vendor/pi-desktop/apps/desktop'));
const main=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance'])assert.ok(main.includes(guard),'UNSAFE_APP:'+guard);
const controller=new AbortController(),signal=controller.signal,cancelFile=path.join(directory,'cancel');
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort());
const cancelWatch=setInterval(()=>{if(fs.existsSync(cancelFile))controller.abort();},250);
const report={format:'craftmine.fb02-ordinary-player/1',package:pack,development,mainBundleSha256:createHash('sha256').update(main).digest('hex'),directory,profile,config,text,startedAt:new Date().toISOString(),status:'PREPARING',
  inputPath:'actual dialogue entry + Composer onInput + send button onClick',creationEvaluation:false,harnessSourceEdits:0,permissionDecisions:0,manualAdoptions:0,
  limits:{roundDeadline:null,modelCallLimit:null,automaticRepairLimit:null},cancelFile,launches:[],clarifications:[],checks:[]};
const reportFile=path.join(directory,'ordinary-player-report.json');
const save=()=>fs.writeFileSync(reportFile,redact(report));
const check=(name,condition)=>{assert.ok(condition,name);report.checks.push(name);save();console.log('PASS '+name);};
const cancelled=()=>{if(signal.aborted)throw Error('PLAYER_CANCELLED');};
const until=async(read,accept)=>{for(;;){cancelled();const value=await read();if(accept(value))return value;await delay(300,undefined,{signal});}};
const exchange=createFileClarificationExchange({directory:path.join(directory,'questions'),signal});
report.questionDirectory=exchange.directory;save();console.log(JSON.stringify({directory,reportFile,cancelFile,questionDirectory:exchange.directory}));
const channels={providersCreate:'pi-desktop/providers/create',settingsGet:'pi-desktop/settings/get',settingsSet:'pi-desktop/settings/set',sessionList:'pi-desktop/session/list',sessionGet:'pi-desktop/session/get',sessionTurnMetrics:'pi-desktop/session/turnMetrics',agentAbort:'pi-desktop/agent/abort'};
let sessionId,worldId,active;
async function launch(label){
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
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
    const worldPanel=async(channel,payload={})=>{const product=await until(async()=>browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().includes('/views/world.html')),Boolean);return product.evaluate(({channel,payload})=>window.pluginBridge.invoke(channel,payload),{channel,payload});};
    const react=selector=>appPage.evaluate(selector=>{const node=[...document.querySelectorAll(selector)].find(el=>el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]'));if(!node||node.disabled)throw Error('CONTROL_UNAVAILABLE:'+selector);const props=node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))];if(typeof props?.onClick!=='function')throw Error('CONTROL_CALLBACK_MISSING');return props.onClick();},selector);
    const submitText=async content=>{
      await appPage.evaluate(text=>{const editor=[...document.querySelectorAll('.composer-input')].find(el=>el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]'));if(!editor||editor.getAttribute('aria-readonly')==='true')throw Error('COMPOSER_BLOCKED');editor.textContent=text;const props=editor[Object.keys(editor).find(key=>key.startsWith('__reactProps$'))];props.onInput({currentTarget:editor,target:editor,nativeEvent:{inputType:'insertText'},preventDefault(){}});},content);
      await until(()=>appPage.evaluate(()=>[...document.querySelectorAll('.send-btn')].some(el=>el.getClientRects().length&&!el.disabled)),Boolean);
      await react('.send-btn');
    };
    const surface=()=>appPage.evaluate(()=>({dialogue:document.querySelector('[data-dialogue-phase]')?.dataset.dialoguePhase??null,dialogueError:document.querySelector('[data-dialogue-phase="error"] p:last-of-type')?.textContent??null,layout:JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')??'null'),sessionId:document.querySelector('[data-sidebar-session-row].active')?.dataset.sidebarSessionRow??document.querySelector('[data-session-pane][data-visible="true"]')?.dataset.sessionPane??null,stopVisible:!![...document.querySelectorAll('.stop-btn')].find(el=>el.getClientRects().length),results:[...document.querySelectorAll('.craftmine-creation-result[data-phase]')].map(el=>{const rect=el.getBoundingClientRect();return {text:el.textContent,title:el.querySelector('strong')?.textContent,phase:el.dataset.phase,worldId:el.dataset.worldId,sessionId:el.dataset.sessionId,buildId:el.dataset.buildId,visible:rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&!el.closest('[hidden],[inert],[aria-hidden="true"]'),bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};})}));
    return {record,rpc,native,api,panel,worldPanel,react,submitText,surface,appPage,stop};
  }catch(error){await stop().catch(()=>{});throw error;}
}
try{
  active=await launch('first');
  const created=await active.api('providersCreate',{name:'FB02 isolated selected player model',vendorKey:config.vendorKey,protocol:config.protocol,type:config.protocol,baseUrl:config.baseUrl,authKind:'api_key_and_base_url',secretValue:secret,apiStyle:config.apiStyle,defaultModelId:config.modelId,models:[config.modelBinding]});
  const providerId=created.provider.id,settings=await active.api('settingsGet');
  await active.api('settingsSet',{...settings,defaultProviderId:providerId,defaultModelId:config.modelId,defaultMode:config.mode,defaultPermissionMode:config.permissionMode,language:'zh-CN'});
  report.providerId=providerId;report.settings=await active.api('settingsGet');save();
  await active.appPage.reload();await until(()=>active.appPage.evaluate(()=>!!document.querySelector('[data-mode-entry] [data-mode="play"]')),Boolean);
  await active.react('[data-mode-entry] [data-mode="play"]');
  await until(()=>active.appPage.evaluate(()=>!!document.querySelector('[data-mode="dialogue"]')&&!document.querySelector('[data-mode="dialogue"]').disabled),Boolean);
  await active.react('[data-mode="dialogue"]');
  report.status='DIALOGUE_PREPARING';save();
  const dialogue=await until(()=>active.surface(),value=>{if(value.dialogueError)throw Error(value.dialogueError);return value.dialogue==='chat';});
  sessionId=dialogue.sessionId;
  if(!sessionId){const list=await active.api('sessionList');assert.equal(list.sessions.length,1,'fresh dialogue creates exactly one ordinary session');sessionId=list.sessions[0].id;}
  const worlds=await active.panel('world.list');worldId=worlds.activeWorldId;assert.ok(worldId);
  report.sessionId=sessionId;report.worldId=worldId;report.before=await active.api('sessionGet',{id:sessionId});
  const bound=report.before.session;
  report.effectiveBinding={providerId:bound?.providerId??report.settings.defaultProviderId,modelId:bound?.modelId??report.settings.defaultModelId,thinkingLevel:bound?.thinkingLevel,permissionMode:!bound?.permissionMode||bound.permissionMode==='inherit'?report.settings.defaultPermissionMode:bound.permissionMode};
  check('new dialogue session resolves the selected provider, model, thinking and auto permission',report.effectiveBinding.providerId===providerId&&report.effectiveBinding.modelId===config.modelId&&report.effectiveBinding.thinkingLevel===config.thinkingLevel&&report.effectiveBinding.permissionMode===config.permissionMode);
  check('new ordinary session has no model messages before the player submits',!bound.messages?.length);
  report.status='AWAITING_NATIVE_WORLD';save();
  report.initialObservation=await until(async()=>{
    const state=await active.surface();if(state.dialogueError)throw Error(state.dialogueError);
    try{return await active.rpc('godotObserve');}catch(error){report.runtimeWaitingError=redact(String(error));save();return null;}
  },value=>value?.worldId===worldId&&typeof value.buildId==='string'&&typeof value.instanceId==='string');
  delete report.runtimeWaitingError;report.initialNative=await active.native();
  check('dialogue submission waits for the real initialized native Godot world',report.initialNative.pages.some(page=>page.url.startsWith('http://127.0.0.1:')));
  report.initialFormal=await active.worldPanel('world.read',{id:worldId});
  check('visible dialogue target and real runtime share the exact formal build',report.initialFormal.world?.build?.id===report.initialObservation.buildId);
  await active.appPage.screenshot({path:path.join(directory,'dialogue-before-submit.png')});
  report.submittedAt=new Date().toISOString();report.status='ORDINARY_MODEL_RUNNING';save();await active.submitText(text);
  await until(async()=>{const record=await active.api('sessionGet',{id:sessionId});return record.session.messages?.find(message=>message.role==='user'&&message.content===text);},message=>{if(message){report.messageId=message.id;save();return true;}return false;});
  let lastPhase='',lastNotice=0;const answeredTextQuestions=new Set();
  for(;;){
    cancelled();const permission=await active.rpc('headlessPermissionPending',{payload:{sessionId}});
    if(permission){report.permissionFailure=permission;report.status='UNEXPECTED_PERMISSION_CARD';save();throw Error('FULL_AUTO_DISPLAYED_PERMISSION_CARD');}
    const ask=await active.rpc('headlessAskPending',{payload:{sessionId}});
    if(ask){const ticket=exchange.publish(ask,sessionId);report.pendingQuestion=ticket;report.status='AWAITING_REVIEWED_CLARIFICATION';save();console.log('PLAYER_CLARIFICATION '+ticket.requestFile);const answer=await exchange.waitForResponse(ticket);const receipt=await active.rpc('headlessAskResolve',{payload:{sessionId,requestId:ask.requestId,choices:answer.choices}});report.clarifications.push({ticket,answer,receipt});delete report.pendingQuestion;}
    const [record,metrics,application,surface]=await Promise.all([active.api('sessionGet',{id:sessionId}),active.api('sessionTurnMetrics',{sessionId}),active.panel('godot.creationTaskStatus',{sessionId}),active.surface()]);
    const queueDirectory=path.join(profile,'creation-auto-queue');
    const automatic=fs.existsSync(queueDirectory)?fs.readdirSync(queueDirectory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>JSON.parse(fs.readFileSync(path.join(queueDirectory,name),'utf8'))).find(item=>item.jobId===application?.jobId&&item.context?.sessionId===sessionId):null;
    report.latest={record,metrics,application,surface,automatic};report.status='ORDINARY_MODEL_RUNNING';
    const phase=JSON.stringify([metrics?.status,application?.phase,surface.dialogue]);
    if(phase!==lastPhase||Date.now()-lastNotice>30000){lastPhase=phase;lastNotice=Date.now();console.log(redact({at:new Date().toISOString(),sessionId,worldId,turnStatus:metrics?.status,phase:application?.phase,dialogue:surface.dialogue}));}
    save();
    if(application?.phase==='applied'&&metrics?.status==='completed'&&!surface.dialogue&&surface.layout?.mode==='play')break;
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
  report.visibleResult=await until(()=>active.surface(),value=>value.results.some(card=>card.visible&&card.phase==='applied'&&card.worldId===worldId&&card.sessionId===sessionId));
  const resultCard=report.visibleResult.results.find(card=>card.visible&&card.phase==='applied'&&card.worldId===worldId&&card.sessionId===sessionId);
  check('actual visible result card identifies the complete world title and adopted outcome',resultCard.title.startsWith('已采用')&&typeof report.latest.application.worldTitle==='string'&&report.latest.application.worldTitle.length>0&&resultCard.text.includes('目标世界：'+report.latest.application.worldTitle)&&(resultCard.text.includes('结果已进入正式世界')||resultCard.text.includes('结果已采用，当前世界还包含后续更新')));
  check('actual runtime metrics used exactly the selected model',report.latest.metrics.models.length>0&&report.latest.metrics.models.every(model=>model.modelId===config.modelId&&model.providerId===providerId));
  report.after={formal:await active.worldPanel('world.read',{id:worldId}),snapshot:await active.rpc('godotSnapshot'),observation:await active.rpc('godotObserve'),native:await active.native(),guards:await active.rpc('guards')};
  check('ordinary model result was formally applied without permission acceptance or manual adopt',report.after.formal.world?.build?.id!==report.initialFormal.world?.build?.id&&report.permissionDecisions===0&&report.manualAdoptions===0);
  check('dialogue completion enters actual native fullscreen',report.after.native.windows.some(window=>window.fullscreen));
  await active.appPage.screenshot({path:path.join(directory,'automatic-result.png')});
  const image=await active.rpc('godotCaptureView');if(image?.pngBase64){fs.writeFileSync(path.join(directory,'generated-world.png'),Buffer.from(image.pngBase64,'base64'));report.capture={...image,pngBase64:undefined};}
  await active.stop();check('first normal save and quit has no guard or shutdown failure',active.record.exit?.code===0&&!active.record.forced&&!active.record.exitAudit?.violations?.length&&!active.record.exitAudit?.shutdownFailures?.length);active=null;
  active=await launch('reopen');await until(()=>active.rpc('godotObserve').catch(()=>null),value=>value?.worldId===worldId&&value?.buildId===report.after.formal.world.build.id);
  report.reopened={formal:await active.worldPanel('world.read',{id:worldId}),snapshot:await active.rpc('godotSnapshot'),observation:await active.rpc('godotObserve'),native:await active.native(),guards:await active.rpc('guards')};
  check('save and reopen retains the exact generated formal build',report.reopened.formal.world?.build?.id===report.after.formal.world?.build?.id);
  report.status='PASSED_PRODUCT_FLOW';report.completedAt=new Date().toISOString();save();
}catch(error){report.error=redact(String(error.stack??error));if(signal.aborted)report.status='CANCELLED';else if(report.status!=='UNEXPECTED_PERMISSION_CARD')report.status='FAILED';process.exitCode=1;console.log(report.error);}
finally{
  clearInterval(cancelWatch);
  if(active){if(sessionId&&report.status!=='PASSED_PRODUCT_FLOW')await active.api('agentAbort',{sessionId}).catch(()=>{});await active.stop().catch(error=>{report.shutdownError=redact(String(error));process.exitCode=1;});}
  save();console.log(reportFile);
}
