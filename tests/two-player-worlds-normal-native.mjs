// Fresh real application, two original product cards, normal rendering.
// This driver never issues OS input, shows a window, submits a model or binds a task.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{spawn}from'node:child_process';import{randomUUID,createHash}from'node:crypto';import{setTimeout as delay}from'node:timers/promises';import{playwright}from'../app/browser-tools.mjs';
assert.ok(process.argv[2],'Usage: node tests/two-player-worlds-normal-native.mjs EXTRACTED_APP_DIR [--web-visual-only]');
const visualOnly=process.argv.includes('--web-visual-only');
const pack=path.resolve(process.argv[2]);assert.ok(fs.existsSync(path.join(pack,'Craftmine World.exe')));
fs.mkdirSync('D:/CMR/test-results',{recursive:true});const directory=fs.mkdtempSync('D:/CMR/test-results/desktop-native-two-'),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacy);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy,rendering:visualOnly?'offscreen':'normal'}));
const report={directory,profile,package:pack,checks:[],launches:[],attachments:[],scope:'Fresh no-account normal-renderer Web/Godot entry, F2, slot isolation, save and restart. No generated content or bound-conversation claim.',limits:['No OS mouse/keyboard/focus/activation/PointerLock','Only original product callbacks and read/diagnostic APIs','One initial hidden prepaint per launch; no later repaint/bounds assistance']};
if(visualOnly){report.scope='Separate offscreen Web visual observation only; not proof of normal-compositor transitions, input or gameplay.';report.limits=['No model, OS input, focus, activation or PointerLock','Offscreen paint differs from the normal hidden-window acceptance; never substitutes for that evidence','One Web slot entry, screenshot and ordered quit only'];}
const write=()=>fs.writeFileSync(path.join(directory,'two-world-normal-report.json'),JSON.stringify(report,null,2));const check=(name,value,evidence)=>{assert.ok(value,name);report.checks.push({name,evidence});write();console.log('PASS '+name);};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const until=async(read,accept)=>{let value;for(let i=0;i<600;i++){value=await read();if(accept(value))return value;await delay(250);}report.lastUnsettled=value;write();throw Error('STATE_DID_NOT_SETTLE');};
let active;
async function launch(label){
 const record={label,quitEvents:[],uiSamples:[]};report.launches.push(record);
 const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
 for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_CREATION|CRAFTMINE_TEST_|PI_DESKTOP_(CAPTURE|BOOT_PROBE))/.test(key))delete env[key];
 const child=spawn(path.join(pack,'Craftmine World.exe'),['--inspect=0','--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});record.pid=child.pid;
 const log=fs.createWriteStream(path.join(directory,label+'-electron.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 let ready=false,nodeWs,chromeWs,exited=false,browser,page,product,socket,sequence=0;const pending=new Map(),inspectorPending=new Map();
 child.stderr.on('data',bytes=>{const text=bytes.toString();nodeWs??=text.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];chromeWs??=text.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
 child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')record.exitAudit=message;const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(Error(message.error)):waiter.resolve(message.result);}});
 const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;record.exit={code,signal};resolve();}));
 const rpc=(method,fields={})=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
 const inspect=expression=>new Promise((resolve,reject)=>{const id=++sequence;inspectorPending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
 const guard=`const e=process.mainModule.require('electron'),owners=e.BaseWindow.getAllWindows();if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||owners.some(w=>w.isVisible()||w.isFocusable()))throw Error('NORMAL_OWNERSHIP');`;
 const native=()=>inspect(`(async()=>{${guard}return{windows:owners.map(w=>({visible:w.isVisible(),focusable:w.isFocusable(),fullscreen:w.isFullScreen(),children:w.contentView.children.map(v=>({id:v.webContents?.id,bounds:v.getBounds()}))})),pages:await Promise.all(e.webContents.getAllWebContents().filter(w=>!w.isDestroyed()).map(async w=>({id:w.id,url:w.getURL(),offscreen:w.isOffscreen(),scope:w.getURL().startsWith('http://127.0.0.1:')?await w.executeJavaScript('globalThis.craftmineRuntime?.scope??null',false):null})))};})()`);
 const stop=async(request=true)=>{socket?.close();if(!exited&&request)await rpc('quit').catch(()=>{});await Promise.race([exit,delay(25000,undefined,{ref:false})]);if(!exited){record.forced=true;child.kill();await exit;}await browser?.close().catch(()=>{});log.end();write();assert.equal(record.exit?.code,0);assert.equal(record.forced,undefined);assert.deepEqual(record.exitAudit?.violations,[]);assert.deepEqual(record.exitAudit?.pageErrors,[]);assert.deepEqual(record.exitAudit?.shutdownFailures,[]);};
 try{
  await until(()=>({ready,nodeWs,chromeWs,exited}),value=>value.ready&&value.nodeWs&&value.chromeWs||value.exited);assert.ok(!exited&&ready&&nodeWs&&chromeWs);
  socket=new WebSocket(nodeWs);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=event=>{const message=JSON.parse(event.data),waiter=inspectorPending.get(message.id);if(!waiter)return;inspectorPending.delete(message.id);message.error||message.result?.exceptionDetails?waiter.reject(Error(JSON.stringify(message))):waiter.resolve(message.result.result.value);};
  browser=await playwright().chromium.connectOverCDP(chromeWs,{noDefaults:true});page=await until(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html')),Boolean);
  await page.waitForFunction(()=>!!window.piDesktop&&!!document.querySelector('#root')?.children.length,null,{polling:50,timeout:120000});
  await page.exposeFunction('twoWorldQuitEvidence',sample=>{if(sample.event)record.quitEvents.push(sample.event);else record.uiSamples.push(sample);write();});
  await page.evaluate(()=>window.piDesktop.on('pi-desktop/craftmine/quitState',event=>{void globalThis.twoWorldQuitEvidence({event});for(const ms of [0,25,75])setTimeout(()=>void globalThis.twoWorldQuitEvidence({phase:document.querySelector('[data-quit-phase]')?.dataset.quitPhase,buttons:[...document.querySelectorAll('[data-pause-action]')].map(el=>({action:el.dataset.pauseAction,disabled:el.disabled}))}),ms);}));
  const wait=(fn,arg)=>page.waitForFunction(fn,arg,{polling:50,timeout:150000});
  const action=async selector=>{await wait(selector=>[...document.querySelectorAll(selector)].some(el=>!el.disabled&&el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]')),selector);await page.evaluate(selector=>{const el=[...document.querySelectorAll(selector)].find(el=>!el.disabled&&el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]'));if(!el)throw Error('CONTROL_CHANGED');el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onClick();},selector);};
  const navigation=(channel,payload={})=>page.evaluate(({channel,payload})=>window.piDesktop.pluginPanelInvoke('craftmine.world',channel,payload),{channel,payload});
  const getProduct=async()=>{product=await until(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/views/world.html')),Boolean);return product;};
  const panel=async(channel,payload={})=>(await getProduct()).evaluate(({channel,payload})=>window.pluginBridge.invoke(channel,payload),{channel,payload});
  const initialPaint=async()=>{assert.equal(record.initialPaint,undefined,'only one initial paint');record.initialPaint=await inspect(`(async()=>{${guard}const wc=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));const previous=wc.getBackgroundThrottling();try{wc.setBackgroundThrottling(false);const image=await wc.capturePage(undefined,{stayHidden:true});return{count:1,size:image.getSize(),empty:image.isEmpty(),previousThrottling:previous};}catch(error){return{count:1,error:String(error),pixelsVerified:false,previousThrottling:previous};}finally{wc.setBackgroundThrottling(previous);}})()`);};
  const enter=async kind=>{await action('[data-player-world="'+kind+'"]');await wait(()=>{const error=document.querySelector('[data-player-world-error]');if(error)throw Error(error.textContent);return !document.querySelector('[data-mode-entry]')&&JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')??'{}').mode==='play';});const slots=await navigation('world.playerWorlds');assert.equal(slots.activeKind,kind);return slots.slots.find(slot=>slot.kind===kind).worldId;};
  const attached=async(kind,id)=>{let stable=0,lastSize='';const evidence=await until(async()=>{const views=await native(),main=views.pages.find(p=>p.url.includes('/out/renderer/index.html')),owner=views.windows.find(w=>w.children.some(child=>child.id===main?.id));if(!owner)return{ok:false};const game=await getProduct(),surface=await game.evaluate(()=>({id:document.body.dataset.worldId,loaded:document.body.dataset.worldLoaded==='true',godot:document.body.dataset.godot==='true',bounds:(()=>{const r=document.querySelector('iframe')?.getBoundingClientRect();return r?{width:r.width,height:r.height}:null;})()}));if(kind==='web'){const host=views.pages.find(p=>p.url.includes('/views/world.html')),child=owner.children.find(child=>child.id===host?.id);let canvas=null;for(const frame of game.frames().filter(frame=>frame!==game.mainFrame())){canvas=await frame.evaluate(()=>{const el=document.querySelector('canvas'),r=el?.getBoundingClientRect();return el&&r?{width:r.width,height:r.height,pixelWidth:el.width,pixelHeight:el.height,entryGateHidden:document.querySelector('#enter')?.hidden===true}:null;}).catch(()=>null);if(canvas)break;}return{views,surface,canvas,child,ok:surface.id===id&&surface.loaded&&!surface.godot&&host&&!host.offscreen&&child?.bounds.width>0&&child?.bounds.height>0&&canvas?.width>0&&canvas?.height>0&&canvas.entryGateHidden&&Math.abs(canvas.width-child.bounds.width)<=1&&Math.abs(canvas.height-child.bounds.height)<=1&&Math.abs(surface.bounds.width-child.bounds.width)<=1&&Math.abs(surface.bounds.height-child.bounds.height)<=1};}const bound=await rpc('godotCaptureBoundState'),formal=bound.formal;const matches=views.pages.filter(p=>p.scope&&['worldId','buildId','instanceId'].every(key=>p.scope[key]===formal?.[key]));const child=owner.children.find(child=>matches.some(p=>p.id===child.id));return{views,surface,bound,child,ok:surface.id===id&&surface.loaded&&formal?.worldId===id&&!bound.candidate&&matches.length===1&&!matches[0].offscreen&&child?.bounds.width>0&&child?.bounds.height>0};},value=>{const size=JSON.stringify({child:value.child?.bounds,canvas:value.canvas});stable=value.ok?(size===lastSize?stable+1:1):0;lastSize=size;return stable>=2;});report.attachments.push({kind,worldId:id,...evidence});write();return evidence;};
  const shortcut=async(kind,key,shift=false)=>inspect(`(()=>{${guard}const main=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));const owner=owners.find(w=>w.contentView.children.some(v=>v.webContents===main));const attached=owner.contentView.children.map(v=>v.webContents).filter(Boolean);const wc=${JSON.stringify(kind)}==='godot'?attached.find(w=>w.getURL().startsWith('http://127.0.0.1:')):${JSON.stringify(kind)}==='web'?attached.find(w=>w.getURL().includes('/views/world.html')):main;if(!wc||wc.isOffscreen())throw Error('NORMAL_INPUT_OWNER_REQUIRED');let prevented=0;wc.emit('before-input-event',{preventDefault(){prevented++;}},{type:'keyDown',key:${JSON.stringify(key)},code:${JSON.stringify(key)},shift:${shift}});return{webContentsId:wc.id,prevented};})()`);
  const escape=()=>page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  const chat=async(kind,id)=>{await page.evaluate(()=>{window.__twoOriginalRaf=requestAnimationFrame;window.requestAnimationFrame=()=>0;});await shortcut(kind,'F2');await wait(()=>JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')).overlay==='compact');await wait(()=>!document.querySelector('[data-world-conversation-restoring]'));const conversation=await navigation('world.conversation',{worldId:id});assert.equal(conversation.sessionId,null,'fresh profile has no fabricated bound session');const selected=await page.evaluate(()=>document.querySelector('[data-session-pane][data-visible="true"]')?.dataset.sessionPane??null);assert.ok(!selected,'fresh slot stays on home');await shortcut('main','F2',true);await wait(()=>JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')).overlay==='full');await escape();await wait(()=>JSON.parse(localStorage.getItem('craftmine.desktop.layout.v1')).overlay==='closed');await page.evaluate(()=>{window.requestAnimationFrame=__twoOriginalRaf;});return{conversation,selected};};
  const switchCards=async()=>{await escape();await wait(()=>!!document.querySelector('[data-craftmine-pause]'));await action('[data-pause-action="workbench"]');await wait(()=>document.querySelectorAll('[data-player-world]').length===2);};
  const quit=async()=>{await escape();await wait(()=>!!document.querySelector('[data-craftmine-pause]'));await action('[data-pause-action="exit"]');await stop(false);assert.ok(record.quitEvents.some(event=>event.phase==='saving'));assert.ok(record.uiSamples.some(sample=>sample.phase==='saving'&&sample.buttons.length===4&&sample.buttons.every(button=>button.disabled)));};
  const visual=async(kind,id)=>{
    try {
    const before=await native();
    const filename=path.join(directory,label+'-'+kind+'-post-verification.png');
    if(kind==='godot'){
      const bound=await rpc('godotCaptureBoundState');assert.equal(bound.formal?.worldId,id);assert.ok(!bound.candidate);
      const capture=await rpc('godotCaptureBoundView',{payload:{worldId:id,buildId:bound.formal.buildId,instanceId:bound.formal.instanceId}});
      fs.writeFileSync(filename,Buffer.from(capture.pngBase64,'base64'));const{pngBase64,...metadata}=capture;
      (report.visuals??=[]).push({filename,kind,worldId:id,postVerification:true,notTransitionEvidence:true,metadata,before,after:await native()});
    }else{
      const capture=await inspect(`(async()=>{${guard}const wc=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/views/world.html'));const image=await wc.capturePage(undefined,{stayHidden:true});return{png:image.toPNG().toString('base64'),width:image.getSize().width,height:image.getSize().height};})()`);
      fs.writeFileSync(filename,Buffer.from(capture.png,'base64'));
      (report.visuals??=[]).push({filename,kind,worldId:id,postVerification:true,notTransitionEvidence:true,width:capture.width,height:capture.height,before,after:await native()});
    }
    write();
    } catch(error) {
      (report.visuals??=[]).push({kind,worldId:id,postVerification:true,notTransitionEvidence:true,pixelsVerified:false,error:String(error)});write();
    }
  };
  const webVisualState=async()=>{
    const game=await getProduct();
    const state=await game.evaluate(()=>({worldId:document.body.dataset.worldId,loaded:document.body.dataset.worldLoaded==='true',godot:document.body.dataset.godot==='true',viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},geometry:[document.documentElement,document.body,document.querySelector('#surface'),document.querySelector('iframe')].filter(Boolean).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{tag:el.tagName,id:el.id,width:r.width,height:r.height,cssWidth:s.width,cssHeight:s.height,position:s.position,display:s.display}})}));
    for(const frame of game.frames().filter(frame=>frame!==game.mainFrame())){
      const canvas=await frame.evaluate(()=>{const node=document.querySelector('canvas'),rect=node?.getBoundingClientRect();return node&&rect?{width:rect.width,height:rect.height,pixelWidth:node.width,pixelHeight:node.height,viewport:{width:innerWidth,height:innerHeight},enter:{hidden:document.querySelector('#enter')?.hidden}}:null;}).catch(()=>null);
      if(canvas)return{...state,canvas};
    }
    return{...state,canvas:null};
  };
  return{page,record,rpc,native,action,navigation,panel,initialPaint,enter,attached,chat,switchCards,quit,stop,visual,webVisualState};
 }catch(error){await stop().catch(()=>{});throw error;}
}
try{
 if(visualOnly){
  active=await launch('offscreen-web-visual');
  const id=await active.enter('web');report.webId=id;
  let stableVisual=0,previousVisualSize='';report.visualLayoutSamples=[];
  const observed=await until(async()=>{
    const views=await active.native(),world=views.pages.find(page=>page.url.includes('/views/world.html'));
    const owner=views.windows.find(window=>window.children.some(child=>child.id===world?.id));
    const surface=await active.webVisualState();
    const attached=owner?.children.find(child=>child.id===world?.id);
    return {views,surface,attached,ok:!!world?.offscreen&&attached?.bounds.width>0&&attached?.bounds.height>0&&surface.worldId===id&&surface.loaded&&!surface.godot&&surface.canvas?.width>0&&surface.canvas?.height>0&&surface.canvas.enter?.hidden===true&&Math.abs(surface.canvas.width-attached.bounds.width)<=1&&Math.abs(surface.canvas.height-attached.bounds.height)<=1&&Math.abs(surface.viewport.width-attached.bounds.width)<=1&&Math.abs(surface.viewport.height-attached.bounds.height)<=1};
  },value=>{report.visualLayoutSamples.push({at:new Date().toISOString(),surface:value.surface,attached:value.attached});const size=JSON.stringify({surface:value.surface,attached:value.attached});stableVisual=value.ok?(size===previousVisualSize?stableVisual+1:1):0;previousVisualSize=size;return stableVisual>=2;});
  check('the separate visual pass uses the actual Web slot in an attached offscreen view',true,observed);
  await active.visual('web',id);
  const picture=report.visuals?.at(-1);assert.ok(picture?.filename&&fs.existsSync(picture.filename),'offscreen Web capture is available');
  const png=fs.readFileSync(picture.filename);assert.ok(png.length>1000&&png.readUInt32BE(16)>0&&png.readUInt32BE(20)>0);
  check('offscreen Web pixels are saved for a separate human-readable visual review',true,{filename:picture.filename,sha256:createHash('sha256').update(png).digest('hex'),width:png.readUInt32BE(16),height:png.readUInt32BE(20)});
  await active.stop();active=null;report.passed=true;
 }else{
 active=await launch('fresh-web-godot');
 const initial=await active.navigation('world.playerWorlds');report.initialSlots=initial;check('fresh profile exposes exactly two host slots without requiring a model account',initial.slots.length===2&&new Set(initial.slots.map(slot=>slot.kind)).size===2);
 const webId=await active.enter('web');report.webId=webId;await active.initialPaint();await active.attached('web',webId);check('Web card enters a real visible-size normal runtime',true);
 const webBefore=await active.panel('world.read',{id:webId});report.webBefore={buildId:webBefore.world.build.id,snapshot:webBefore.world.snapshot};check('Web F2 and Shift+F2 open and close the world conversation without a fabricated session',true,await active.chat('web',webId));await active.visual('web',webId);
 await active.switchCards();const godotId=await active.enter('godot');report.godotId=godotId;await active.attached('godot',godotId);check('Godot card prepares and attaches a real normal native world',true);const webSaved=await active.panel('world.read',{id:webId});report.webSavedOnSwitch={buildId:webSaved.world.build.id,snapshot:webSaved.world.snapshot};
 check('Godot uses the same F2 home flow without reusing Web conversation state',true,await active.chat('godot',godotId));await active.visual('godot',godotId);
 await active.panel('godot.runtimeSave',{worldId:godotId,freeze:true});const before=await active.panel('world.read',{id:godotId});report.godotBefore={buildId:before.world.build.id,snapshot:before.world.snapshot,sha256:digest(before.world.snapshot)};
 await active.quit();check('normal Save and exit waits for saving and exits without violations',true);active=null;
 active=await launch('restart-and-web-return');await active.initialPaint();const selected=await active.navigation('world.playerWorlds');assert.equal(selected.activeKind,'godot');assert.equal(selected.activeWorldId,godotId);await active.attached('godot',godotId);
 const after=await active.panel('world.read',{id:godotId});assert.equal(after.world.build.id,report.godotBefore.buildId);assert.deepEqual(after.world.snapshot,report.godotBefore.snapshot);check('restart restores selected Godot build and complete committed progress',true);
 await active.chat('godot',godotId);const webStored=await active.panel('world.read',{id:webId});assert.deepEqual(webStored.world.snapshot,report.webSavedOnSwitch.snapshot);await active.switchCards();const returned=await active.enter('web');assert.equal(returned,webId);await active.attached('web',webId);const webAfter=await active.panel('world.read',{id:webId});assert.equal(webAfter.world.build.id,report.webBefore.buildId);assert.equal(webAfter.world.build.id,report.webSavedOnSwitch.buildId);check('switching back enters the same Web slot with preserved progress',true);
 await active.chat('web',webId);await active.quit();check('Web Save and exit also completes through the ordered lifecycle',true);active=null;report.passed=true;
 }
}catch(error){report.error=String(error.stack??error);if(active){report.failureSlots=await active.navigation('world.playerWorlds').catch(()=>null);report.failureDOM=await active.page.evaluate(()=>document.body.innerText.slice(-14000)).catch(()=>null);}process.exitCode=1;}
finally{if(active)await active.stop().catch(error=>report.cleanupError=String(error));write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
