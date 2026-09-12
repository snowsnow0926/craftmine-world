import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {playwright} from '../app/browser-tools.mjs';
import {loadPackageAsar} from '../desktop/package-asar.mjs';
import assert from 'node:assert/strict';
const pack=path.resolve(process.argv[2]),directory=path.resolve(process.argv[3]),profile=path.join(directory,'profile');
const expectFixed=process.argv.includes('--expect-fixed');
const development=process.argv.includes('--development');
const creationOnly=process.argv.includes('--creation-only');
const evidenceName=development?'development':expectFixed?'package':'original';
const previousReport=path.join(directory,'world-create-chain-'+evidenceName+'-report.json');
if(fs.existsSync(previousReport))fs.copyFileSync(previousReport,path.join(directory,'world-create-chain-'+evidenceName+'-previous-'+Date.now()+'.json'));
const {token}=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'));
const asar=loadPackageAsar(path.resolve('vendor/pi-desktop/apps/desktop'));
const main=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance']) assert.ok(main.includes(guard),'UNSAFE_PACKAGE:'+guard);
const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
delete env.ELECTRON_RUN_AS_NODE;
const executable=development?createRequire(path.join(pack,'package.json'))('electron'):path.join(pack,'Craftmine World.exe');
const child=spawn(executable,[...(development?[pack]:[]),'--inspect=0','--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
const report={package:pack,directory,checks:[],limits:['Finite native callbacks and page script events; no OS keyboard/mouse injection or activation','Renderer pixels plus actual native sibling order; no visible OS-composited screenshot','Requires a previously prepared isolated headless profile, never a player profile']},pending=new Map();let ready=false,exited=false,nodeWs,chromeWs,browser,socket;
const log=fs.createWriteStream(path.join(directory,'world-create-chain-electron.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.stderr.on('data',bytes=>{const value=bytes.toString();nodeWs??=value.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];chromeWs??=value.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
child.on('message',m=>{if(m.type==='craftmine-headless-ready')ready=true;if(m.type==='craftmine-headless-exit')report.exitAudit=m;const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;report.exit={code,signal};resolve();}));
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},20000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
let next=1;const inspectorPending=new Map();
const inspectorCommand=(method,params)=>new Promise((resolve,reject)=>{const id=next++;inspectorPending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const inspect=async expression=>(await inspectorCommand('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
const guard=`const electron=process.mainModule.require('electron');const owners=electron.BaseWindow.getAllWindows();if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||owners.some(w=>w.isVisible()||w.isFocusable()))throw Error('HEADLESS_GUARD');`;
const statusExpression=`(()=>{${guard}return {windows:owners.map(w=>({id:w.id,visible:w.isVisible(),focusable:w.isFocusable(),fullscreen:w.isFullScreen(),bounds:w.getBounds(),children:w.contentView.children.map(v=>v.webContents?.id)})),pages:electron.webContents.getAllWebContents().map(w=>({id:w.id,url:w.getURL(),offscreen:w.isOffscreen(),listeners:w.listenerCount('before-input-event')}))};})()`;
const attachedWorldPages = state => {const main=state.pages.find(p=>p.url.includes('/out/renderer/index.html'));const owner=state.windows.find(w=>w.children.includes(main?.id));return state.pages.filter(p=>owner?.children.includes(p.id)&&p.url.startsWith('http://127.0.0.1:'));};
const write=()=>fs.writeFileSync(path.join(directory,'world-create-chain-'+evidenceName+'-report.json'),JSON.stringify(report,null,2));
try{
  for(let i=0;i<250&&(!ready||!nodeWs||!chromeWs)&&!exited;i++)await delay(100);
  if(!ready||!nodeWs)throw Error('STARTUP_NO_INSPECTOR:'+nodeWs);
  socket=new WebSocket(nodeWs);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=e=>{const m=JSON.parse(e.data),p=inspectorPending.get(m.id);if(p){inspectorPending.delete(m.id);m.error||m.result.exceptionDetails?p.reject(Error(JSON.stringify(m))):p.resolve(m.result);}};
  // Default CDP attachment enables focus emulation on every target, including
  // the product's hidden verifier, invalidating its document.hasFocus proof.
  browser=await playwright().chromium.connectOverCDP(chromeWs,{noDefaults:true});
  let bootMode;
  for(let i=0;i<160;i++){bootMode=await rpc('primaryMode').catch(()=>null);if(bootMode?.width>0&&(bootMode.play||bootMode.playWorldId||bootMode.world?.width>0))break;await delay(150);}
  assert.ok(bootMode?.width>0,'renderer mode controls have initialized');
  await rpc('primaryMode',{payload:{action:'entry'}});await delay(500);
  await rpc('primaryMode',{payload:{action:'play'}});await delay(500);
  const secondLevel=await inspect(`(()=>{${guard}return electron.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html')).executeJavaScript("({entry:!!document.querySelector('[data-mode-entry]'),worlds:!!document.querySelector('[data-world-list-state]')})",false);})()`);
  assert.equal(secondLevel.entry,true,'play choice retains entry until world is explicitly chosen');assert.equal(secondLevel.worlds,true,'existing-world second-level selector is visible');report.secondLevel=secondLevel;
  if(!(await rpc('primaryMode')).playWorldId){
    const chooseScript="(()=>{const row=document.querySelector('[data-world-id][data-world-playable=true]:not(:disabled)');if(!row)return false;row[Object.keys(row).find(k=>k.startsWith('__reactProps$'))].onClick();return true;})()";
    await inspect('(async()=>{'+guard+'const wc=electron.webContents.getAllWebContents().find(w=>w.getURL().includes("/out/renderer/index.html"));return wc.executeJavaScript('+JSON.stringify(chooseScript)+',false);})()');await delay(800);
  }
  for(let i=0;i<100;i++){const state=await rpc('primaryMode').catch(()=>null);if(state?.width>0&&state.playWorldId){if(state.entry)await rpc('primaryMode',{payload:{action:'play'}});break;}await delay(150);}

  for(let i=0;i<160;i++){const state=await inspect(statusExpression);if(state.pages.some(p=>p.url.startsWith('http://127.0.0.1:')))break;await delay(150);}
  await delay(10000);
  // An old-world fixture may legitimately replace its formal runtime once for
  // stock-ground maintenance. Establish the test baseline only after that work
  // settles; verifier HTTP pages are never native world children.
  const maintenanceLog=path.join(profile,'logs/app/plugin.log');
  for(let i=0;i<240;i++){
    const records=fs.existsSync(maintenanceLog)?fs.readFileSync(maintenanceLog,'utf8').split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).filter(row=>row.message==='stock ground maintenance'):[];
    report.preflightMaintenance=records.at(-1)?.data??null;
    if(report.preflightMaintenance?.status!=='upgrading')break;
    await delay(500);
  }
  assert.notEqual(report.preflightMaintenance?.status,'upgrading','maintenance must finish before instance retention assertions');

  report.before=await inspect(statusExpression);console.log(JSON.stringify(report.before));
  if(expectFixed){const mainId=report.before.pages.find(p=>p.url.includes('/out/renderer/index.html')).id;assert.equal(report.before.windows.find(w=>w.children.includes(mainId)).fullscreen,true,'play enters actual native fullscreen');}
  const appPage=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html'));
  const snapshot=()=>appPage.evaluate(()=>({layout:JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')),entry:!!document.querySelector('[data-mode-entry]'),pause:!!document.querySelector('[data-craftmine-pause]'),settings:!!document.querySelector('[data-game-settings]'),session:document.querySelector('[data-sidebar-session-row].active')?.getAttribute('data-sidebar-session-row')??document.querySelector('[data-session-pane][data-visible="true"]')?.getAttribute('data-session-pane')??null,worldBounds:(()=>{const r=document.querySelector('.work-plugin-view-surface')?.getBoundingClientRect();return r?{width:r.width,height:r.height}:null})(),dialogs:[...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[aria-modal="true"],dialog[open],[popover]')].map(e=>({html:e.outerHTML.slice(0,600),rects:e.getClientRects().length,hidden:!!e.closest('[hidden],[inert],[aria-hidden="true"]')}))}));
  report.initialRenderer=await snapshot();
  // Read the host-owned scope from the registered handler closure. Electron
  // does not expose additionalArguments in getLastWebPreferences on all builds.
  let pluginScope;
  const handler=await inspectorCommand('Runtime.evaluate',{expression:`(()=>{${guard}return electron.webContents.getAllWebContents().find(w=>w.getURL().includes('/views/world.html')).ipc.listeners('pi-plugin-world-fullscreen-exit')[0];})()`,returnByValue:false});
  const properties=await inspectorCommand('Runtime.getProperties',{objectId:handler.result.objectId});
  const scopes=await inspectorCommand('Runtime.getProperties',{objectId:properties.internalProperties.find(v=>v.name==='[[Scopes]]').value.objectId});
  for(const scope of scopes.result){
    if(!scope.value?.objectId)continue;
    const values=await inspectorCommand('Runtime.getProperties',{objectId:scope.value.objectId});
    const match=values.result.find(v=>v.name==='worldShortcutScope');
    if(match){pluginScope=match.value.value;break;}
  }
  assert.equal(typeof pluginScope,'string','scoped plugin Escape handler retains its identity');
  const emit=async(target,key)=>{
    const selector=target.startsWith('main')?"w.getURL().includes('/out/renderer/index.html')":target==='plugin'?"w.getURL().includes('/views/world.html')":"w.getURL().startsWith('http://127.0.0.1:')";
    const result=await inspect(`(async()=>{${guard}const appOwner=owners.find(owner=>owner.contentView.children.some(view=>view.webContents?.getURL().includes('/out/renderer/index.html')));const wc=appOwner?.contentView.children.map(view=>view.webContents).find(w=>w&&${selector});if(!wc||!wc.isOffscreen())throw Error('HEADLESS_WORLD_GUARD');let prevented=0;
      if(${JSON.stringify(target)}==='main-dom') await wc.executeJavaScript(${JSON.stringify("document.dispatchEvent(new KeyboardEvent('keydown',{key:"+JSON.stringify(key)+",bubbles:true,cancelable:true}))")},false);
      else if(${JSON.stringify(target)}==='plugin'&&${JSON.stringify(key)}==='Escape') {wc.ipc.emit('pi-plugin-world-fullscreen-exit',{senderFrame:wc.mainFrame},{scope:${JSON.stringify(pluginScope)}});}
      else wc.emit('before-input-event',{preventDefault(){prevented++;}},{type:'keyDown',key:${JSON.stringify(key)},code:${JSON.stringify(key)}});
      return {prevented};})()`);
    await delay(800);const state=await snapshot(),native=await inspect(statusExpression);
    await appPage.screenshot({path:path.join(directory,'world-create-chain-'+evidenceName+'-'+target+'-'+key+'.png')});
    report.checks.push({target,key,result,state,native});write();console.log(JSON.stringify({target,key,result,state,native:native.windows}));
    return {state,native,result};
  };
  if(!creationOnly)for(const target of ['main-native','main-dom','plugin','godot']){
    await rpc('primaryMode',{payload:{action:'closed'}});await delay(300);
    const opened=await emit(target,'F2');
    if(expectFixed){
      assert.equal(opened.state.layout.overlay,'compact',target+' opens chat');
      const mainId=opened.native.pages.find(p=>p.url.includes('/out/renderer/index.html')).id;
      assert.equal(opened.native.windows.find(w=>w.children.includes(mainId)).children.at(-1),mainId,target+' raises drawn main overlay');
      assert.ok(opened.state.dialogs.some(d=>d.rects>0&&!d.hidden),target+' paints visible dialog');
    }
    if(opened.state.layout.overlay!=='closed'){
      const closed=await emit(target==='main-native'?'main-dom':target,'Escape');
      if(expectFixed)assert.equal(closed.state.layout.overlay,'closed',target+' Escape closes chat');
    }
  }
  if(expectFixed){
    const click = async selector => {await appPage.waitForFunction(selector=>[...document.querySelectorAll(selector)].some(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[hidden],[inert],[aria-hidden="true"]')&&!node.disabled),selector);return appPage.evaluate(selector=>{const node=[...document.querySelectorAll(selector)].find(node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[hidden],[inert],[aria-hidden="true"]')&&!node.disabled);if(!node)throw Error('CONTROL_CHANGED:'+selector);return node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onClick();},selector);};
    if(!creationOnly){
    const pause=await emit('godot','Escape');
    assert.equal(pause.state.pause,true,'closed Escape opens pause menu');
    assert.equal(pause.state.layout.mode,'play','pause retains play layout');
    const worldId=pause.state.layout.enteredWorldId;
    report.pausedRuntime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}});
    assert.equal(report.pausedRuntime.state,'paused','native runtime acknowledges pause');
    const layoutBeforeSettings=JSON.stringify(pause.state.layout);const nativeBeforeSettings=await inspect(statusExpression);
    await click('[data-pause-action="settings"]');await appPage.waitForSelector('[data-game-settings] .settings-back');await delay(1000);
    report.settingsOpened=await snapshot();report.settingsNative=await inspect(statusExpression);report.settingsRuntime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}});
    assert.equal(report.settingsOpened.settings,true);assert.equal(JSON.stringify(report.settingsOpened.layout),layoutBeforeSettings,'settings preserves exact saved mode and overlay preferences');assert.equal(report.settingsRuntime.state,'paused','settings keeps gameplay paused');
    assert.equal(report.settingsRuntime.instanceId,report.pausedRuntime.instanceId,'settings keeps the same formal runtime even while native children are covered');assert.equal(report.settingsRuntime.buildId,report.pausedRuntime.buildId);
    assert.deepEqual(attachedWorldPages(report.settingsNative).map(p=>p.id),attachedWorldPages(nativeBeforeSettings).map(p=>p.id),'settings retains the original native game instance');
    await appPage.screenshot({path:path.join(directory,'world-create-chain-'+evidenceName+'-settings.png')});
    await click('[data-game-settings] .settings-back');await delay(800);report.settingsReturned=await snapshot();assert.equal(report.settingsReturned.settings,false);assert.equal(report.settingsReturned.pause,true,'settings back returns to the paused game');assert.equal(JSON.stringify(report.settingsReturned.layout),layoutBeforeSettings);
    const resumed=await emit('main-dom','Escape');assert.equal(resumed.state.pause,false,'Escape resumes');
    report.resumedRuntime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}});
    assert.equal(report.resumedRuntime.state,'ready','native runtime acknowledges resume');
    assert.equal(report.resumedRuntime.instanceId,report.pausedRuntime.instanceId,'returning from settings resumes the original formal instance');
    await rpc('primaryMode',{payload:{action:'entry'}});await delay(300);await rpc('primaryMode',{payload:{action:'create'}});await delay(800);
    report.workbenchBeforePaste=await snapshot();report.workbenchNativeBefore=await inspect(statusExpression);
    assert.equal(report.workbenchBeforePaste.layout.mode,'create');assert.ok(report.workbenchBeforePaste.worldBounds?.width>0,'workbench world starts visible');assert.equal(report.workbenchBeforePaste.session,null,'isolated startup begins with an unmaterialized home draft');
    // Invoke the real paste handler with a local in-memory file, exercising
    // materialization and host attachment storage without OS clipboard/picker.
    await appPage.evaluate(async()=>{const editor=document.querySelector('.composer-input');if(!editor||editor.getAttribute('aria-readonly')==='true')throw Error('COMPOSER_BLOCKED');const props=editor[Object.keys(editor).find(k=>k.startsWith('__reactProps$'))];await props.onPaste({currentTarget:editor,preventDefault(){},clipboardData:{files:[new File(['FB02 independent attachment proof'], 'fb02-evidence.txt',{type:'text/plain'})],items:[],getData(){return '';}}});});
    await appPage.waitForFunction(()=>!!document.querySelector('[data-sidebar-session-row].active'));await delay(1000);
    report.workbenchAfterPaste=await snapshot();report.workbenchNativeAfter=await inspect(statusExpression);report.workbenchRuntime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}});
    assert.ok(report.workbenchAfterPaste.session,'paste materializes a real new session');assert.ok(report.workbenchAfterPaste.worldBounds?.width>0&&report.workbenchAfterPaste.worldBounds?.height>0,'world stays visible after real attachment import');assert.equal(report.workbenchAfterPaste.layout.mode,'create');
    assert.deepEqual(attachedWorldPages(report.workbenchNativeAfter).map(p=>p.id),attachedWorldPages(report.workbenchNativeBefore).map(p=>p.id),'attachment materialization retains native game identity');
    const runningWorldIds=attachedWorldPages(report.workbenchNativeAfter).map(p=>p.id);
    for(const worldContentId of runningWorldIds){const ownerBefore=report.workbenchNativeBefore.windows.find(w=>w.children.includes(worldContentId));const ownerAfter=report.workbenchNativeAfter.windows.find(w=>w.children.includes(worldContentId));assert.ok(ownerBefore&&ownerAfter,'same world stays attached to its native owner');assert.equal(ownerAfter.children.indexOf(worldContentId),ownerBefore.children.indexOf(worldContentId),'attachment does not hide world under a different native child order');}
    report.attachmentVisible=await appPage.evaluate(()=>document.querySelector('.composer-input')?.textContent?.includes('fb02-evidence.txt'));assert.equal(report.attachmentVisible,true,'actual imported attachment chip is rendered');
    await appPage.screenshot({path:path.join(directory,'world-create-chain-'+evidenceName+'-attachment.png')});
    }else{
      await rpc('primaryMode',{payload:{action:'entry'}});await delay(300);await rpc('primaryMode',{payload:{action:'create'}});await appPage.waitForFunction(()=>!document.querySelector('[data-mode-entry]'));
      report.creationOnly=true;
    }
    if(process.argv.includes('--dialogue-capture')){
      report.limits.push('Dialogue capture invokes the actual host captureView on its bound native instance; ordinary model tool authorization is validated separately');
      await rpc('primaryMode',{payload:{action:'entry'}});await delay(300);await rpc('primaryMode',{payload:{action:'play'}});await delay(300);
      await click('[data-mode="dialogue"]');await appPage.waitForSelector('[data-dialogue-phase="chat"]',{timeout:120000});await delay(1500);
      report.dialogueNative=await inspect(statusExpression);report.dialogueRenderer=await snapshot();
      const mainId=report.dialogueNative.pages.find(p=>p.url.includes('/out/renderer/index.html')).id;
      const owner=report.dialogueNative.windows.find(w=>w.children.includes(mainId));const worldPage=attachedWorldPages(report.dialogueNative)[0];
      assert.ok(worldPage&&owner.children.includes(worldPage.id),'dialogue keeps the real native world attached');assert.equal(owner.children.at(-1),mainId,'trusted black chat is above the attached native world');
      report.dialogueLayout=await appPage.evaluate(()=>{const pane=document.querySelector('.main-pane'),world=document.querySelector('.work-panel'),rect=pane.getBoundingClientRect();return {background:getComputedStyle(pane).backgroundColor,pane:{width:rect.width,height:rect.height},worldVisibility:getComputedStyle(world).visibility,viewport:{width:innerWidth,height:innerHeight}};});
      report.dialogueHitTest=await appPage.evaluate(()=>{const pane=document.querySelector('.main-pane'),editor=document.querySelector('.composer-input'),rect=editor.getBoundingClientRect();return {centreBelongsToChat:pane.contains(document.elementFromPoint(innerWidth/2,innerHeight/2)),composerVisible:rect.width>0&&rect.height>0&&editor.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))};});
      assert.equal(report.dialogueHitTest.centreBelongsToChat,true,'work panel DOM cannot cover black dialogue');assert.equal(report.dialogueHitTest.composerVisible,true,'dialogue input is visible and unobstructed');
      assert.equal(report.dialogueLayout.background,'rgb(8, 8, 8)');assert.equal(report.dialogueLayout.worldVisibility,'visible','underlying world retains renderable geometry');assert.equal(report.dialogueLayout.pane.width,report.dialogueLayout.viewport.width);
      // Obtain only the already-running host receiver from its registered main
      // IPC closure. Invoke its production captureView with exact live identity;
      // this does not add a public capture bypass, resize or activate anything.
      const handle=await inspectorCommand('Runtime.evaluate',{expression:"process.mainModule.require('electron').ipcMain._invokeHandlers.get('pi-desktop/craftmine/setImmersion')",returnByValue:false});
      async function findWorldHost(functionId,depth=0,visited=new Set()){
        if(!functionId||depth>5||visited.has(functionId))return null;visited.add(functionId);
        const properties=await inspectorCommand('Runtime.getProperties',{objectId:functionId});const scopeId=properties.internalProperties?.find(p=>p.name==='[[Scopes]]')?.value?.objectId;if(!scopeId)return null;
        const scopes=await inspectorCommand('Runtime.getProperties',{objectId:scopeId});const callbacks=[];
        for(const scope of scopes.result){if(!scope.value?.objectId)continue;const vars=await inspectorCommand('Runtime.getProperties',{objectId:scope.value.objectId});const found=vars.result.find(v=>v.name==='godotWorld'&&v.value?.objectId);if(found)return found.value.objectId;for(const entry of vars.result)if(['handler','fn','listener'].includes(entry.name)&&entry.value?.type==='function')callbacks.push(entry.value.objectId);}
        for(const callback of callbacks){const found=await findWorldHost(callback,depth+1,visited);if(found)return found;}return null;
      }
      const receiver=await findWorldHost(handle.result.objectId);assert.ok(receiver,'registered host callback owns the running GodotWorldViewHost');
      const captured=await inspectorCommand('Runtime.callFunctionOn',{objectId:receiver,functionDeclaration:'async function(){'+guard+'const {worldId,buildId,instanceId}=this.instance;const result=await this.captureView({worldId,buildId,instanceId});const pixels=electron.nativeImage.createFromBuffer(Buffer.from(result.pngBase64,"base64")).toBitmap();let colored=0,samples=0;const colors=new Set();for(let i=0;i<pixels.length;i+=64){const b=pixels[i],g=pixels[i+1],r=pixels[i+2];samples++;if(Math.max(r,g,b)-Math.min(r,g,b)>12&&Math.max(r,g,b)>30)colored++;colors.add(r+","+g+","+b);}return {...result,pixels:{colored,samples,uniqueColors:colors.size}};}',awaitPromise:true,returnByValue:true});
      const actual=captured.result.value;fs.writeFileSync(path.join(directory,'world-create-chain-'+evidenceName+'-dialogue-world-capture.png'),Buffer.from(actual.pngBase64,'base64'));delete actual.pngBase64;report.dialogueCapture=actual;
      assert.equal(actual.format,'craftmine.godot-view-capture/1');assert.equal(actual.scope,'formal');assert.ok(actual.pixels.colored>actual.pixels.samples*.1,'capture contains rendered colored world pixels, not the black chat');assert.ok(actual.pixels.uniqueColors>8);assert.ok(actual.width>=320&&actual.height>=240);
      report.dialogueRuntime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId:actual.worldId}});assert.equal(report.dialogueRuntime.state,'paused','covered dialogue pauses gameplay input');
      await appPage.screenshot({path:path.join(directory,'world-create-chain-'+evidenceName+'-dialogue-chat.png')});
      await click('[data-dialogue-phase="chat"] button');await appPage.waitForFunction(()=>!document.querySelector('[data-dialogue-phase]'));await delay(800);report.dialogueReturned=await snapshot();assert.equal(report.dialogueReturned.session,report.workbenchAfterPaste.session,'dialogue cancel returns the original conversation');
    }
    if(process.argv.includes('--normal-create')){
      const readWorlds=()=>appPage.evaluate(()=>piDesktop.pluginPanelInvoke('craftmine.world','world.list',{}));
      const readRuntime=id=>appPage.evaluate(worldId=>piDesktop.pluginPanelInvoke('craftmine.world','godot.runtimeState',{worldId}),id);
      const field=(selector,value)=>appPage.evaluate(({selector,value})=>{const el=document.querySelector(selector);if(!el)throw Error('MISSING_FIELD:'+selector);return el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value}});},{selector,value});
      const submit=()=>appPage.evaluate(()=>{const form=document.querySelector('[data-world-create="form"]');return form[Object.keys(form).find(k=>k.startsWith('__reactProps$'))].onSubmit({preventDefault(){}});});
      const beginForm=async title=>{await rpc('primaryMode',{payload:{action:'entry'}});await delay(300);await rpc('primaryMode',{payload:{action:'play'}});await appPage.waitForFunction(()=>{const el=document.querySelector('[data-mode-entry] [data-action="new-world"]');return el&&!el.disabled;});await click('[data-mode-entry] [data-action="new-world"]');await appPage.waitForSelector('input[name="craftmine-world-base"][value="creation-sandbox"]');await field('input[name="craftmine-world-base"][value="creation-sandbox"]','creation-sandbox');await field('[data-world-create="name"]',title);};
      const before=await readWorlds();report.normalCreateBefore={activeWorldId:before.activeWorldId,session:(await snapshot()).session};
      await beginForm('FB02 原生二级创建 '+Date.now());await submit();
      await appPage.waitForFunction(()=>!document.querySelector('[data-mode-entry]')||!!document.querySelector('[data-mode-entry] [data-world-notice="error"]'),null,{timeout:180000});
      const creationError=await appPage.evaluate(()=>document.querySelector('[data-mode-entry] [data-world-notice="error"]')?.textContent??null);assert.equal(creationError,null,'normal creation must complete its actual factory check');
      const createdList=await readWorlds(),created=createdList.worlds.find(w=>w.id===createdList.activeWorldId);report.normalCreatedWorld=created;report.normalCreatedRenderer=await snapshot();report.normalCreatedRuntime=await readRuntime(created.id);report.normalCreatedNative=await inspect(statusExpression);
      assert.notEqual(created.id,before.activeWorldId);assert.equal(created.state,'ready');assert.ok(['ready','paused','saved'].includes(report.normalCreatedRuntime.state));assert.ok(report.normalCreatedRuntime.instanceId);assert.equal(report.normalCreatedRenderer.layout.mode,'create','secondary creation enters the workbench');assert.notEqual(report.normalCreatedRenderer.session,report.normalCreateBefore.session,'new world has an independent conversation');assert.ok(report.normalCreatedRenderer.worldBounds?.width>0);assert.ok(attachedWorldPages(report.normalCreatedNative).length===1);
      await appPage.screenshot({path:path.join(directory,'world-create-chain-'+evidenceName+'-normal-created.png')});
      const previousIds=new Set(createdList.worlds.map(w=>w.id));const originalSession=report.normalCreatedRenderer.session;
      await beginForm('FB02 取消初始化保留草稿 '+Date.now());await submit();
      await appPage.waitForFunction(()=>document.querySelector('[data-world-create="submit"]')?.disabled===true&&document.querySelector('[data-world-create="form"] button[type="button"]')?.disabled===false);
      await click('[data-world-create="form"] button[type="button"]');
      let afterCancel;for(let i=0;i<120;i++){afterCancel=await readWorlds();if(afterCancel.activeWorldId===created.id&&afterCancel.worlds.some(w=>!previousIds.has(w.id))&&!await appPage.evaluate(()=>!!document.querySelector('[data-world-create="form"]')))break;await delay(500);}
      report.cancelledInitialization={selected:afterCancel.activeWorldId,retainedDrafts:afterCancel.worlds.filter(w=>!previousIds.has(w.id))};assert.equal(afterCancel.activeWorldId,created.id,'cancel restores previous formal world selection');assert.equal(report.cancelledInitialization.retainedDrafts.length,1,'cancel preserves the newly registered draft');
      report.cancelledRuntime=await readRuntime(created.id);assert.equal(report.cancelledRuntime.buildId,report.normalCreatedRuntime.buildId,'cancel does not replace original formal build');await appPage.waitForFunction(()=>{const back=document.querySelector('[data-mode-entry] > .craftmine-mode-back');return back&&!back.disabled;});await click('[data-mode-entry] > .craftmine-mode-back');await delay(500);assert.equal((await snapshot()).session,originalSession,'cancel does not bind the draft to the original conversation');
      const retainedId=report.cancelledInitialization.retainedDrafts[0].id;
      for(let i=0;i<240;i++){const latest=await readWorlds();report.cancelledAfterInitializer={selected:latest.activeWorldId,draft:latest.worlds.find(w=>w.id===retainedId)};assert.equal(latest.activeWorldId,created.id,'late initializer completion must never steal the restored world');if(report.cancelledAfterInitializer.draft?.creation?.stage==='confirm')break;assert.notEqual(report.cancelledAfterInitializer.draft?.state,'failed','retained draft must remain recoverable after cancellation');await delay(500);}
      assert.equal(report.cancelledAfterInitializer.draft?.state,'initializing','unselected draft waits for explicit first-load continuation');assert.equal(report.cancelledAfterInitializer.draft?.creation?.stage,'confirm');
      report.cancelledAfterInitializerRuntime=await readRuntime(created.id);assert.equal(report.cancelledAfterInitializerRuntime.buildId,report.normalCreatedRuntime.buildId);assert.equal((await snapshot()).session,originalSession);
      await appPage.screenshot({path:path.join(directory,'world-create-chain-'+evidenceName+'-cancelled-draft-retained.png')});
      await rpc('primaryMode',{payload:{action:'entry'}});await delay(300);await rpc('primaryMode',{payload:{action:'play'}});
      await click('[data-mode-entry] [data-world-continue="'+retainedId+'"]');
      await appPage.waitForFunction(id=>document.querySelector('[data-mode-entry] [data-world-id="'+id+'"][data-world-playable="true"]')&&document.querySelector('.craftmine-mode-enter-world')?.dataset.activeWorld===id,retainedId,{timeout:120000});
      const resumedList=await readWorlds();report.continuedDraft={selected:resumedList.activeWorldId,world:resumedList.worlds.find(w=>w.id===retainedId),runtime:await readRuntime(retainedId),renderer:await snapshot()};
      assert.equal(report.continuedDraft.selected,retainedId);assert.equal(report.continuedDraft.world.state,'ready');assert.ok(['ready','paused','saved'].includes(report.continuedDraft.runtime.state));assert.equal(report.continuedDraft.renderer.session,originalSession,'explicit preparation changes world selection without rewriting the existing conversation');assert.equal(report.continuedDraft.renderer.entry,true,'ready continuation still requires explicit enter');
      await appPage.screenshot({path:path.join(directory,'world-create-chain-'+evidenceName+'-continued-draft-ready.png')});
    }
    if(!(await snapshot()).entry){await rpc('primaryMode',{payload:{action:'entry'}});await delay(300);await rpc('primaryMode',{payload:{action:'play'}});}
    await appPage.waitForFunction(()=>{const enter=document.querySelector('.craftmine-mode-enter-world');return enter&&!enter.disabled;},null,{timeout:30000});
    await click('.craftmine-mode-enter-world');await appPage.waitForFunction(()=>!document.querySelector('[data-mode-entry]'));await delay(800);
    for(let i=0;i<100;i++){report.finalPlayNative=await inspect(statusExpression);if(attachedWorldPages(report.finalPlayNative).length===1)break;await delay(150);}
    report.finalPlayRenderer=await snapshot();assert.equal(report.finalPlayRenderer.entry,false,'return to play must finish world selection');assert.equal(attachedWorldPages(report.finalPlayNative).length,1,'return to play restores one attached world before input');
    const pauseAgain=await emit('godot','Escape');assert.equal(pauseAgain.state.pause,true);
    report.guardsBeforeQuit=await rpc('guards');
    report.nativeBeforeQuit=await inspect(statusExpression);
    await appPage.evaluate(()=>{const b=document.querySelector('[data-pause-action="exit"]');b[Object.keys(b).find(k=>k.startsWith('__reactProps$'))].onClick();});
    report.menuQuitRequested=true;
    socket.close();await Promise.race([exit,delay(15000)]);
    assert.ok(exited,'save and exit completes the ordered shutdown');
    assert.equal(report.exit.code,0);
    assert.deepEqual(report.exitAudit?.violations,[]);
    assert.deepEqual(report.exitAudit?.shutdownFailures,[]);
    report.passed=true;
  }
  if(!exited){report.after=await inspect(statusExpression);report.guards=await rpc('guards');}
}catch(error){report.error=String(error.stack??error);report.passed=false;process.exitCode=1;console.log(report.error);}
finally{socket?.close();if(!exited){try{await rpc('quit');}catch{}}await Promise.race([exit,delay(8000)]);if(!exited){child.kill();await exit;}await browser?.close().catch(()=>{});log.end();write();console.log(path.join(directory,'world-create-chain-'+evidenceName+'-report.json'));}



