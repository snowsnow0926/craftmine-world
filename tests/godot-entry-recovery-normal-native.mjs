// The real shipped/development app, real native Godot and Rust domain, copied
// retained player data. Only original product DOM callbacks / scoped APIs run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {playwright} from '../app/browser-tools.mjs';
import {loadPackageAsar} from '../desktop/package-asar.mjs';
assert.ok(process.argv[2]&&process.argv[3]&&process.argv[4],
  'Usage: node tests/godot-entry-recovery-normal-native.mjs APP_DIR READONLY_SOURCE_PROFILE WORLD_ID');
const repo=path.resolve(import.meta.dirname,'..'),pack=path.resolve(process.argv[2]),source=path.resolve(process.argv[3]),originalWorldId=process.argv[4];
let worldId=originalWorldId;
assert.match(worldId,/^[a-z0-9][a-z0-9-]{1,47}$/);
fs.mkdirSync('D:/CMR',{recursive:true});
const directory=fs.mkdtempSync('D:/CMR/entry-'),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacy);
const relativeDomain='plugins/data/craftmine.world',from=path.join(source,relativeDomain),to=path.join(profile,relativeDomain);
fs.mkdirSync(to,{recursive:true});
const copying=fs.readdirSync(source);
fs.cpSync(source,profile,{recursive:true,filter:file=>!['LOCK','domain-writer.lock','.craftmine-operation.lock','cache'].includes(path.basename(file))&&!/-wal$|-shm$/.test(file)});
const sourceDb=new DatabaseSync(path.join(from,'tasks.sqlite'),{readOnly:true});await backup(sourceDb,path.join(to,'tasks.sqlite'));sourceDb.close();
if(fs.existsSync(path.join(source,'pi.sqlite'))){const db=new DatabaseSync(path.join(source,'pi.sqlite'),{readOnly:true});try{await backup(db,path.join(profile,'pi.sqlite'));}finally{db.close();}}
const settingsPath=path.join(to,'settings.json'),settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));settings.activeWorldId=worldId;fs.writeFileSync(settingsPath,JSON.stringify(settings));
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy,rendering:'normal'}));
const development=fs.existsSync(path.join(pack,'package.json'));
const asar=loadPackageAsar(path.join(repo,'vendor/pi-desktop/apps/desktop'));
const mainText=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: isOffscreenAcceptance()'])assert.ok(mainText.includes(guard),'UNSAFE_APP:'+guard);
const report={directory,profile,sourceProfile:source,package:pack,development,worldId,copied:copying,checks:[],launches:[],attachments:[],
  scope:'real normal native product entry, registered form read-error recovery, save-and-exit and restart; world.list rejection is explicitly injected, never a fabricated engine error',
  limits:['No real keyboard/mouse, no visible OS window activation','Original source profile is only read during the initial copy; subsequent user changes are not attributed to this run']};
