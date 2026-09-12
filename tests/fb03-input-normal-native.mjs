// Full application normal-compositor verification. Only software event callbacks.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';
import {playwright} from '../app/browser-tools.mjs';
const pack=path.resolve(process.argv[2]),directory=path.resolve(process.argv[3]),profile=path.join(directory,'profile'),development=process.argv.includes('--development');
const marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json')));assert.equal(marker.rendering,'normal');
const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token};delete env.ELECTRON_RUN_AS_NODE;
const executable=development?(process.env.FB03_ELECTRON??createRequire('D:/Craftmine World/vendor/pi-desktop/apps/desktop/package.json')('electron')):path.join(pack,'Craftmine World.exe');
const report={checks:[],limits:['Normal compositor with hidden/unfocusable owner and protected parent IPC','No real keyboard/mouse, focus, activation or Pointer Lock','Focused cursor hiding is separately covered by real DOM policy tests; this native run remains genuinely unfocused']};
const child=spawn(executable,[...(development?[pack]:[]),'--inspect=0','--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
const log=fs.createWriteStream(path.join(directory,'fb03-input-normal-electron.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
let ready=false,exited=false,nodeWs,chromeWs,socket,browser,next=1;const pending=new Map(),inspectorPending=new Map();
child.stderr.on('data',bytes=>{const text=bytes.toString();nodeWs??=text.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];chromeWs??=text.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
child.on('message',m=>{if(m.type==='craftmine-headless-ready')ready=true;if(m.type==='craftmine-headless-exit')report.exitAudit=m;const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;report.exit={code,signal};resolve();}));
const rpc=(method,fields={})=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},30000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
const inspectorCommand=(method,params)=>new Promise((resolve,reject)=>{const id=next++;inspectorPending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const inspect=async expression=>(await inspectorCommand('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
const guard=`const electron=process.mainModule.require('electron'),owners=electron.BaseWindow.getAllWindows();if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||owners.some(w=>w.isVisible()||w.isFocusable()))throw Error('NORMAL_ISOLATION_GUARD');`;
const native=()=>inspect(`(()=>{${guard}return {windows:owners.map(w=>({id:w.id,visible:w.isVisible(),focusable:w.isFocusable(),fullscreen:w.isFullScreen(),children:w.contentView.children.map(v=>v.webContents?.id)})),pages:electron.webContents.getAllWebContents().filter(w=>!w.isDestroyed()).map(w=>({id:w.id,url:w.getURL(),offscreen:w.isOffscreen()}))};})()`);
const check=(name,value,evidence)=>{assert.ok(value,name);report.checks.push({name,evidence});console.log(name);};
const write=()=>fs.writeFileSync(path.join(directory,'fb03-input-normal-report.json'),JSON.stringify(report,null,2));
try {
 for(let i=0;i<300&&(!ready||!nodeWs||!chromeWs)&&!exited;i++)await delay(100);
 assert.ok(ready&&nodeWs&&chromeWs,'protected application started');
 socket=new WebSocket(nodeWs);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 socket.onmessage=e=>{const m=JSON.parse(e.data),p=inspectorPending.get(m.id);if(p){inspectorPending.delete(m.id);m.error||m.result.exceptionDetails?p.reject(Error(JSON.stringify(m))):p.resolve(m.result);}};
 browser=await playwright().chromium.connectOverCDP(chromeWs,{noDefaults:true});
 let page;for(let i=0;i<150&&!page;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html'));if(!page)await delay(100);}
 assert.ok(page,'main page');
 const wait=fn=>page.waitForFunction(fn,null,{polling:50,timeout:60000});
 await wait(()=>document.querySelector('[data-mode-entry]')||document.querySelector('.work-plugin-view-surface'));
 await rpc('primaryMode',{payload:{action:'entry'}});await wait(()=>document.querySelector('[data-mode="play"]'));
 await rpc('primaryMode',{payload:{action:'play'}});await wait(()=>document.querySelector('[data-world-list-state]'));
 await wait(()=>[...document.querySelectorAll('[data-world-id="world-e2b39ed23ff7"][data-world-playable=true]')].some(n=>!n.disabled));
 await page.evaluate(()=>{const row=[...document.querySelectorAll('[data-world-id="world-e2b39ed23ff7"][data-world-playable=true]')].find(n=>!n.disabled);row[Object.keys(row).find(k=>k.startsWith('__reactProps$'))].onClick();});
 await wait(()=>{const n=document.querySelector('.craftmine-mode-enter-world');return n&&!n.disabled;});
 await page.evaluate(()=>{const n=document.querySelector('.craftmine-mode-enter-world');n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))].onClick();});
 await wait(()=>!document.querySelector('[data-mode-entry]')&&JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')).mode==='play');
 const worldId=await page.evaluate(()=>JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')).enteredWorldId);
 let runtime;for(let i=0;i<240;i++){runtime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}}).catch(()=>null);if(runtime?.state==='ready')break;await delay(250);}
 assert.equal(runtime?.state,'ready');report.initialRuntime=runtime;
 // A hidden normal owner has no display-driven first paint. Read a snapshot
 // with stayHidden to settle the entry's real layout, without writing bounds
 // or changing renderer scheduling. The later F2 assertion stalls rAF again.
 report.entryPaint=await inspect(`(async()=>{${guard}const wc=electron.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));const previous=wc.getBackgroundThrottling();let result;try {wc.setBackgroundThrottling(false);const image=await wc.capturePage(undefined,{stayHidden:true});result={count:1,id:wc.id,size:image.getSize(),empty:image.isEmpty()};}catch(error){result={count:1,id:wc.id,error:String(error),pixelsVerified:false};}finally{wc.setBackgroundThrottling(previous);}return {...result,previousThrottling:previous,restoredThrottling:wc.getBackgroundThrottling(),temporaryInitialPaint:true};})()`);
 for(let i=0;i<80;i++){const current=await native(),main=current.pages.find(p=>p.url.includes('/out/renderer/index.html')),owner=current.windows.find(w=>w.children.includes(main.id));if(current.pages.some(p=>p.url.startsWith('http://127.0.0.1:')&&owner.children.includes(p.id)))break;await delay(100);}
 const initial=await native(),main=initial.pages.find(p=>p.url.includes('/out/renderer/index.html')),owner=initial.windows.find(w=>w.children.includes(main.id));
 assert.ok(initial.pages.some(p=>p.url.startsWith('http://127.0.0.1:')&&owner.children.includes(p.id)),'the real ready Godot world must be attached before any input test');
 check('main, plugin, and displayed world use normal rendering',initial.pages.filter(p=>owner.children.includes(p.id)).every(p=>!p.offscreen),initial);
 check('play retains actual fullscreen without activating the owner',owner.fullscreen&&!owner.visible&&!owner.focusable);
 // Do not force focus/visibility or continuous paint. Freeze just the app rAF
 // callback source to recreate the normal occluded-overlay circular wait.
 await page.evaluate(()=>{window.__inputFrameProbe={original:requestAnimationFrame,callbacks:0,ids:0};window.requestAnimationFrame=()=>{__inputFrameProbe.callbacks++;return ++__inputFrameProbe.ids;};});
 const state=()=>page.evaluate(()=>({layout:JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')),pause:!!document.querySelector('[data-craftmine-pause]'),frames:__inputFrameProbe.callbacks}));
 const emit=async(target,key,shift=false)=>{
  const result=await inspect(`(async()=>{${guard}const app=electron.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));const owner=owners.find(w=>w.contentView.children.some(v=>v.webContents===app));const pages=owner.contentView.children.map(v=>v.webContents).filter(Boolean);const wc=${JSON.stringify(target)}.startsWith('main')?app:pages.find(w=>${JSON.stringify(target)}==='plugin'?w.getURL().includes('/views/world.html'):w.getURL().startsWith('http://127.0.0.1:'));if(!wc||wc.isOffscreen())throw Error('NORMAL_TARGET_GUARD');let prevented=0;if(${JSON.stringify(target)}==='main-dom')await wc.executeJavaScript(${JSON.stringify(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},shiftKey:${shift},bubbles:true,cancelable:true}))`)},false);else wc.emit('before-input-event',{preventDefault(){prevented++;}},{type:'keyDown',key:${JSON.stringify(key)},code:${JSON.stringify(key)},shift:${shift}});return {id:wc.id,prevented};})()`);
  return result;
 };
 // The input owner changes with the visible UI. Do not manufacture key events
 // for an inactive plugin below the actual game or a full-screen conversation.
 for(const [target,shift] of [['godot',false],['main-native',true]]) {
   const event=await emit(target,'F2',shift),expected=shift?'full':'compact';
   await page.waitForFunction(expected=>JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')).overlay===expected,expected,{polling:50,timeout:5000});
   const current=await state(),windows=await native();check(target+(shift?' Shift+F2':' F2')+' raises the real native app layer with rAF stalled',windows.windows.find(w=>w.id===owner.id).children.at(-1)===main.id,{event,current,windows});
 }
 await emit('main-dom','Escape');await wait(()=>JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')).overlay==='closed');check('Escape closes the full conversation',true);
 await page.evaluate(()=>{window.requestAnimationFrame=__inputFrameProbe.original;});
 await emit('main-dom','Escape');await wait(()=>document.querySelector('[data-craftmine-pause]'));check('closed-world Escape still opens pause',true,await state());
 const finalRuntime=await rpc('worldPanel',{channel:'godot.runtimeState',payload:{worldId}});check('all shortcuts retain the same world/build/instance',finalRuntime.instanceId===runtime.instanceId&&finalRuntime.buildId===runtime.buildId&&finalRuntime.worldId===worldId,finalRuntime);
 const cursor=await inspect(`(async()=>{${guard}const world=electron.webContents.getAllWebContents().find(w=>w.getURL().startsWith('http://127.0.0.1:'));return world.executeJavaScript("({focus:document.hasFocus(),cursor:getComputedStyle(document.querySelector('canvas')).cursor,style:document.querySelector('[data-craftmine-cursor=trusted]')?.textContent,guard:__craftmineHeadless})",false);})()`);
 check('real preload restores cursor while unfocused/paused and never requests lock',cursor.focus===false&&cursor.cursor!=='none'&&cursor.style?.includes('auto')&&cursor.guard.pointerLock===0,cursor);
 await page.evaluate(()=>{window.requestAnimationFrame=__inputFrameProbe.original;});
 report.guards=await rpc('guards');await rpc('quit');socket.close();await Promise.race([exit,delay(15000,undefined,{ref:false})]);
 assert.ok(exited);assert.equal(report.exit.code,0);assert.deepEqual(report.exitAudit?.violations,[]);assert.deepEqual(report.exitAudit?.shutdownFailures,[]);report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;console.log(report.error);
 try {report.failureStatus=await rpc('status');report.failureNative=await native();report.failurePage=await inspect(`(async()=>{${guard}return electron.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html')).executeJavaScript("({text:document.body.innerText.slice(0,4000),layout:localStorage.getItem('craftmine.desktop.layout.v1')})",false);})()`);}catch(diagnostic){report.diagnosticError=String(diagnostic);}
}
finally {socket?.close();if(!exited){try{report.cleanupQuit=await rpc('quit');}catch(error){report.cleanupError=String(error);}}await Promise.race([exit,delay(30000,undefined,{ref:false})]);if(!exited){report.forcedTermination=true;child.kill();await exit;}await browser?.close().catch(()=>{});log.end();write();console.log(path.join(directory,'fb03-input-normal-report.json'));}
