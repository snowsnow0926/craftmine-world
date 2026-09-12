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
const evidenceName=development?'development':expectFixed?'package':'original';
const {token}=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json'),'utf8'));
const asar=loadPackageAsar(path.resolve('vendor/pi-desktop/apps/desktop'));
const main=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance']) assert.ok(main.includes(guard),'UNSAFE_PACKAGE:'+guard);
const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
delete env.ELECTRON_RUN_AS_NODE;
const executable=development?createRequire(path.join(pack,'package.json'))('electron'):path.join(pack,'Craftmine World.exe');
const child=spawn(executable,[...(development?[pack]:[]),'--inspect=0','--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
const report={package:pack,directory,checks:[],limits:['Finite native callbacks and page script events; no OS keyboard/mouse injection or activation','Renderer pixels plus actual native sibling order; no visible OS-composited screenshot','Requires a previously prepared isolated headless profile, never a player profile']},pending=new Map();let ready=false,exited=false,nodeWs,chromeWs,browser,socket;
const log=fs.createWriteStream(path.join(directory,'shortcuts-electron.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.stderr.on('data',bytes=>{const value=bytes.toString();nodeWs??=value.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];chromeWs??=value.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
child.on('message',m=>{if(m.type==='craftmine-headless-ready')ready=true;if(m.type==='craftmine-headless-exit')report.exitAudit=m;const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;report.exit={code,signal};resolve();}));
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},20000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
let next=1;const inspectorPending=new Map();
const inspectorCommand=(method,params)=>new Promise((resolve,reject)=>{const id=next++;inspectorPending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const inspect=async expression=>(await inspectorCommand('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
const guard=`const electron=process.mainModule.require('electron');const owners=electron.BaseWindow.getAllWindows();if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||owners.some(w=>w.isVisible()||w.isFocusable()))throw Error('HEADLESS_GUARD');`;
const statusExpression=`(()=>{${guard}return {windows:owners.map(w=>({id:w.id,visible:w.isVisible(),focusable:w.isFocusable(),fullscreen:w.isFullScreen(),bounds:w.getBounds(),children:w.contentView.children.map(v=>v.webContents?.id)})),pages:electron.webContents.getAllWebContents().map(w=>({id:w.id,url:w.getURL(),offscreen:w.isOffscreen(),listeners:w.listenerCount('before-input-event')}))};})()`;
const write=()=>fs.writeFileSync(path.join(directory,'shortcuts-'+evidenceName+'-report.json'),JSON.stringify(report,null,2));
try{
  for(let i=0;i<250&&(!ready||!nodeWs||!chromeWs)&&!exited;i++)await delay(100);
  if(!ready||!nodeWs)throw Error('STARTUP_NO_INSPECTOR:'+nodeWs);
  socket=new WebSocket(nodeWs);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=e=>{const m=JSON.parse(e.data),p=inspectorPending.get(m.id);if(p){inspectorPending.delete(m.id);m.error||m.result.exceptionDetails?p.reject(Error(JSON.stringify(m))):p.resolve(m.result);}};
  // Default CDP attachment enables focus emulation on every target, including
  // the product's hidden verifier, invalidating its document.hasFocus proof.
  browser=await playwright().chromium.connectOverCDP(chromeWs,{noDefaults:true});
  for(let i=0;i<100;i++){const state=await rpc('primaryMode').catch(()=>null);if(state?.width>0&&(state.play||state.playWorldId)){if(state.entry)await rpc('primaryMode',{payload:{action:'play'}});break;}await delay(150);}
  // preview.17 deliberately retains the entry until the second-level world
  // choice is confirmed. Exercise that real callback before testing play keys.
  await delay(300);
  const entryPage=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html'));
  if(await entryPage.evaluate(()=>!!document.querySelector('[data-mode-entry] [data-world-list-state]'))){
    const selected=await rpc('primaryMode');assert.ok(selected.playWorldId,'retained playable world is selected in the second-level chooser');
    await rpc('primaryMode',{payload:{action:'play'}});
  }
  for(let i=0;i<160;i++){const state=await inspect(statusExpression);if(state.pages.some(p=>p.url.startsWith('http://127.0.0.1:')))break;await delay(150);}
  await delay(10000);
  report.before=await inspect(statusExpression);console.log(JSON.stringify(report.before));
  if(expectFixed){const mainId=report.before.pages.find(p=>p.url.includes('/out/renderer/index.html')).id;assert.equal(report.before.windows.find(w=>w.children.includes(mainId)).fullscreen,true,'play enters actual native fullscreen');}
  const appPage=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html'));
  const snapshot=()=>appPage.evaluate(()=>({layout:JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')),entry:!!document.querySelector('[data-mode-entry]'),pause:!!document.querySelector('[data-craftmine-pause]'),dialogs:[...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[aria-modal="true"],dialog[open],[popover]')].map(e=>({html:e.outerHTML.slice(0,600),rects:e.getClientRects().length,hidden:!!e.closest('[hidden],[inert],[aria-hidden="true"]')}))}));
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
    await appPage.screenshot({path:path.join(directory,'shortcuts-'+evidenceName+'-'+target+'-'+key+'.png')});
    report.checks.push({target,key,result,state,native});write();console.log(JSON.stringify({target,key,result,state,native:native.windows}));
    return {state,native,result};
  };
  for(const target of ['main-native','main-dom','plugin','godot']){
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
    const pause=await emit('godot','Escape');
    assert.equal(pause.state.pause,true,'closed Escape opens pause menu');
    assert.equal(pause.state.layout.mode,'play','pause retains play layout');
    const worldId=pause.state.layout.enteredWorldId;
    report.pausedRuntime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}});
    assert.equal(report.pausedRuntime.state,'paused','native runtime acknowledges pause');
    const resumed=await emit('main-dom','Escape');assert.equal(resumed.state.pause,false,'Escape resumes');
    report.resumedRuntime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}});
    assert.equal(report.resumedRuntime.state,'ready','native runtime acknowledges resume');
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
finally{socket?.close();if(!exited){try{await rpc('quit');}catch{}}await Promise.race([exit,delay(8000)]);if(!exited){child.kill();await exit;}await browser?.close().catch(()=>{});log.end();write();console.log(path.join(directory,'shortcuts-'+evidenceName+'-report.json'));}