const write=()=>fs.writeFileSync(path.join(directory,'entry-recovery-report.json'),JSON.stringify(report,null,2));
const check=(name,value)=>{assert.ok(value,name);report.checks.push({name,passed:true});write();console.log('PASS '+name);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
console.log(JSON.stringify({directory,package:pack,worldId}));
async function launch(label){
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
  for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_CREATION|CRAFTMINE_TEST_|PI_DESKTOP_(CAPTURE|BOOT_PROBE))/.test(key))delete env[key];
  const child=spawn(development?(process.env.FB03_ELECTRON??createRequire('D:/Craftmine World/vendor/pi-desktop/apps/desktop/package.json')('electron')):path.join(pack,'Craftmine World.exe'),
    [...(development?[pack]:[]),'--inspect=0','--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
  const record={label};report.launches.push(record);const pending=new Map(),inspectorPending=new Map();let ready=false,nodeWs,chromeWs,exited=false,socket,browser,appPage,product;
  const log=fs.createWriteStream(path.join(directory,label+'-electron.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  child.stderr.on('data',bytes=>{const text=bytes.toString();nodeWs??=text.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];chromeWs??=text.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')record.exitAudit=message;const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);}});
  const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;record.exit={code,signal};resolve();}));
  const rpc=(method,fields={})=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
  let seq=0;
  const inspect=expression=>new Promise((resolve,reject)=>{const id=++seq;inspectorPending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
  const native=async()=>inspect(`(async()=>{const e=process.mainModule.require('electron');const windows=e.BaseWindow.getAllWindows();if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||windows.some(w=>w.isVisible()||w.isFocusable()))throw Error('HEADLESS_OWNERSHIP');return {windows:windows.map(w=>({visible:w.isVisible(),focusable:w.isFocusable(),fullscreen:w.isFullScreen(),children:w.contentView.children.map(v=>({id:v.webContents?.id,bounds:v.getBounds()}))})),pages:await Promise.all(e.webContents.getAllWebContents().filter(w=>!w.isDestroyed()).map(async w=>({id:w.id,url:w.getURL(),offscreen:w.isOffscreen(),scope:w.getURL().startsWith('http://127.0.0.1:')?await w.executeJavaScript('globalThis.craftmineRuntime?.scope??null',false):null})))};})()`);
  const stop=async(requestQuit=true)=>{
    socket?.close();if(!exited&&requestQuit)await rpc('quit').catch(()=>{});await Promise.race([exit,delay(20000,undefined,{ref:false})]);
    if(!exited){child.kill();await exit;record.forced=true;}
    await browser?.close().catch(()=>{});log.end();write();
    assert.equal(record.exit?.code,0,'normal save and quit');assert.equal(record.forced,undefined,'no forced shutdown');
    assert.deepEqual(record.exitAudit?.violations,[]);assert.deepEqual(record.exitAudit?.pageErrors,[]);assert.deepEqual(record.exitAudit?.shutdownFailures,[]);
  };
  try{
    for(let i=0;i<300&&(!ready||!nodeWs||!chromeWs)&&!exited;i++)await delay(100);
    assert.ok(ready&&nodeWs&&chromeWs,'isolated application startup');
    socket=new WebSocket(nodeWs);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{const message=JSON.parse(event.data),p=inspectorPending.get(message.id);if(!p)return;inspectorPending.delete(message.id);message.error||message.result?.exceptionDetails?p.reject(Error(JSON.stringify(message))):p.resolve(message.result.result.value);};
    record.native=await native();
    browser=await playwright().chromium.connectOverCDP(chromeWs,{noDefaults:true});
    appPage=await until(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html')),Boolean);
    record.uiSamples=[];
    await appPage.exposeFunction('entryRecoverySample',sample=>{record.uiSamples.push(sample);write();});
    await appPage.addInitScript(()=>{
      const f=globalThis.__entryRecoveryTransport={armed:false,acknowledged:null,rejections:0,creates:[],retries:[],quitEvents:[]};
      const sample=()=>globalThis.entryRecoverySample({phase:document.querySelector('[data-quit-phase]')?.dataset.quitPhase??null,buttons:[...document.querySelectorAll('[data-pause-action]')].map(el=>({action:el.dataset.pauseAction,disabled:el.disabled})),error:document.querySelector('[data-craftmine-pause] [role=alert]')?.textContent??null});
      window.__entryRecoverySample=sample;
      // The actual preload still owns every request. Only post-create list
      // reads can be rejected, and only while explicitly armed by this test.
      globalThis.__craftmineWorldBridge={onChanged:listener=>window.piDesktop.onCraftmineWorldChanged(listener),invoke:async(plugin,channel,payload)=>{
        if(channel==='world.list'&&f.armed&&f.acknowledged){f.rejections++;throw Error('ENTRY_TEST_READ_REJECTED');}
        const result=await window.piDesktop.pluginPanelInvoke(plugin,channel,payload);
        if(channel==='world.create'){f.acknowledged=result.id;f.creates.push({payload,result});}
        if(channel==='world.creationRetry')f.retries.push(payload);
        return result;
      }};
      window.piDesktop.on('pi-desktop/craftmine/quitState',state=>{f.quitEvents.push(state);globalThis.entryRecoverySample({event:state});for(const milliseconds of [0,25,75])setTimeout(sample,milliseconds);});
    });
    await appPage.reload({waitUntil:'domcontentloaded'});record.rendererReloadForTransportSetup=true;
    for(let i=0;i<160;i++){
      appPage=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html'));
      if(appPage&&await appPage.evaluate(()=>!!document.querySelector('[data-mode-entry]'))){await rpc('primaryMode',{payload:{action:'create'}});}
      product=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/views/world.html'));
      if(product&&await product.evaluate(()=>document.body.dataset.worldLoaded==='true'))break;
      await delay(250);
    }
    assert.ok(product,'retained product view exists');await product.waitForFunction(()=>document.body.dataset.worldLoaded==='true',{},{timeout:120000,polling:50});
    if(await product.evaluate(()=>document.body.dataset.worldId)!==worldId)await product.evaluate(worldId=>craftmineView.navigate({operation:'switch',id:worldId}),worldId);
    await product.waitForFunction(id=>document.body.dataset.worldId===id&&document.body.dataset.worldLoaded==='true',worldId,{timeout:120000,polling:50});
    // Let finite startup maintenance settle before touching candidate transactions.
    await delay(process.argv.includes('--maintenance-interrupt')?100:2000);
    const panel=(channel,payload={})=>product.evaluate(({channel,payload})=>pluginBridge.invoke(channel,payload),{channel,payload});
    const navigation=(channel,payload={})=>appPage.evaluate(({channel,payload})=>piDesktop.pluginPanelInvoke('craftmine.world',channel,payload),{channel,payload});
    const formal=()=>panel('world.read',{id:worldId});
    const content=()=>navigation('godot.historyLoad',{worldId,branchId:'main'});
    const pageWait=(fn,arg)=>appPage.waitForFunction(fn,arg,{polling:50,timeout:120000});
    const action=async selector=>{
      await pageWait(selector=>[...document.querySelectorAll(selector)].some(el=>el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]')&&!el.disabled),selector);
      return appPage.evaluate(selector=>{const node=[...document.querySelectorAll(selector)].find(el=>el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]')&&!el.disabled);if(!node)throw Error('CONTROL_CHANGED:'+selector);node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onClick();return true;},selector);
    };
    const openWorldList=async()=>{
      if(await appPage.evaluate(()=>!!document.querySelector('[data-mode-entry] [data-world-list-state]')))return;
      await rpc('primaryMode',{payload:{action:'entry'}});
      await action('.craftmine-mode-choice[data-mode="play"]');
      await pageWait(()=>!!document.querySelector('[data-mode-entry] [data-world-list-state]'));
    };
    const enterWorld=async id=>{
      await openWorldList();await action('[data-mode-entry] [data-world-id="'+id+'"][data-world-playable="true"]');
      await pageWait(id=>!document.querySelector('[data-mode-entry]')||(()=>{const b=document.querySelector('.craftmine-mode-enter-world');return b&&!b.disabled&&b.dataset.activeWorld===id;})(),id);
      if(await appPage.evaluate(()=>!!document.querySelector('[data-mode-entry]')))await action('.craftmine-mode-enter-world');
      await pageWait(id=>{const layout=JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1'));return !document.querySelector('[data-mode-entry]')&&layout.mode==='play'&&layout.enteredWorldId===id;},id);
    };
    const attached=async(id,name)=>{
      const value=await until(async()=>{
        const runtime=await navigation('godot.runtimeState',{worldId:id}).catch(()=>null),state=await rpc('godotCaptureBoundState'),views=await native();
        const formal=state.formal,main=views.pages.find(p=>p.url.includes('/out/renderer/index.html')),owner=views.windows.find(w=>w.children.some(v=>v.id===main?.id));
        const matches=views.pages.filter(p=>p.scope&&['worldId','buildId','instanceId'].every(key=>p.scope[key]===formal?.[key]));
        const view=owner?.children.find(v=>matches.some(p=>p.id===v.id));
        return {runtime,state,native:views,view,ok:runtime?.worldId===id&&['ready','paused','saved'].includes(runtime?.state)&&formal?.worldId===id&&formal.instanceId===runtime.instanceId&&formal.buildId===runtime.buildId&&!state.candidate&&matches.length===1&&!matches[0].offscreen&&view?.bounds.width>0&&view?.bounds.height>0};
      },value=>value.ok);
      report.attachments.push({name,worldId:id,...value});write();return value;
    };
    // One hidden-window startup prerequisite per launch, before any tested
    // creation/cancel/retry. No later operation gets paint or bounds assistance.
    await enterWorld(worldId);
    record.initialPaint=await inspect(`(async()=>{const e=process.mainModule.require('electron'),wc=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));const previous=wc.getBackgroundThrottling();let result;try{wc.setBackgroundThrottling(false);const image=await wc.capturePage(undefined,{stayHidden:true});result={count:1,size:image.getSize(),empty:image.isEmpty()};}catch(error){result={count:1,error:String(error),pixelsVerified:false};}finally{wc.setBackgroundThrottling(previous);}return {...result,previousThrottling:previous,restoredThrottling:wc.getBackgroundThrottling(),testOnlyInitialPaint:true};})()`);
    await attached(worldId,label+' original world before tested actions');
    const captureNative=async name=>{
      const before=await rpc('godotCaptureBoundState');
      assert.equal(before.formal?.worldId,worldId,'capture owns the exact retained formal world');
      assert.ok(!before.candidate,'final ground evidence never substitutes a candidate view');
      const identity={worldId:before.formal.worldId,buildId:before.formal.buildId,instanceId:before.formal.instanceId};
      const frame=await rpc('godotCaptureBoundView',{payload:identity});
      const after=await rpc('godotCaptureBoundState');
      assert.deepEqual(after,before,'capture leaves all host identities, state, native view bounds and owner fullscreen unchanged');
      for(const key of ['worldId','buildId','instanceId'])assert.equal(frame[key],identity[key]);
      assert.equal(frame.candidateId,null);assert.equal(frame.scope,'formal');assert.equal(frame.format,'craftmine.godot-view-capture/1');
      const png=Buffer.from(frame.pngBase64,'base64');assert.ok(png.length<=4*1024*1024);
      assert.equal(createHash('sha256').update(png).digest('hex'),frame.sha256);
      assert.equal(png.readUInt32BE(16),frame.width);assert.equal(png.readUInt32BE(20),frame.height);
      assert.ok(frame.width>0&&frame.width<=1920&&frame.height>0&&frame.height<=1080);
      for(const key of ['sourceWidth','sourceHeight','viewWidth','viewHeight'])assert.ok(Number.isFinite(frame[key])&&frame[key]>0,key+' is actual positive capture metadata');
      const screenshot=path.join(directory,name+'.png');fs.writeFileSync(screenshot,png);
      const {pngBase64,...metadata}=frame;
      return {screenshot,before,after,...metadata,method:'identity-bound capture of existing native view; source, CSS view and output image dimensions remain distinct; no owner fullscreen or bounds mutation'};
    };
    return {rpc,panel,navigation,product,appPage,formal,content,native,captureNative,stop,record,pageWait,action,openWorldList,enterWorld,attached};
  }catch(error){await stop().catch(()=>{});throw error;}
}

let active;
const until=async(read,accept)=>{let value;for(let i=0;i<480;i++){value=await read();if(accept(value))return value;await delay(250);}report.lastUnsettled=value;write();throw Error('STATE_DID_NOT_SETTLE');};

const snapshot=async(id)=>{
 const result=await active.panel('godot.runtimeSave',{worldId:id,freeze:true});
 const observed=await active.rpc('godotSnapshot');assert.equal(observed.worldId,id);
 const durable=await active.panel('world.read',{id});assert.deepEqual(durable.world.snapshot,observed.state);
 return{receipt:result,observed,durable,sha256:hash(observed.state)};
};
const uiQuit=async()=>{
 await active.appPage.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 await active.pageWait(()=>!!document.querySelector('[data-craftmine-pause]'));
 await active.action('[data-pause-action="exit"]');
 await active.stop(false);
 const samples=active.record.uiSamples;
 assert.ok(samples.some(sample=>sample.event?.phase==='saving'),'the real quit lifecycle reports saving');
 assert.ok(samples.some(sample=>sample.phase==='saving'&&sample.buttons.length===4&&sample.buttons.every(button=>button.disabled)),'the actual pause UI locks all actions during saving');
};
try{
 active=await launch('create-read-recovery');
 report.originalBefore=await snapshot(originalWorldId);
 await active.openWorldList();await active.action('[data-mode-entry] [data-action="new-world"]');
 await active.pageWait(()=>!!document.querySelector('[data-mode-entry] [data-world-base-option="creation-sandbox"] input:not(:disabled)'));
 await active.appPage.evaluate(()=>{const el=document.querySelector('[data-mode-entry] [data-world-base-option="creation-sandbox"] input');el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onChange();});
 const title='World entry recovery '+new Date().toISOString();
 await active.appPage.evaluate(title=>{const el=document.querySelector('[data-mode-entry] [data-world-create="name"]');el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value:title}});},title);
 await active.pageWait(title=>document.querySelector('[data-mode-entry] [data-world-create="name"]').value===title,title);
 await active.appPage.evaluate(()=>{__entryRecoveryTransport.armed=true;const form=document.querySelector('[data-mode-entry] [data-world-create="form"]');form[Object.keys(form).find(k=>k.startsWith('__reactProps$'))].onSubmit({preventDefault(){}});});
 await active.pageWait(()=>document.querySelector('[data-mode-entry] [data-world-notice="error"]')?.textContent.includes('ENTRY_TEST_READ_REJECTED')&&!document.querySelector('[data-mode-entry] [data-world-create="submit"]').disabled);
 report.injectedReadFailure=await active.appPage.evaluate(()=>({acknowledged:__entryRecoveryTransport.acknowledged,rejections:__entryRecoveryTransport.rejections,creates:__entryRecoveryTransport.creates,title:document.querySelector('[data-mode-entry] [data-world-create="name"]').value,titleDisabled:document.querySelector('[data-mode-entry] [data-world-create="name"]').disabled,button:document.querySelector('[data-mode-entry] [data-world-create="submit"]').textContent}));
 const createdId=report.injectedReadFailure.acknowledged;assert.ok(createdId&&createdId!==originalWorldId);
 check('injected read rejection preserves the real acknowledged world and registered form',report.injectedReadFailure.rejections>0&&report.injectedReadFailure.creates.length===1&&report.injectedReadFailure.title===title&&report.injectedReadFailure.titleDisabled&&/重试|Retry/.test(report.injectedReadFailure.button));
 await active.appPage.evaluate(()=>{__entryRecoveryTransport.armed=false;});
 const beforeRetry=await active.navigation('world.list');report.beforeRetry=beforeRetry.worlds.find(world=>world.id===createdId);assert.ok(report.beforeRetry);
 await active.appPage.evaluate(()=>{const form=document.querySelector('[data-mode-entry] [data-world-create="form"]');form[Object.keys(form).find(k=>k.startsWith('__reactProps$'))].onSubmit({preventDefault(){}});});
 await active.pageWait(()=>!document.querySelector('[data-world-create="form"]')&&!document.querySelector('[data-mode-entry]'));
 const afterRetry=await active.navigation('world.list');report.afterRetry=afterRetry.worlds.find(world=>world.id===createdId);
 report.transport=await active.appPage.evaluate(()=>({creates:__entryRecoveryTransport.creates,retries:__entryRecoveryTransport.retries,rejections:__entryRecoveryTransport.rejections}));
 check('the original form recovers the same world without creating a duplicate',report.afterRetry?.state==='ready'&&afterRetry.activeWorldId===createdId&&report.transport.creates.length===1);
 await active.enterWorld(createdId);await active.attached(createdId,'recovered form enters the actual initialized native world');
 check('normal explicit entry attaches the real fresh world',true);
 report.createdBeforeQuit=await snapshot(createdId);
 await uiQuit();check('Save and exit displays real pending state and exits normally',true);active=null;
 worldId=createdId;
 active=await launch('restart-created-world');
 await active.attached(createdId,'restart restores the same actual formal world');
 report.createdAfterRestart=await snapshot(createdId);
 assert.equal(report.createdAfterRestart.durable.world.build.id,report.createdBeforeQuit.durable.world.build.id);
 assert.deepEqual(report.createdAfterRestart.observed.state,report.createdBeforeQuit.observed.state);
 check('restart enters the same real build with the complete saved progress envelope',true);
 const original=await active.panel('world.read',{id:originalWorldId});assert.deepEqual(original.world.snapshot,report.originalBefore.durable.world.snapshot);
 check('creating and recovering the new world retains the original saved progress',true);
 await uiQuit();check('a second ordinary Save and exit also completes without forced shutdown',true);active=null;report.passed=true;
}catch(error){report.error=String(error.stack??error);if(active){report.failureList=await active.navigation('world.list').catch(()=>null);report.failureDOM=await active.appPage.evaluate(()=>document.body.innerText.slice(-16000)).catch(()=>null);}process.exitCode=1;}
finally{if(active)await active.stop().catch(error=>{report.cleanupError=String(error)});write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
