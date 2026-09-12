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
  'Usage: node tests/fb03-packaged-creation-native.mjs APP_DIR READONLY_SOURCE_PROFILE WORLD_ID [--fresh-check]');
const repo=path.resolve(import.meta.dirname,'..'),pack=path.resolve(process.argv[2]),source=path.resolve(process.argv[3]),worldId=process.argv[4];
assert.match(worldId,/^[a-z0-9][a-z0-9-]{1,47}$/);
const directory=fs.mkdtempSync(path.join(repo,'test-results/desktop-native-fb03-creation-')),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacy);
const relativeDomain='plugins/data/craftmine.world',from=path.join(source,relativeDomain),to=path.join(profile,relativeDomain);
fs.mkdirSync(to,{recursive:true});
const copying=[];
for(const name of ['settings.json','asset-catalog','content-history','godot-source','godot-builds']) {
  if(!fs.existsSync(path.join(from,name)))continue;
  fs.cpSync(path.join(from,name),path.join(to,name),{recursive:true,filter:file=>!['LOCK','domain-writer.lock','.craftmine-operation.lock','cache'].includes(path.basename(file))});
  copying.push(name);
}
for(const name of ['godot-worlds','desktop/Local Storage'])if(fs.existsSync(path.join(source,name)))fs.cpSync(path.join(source,name),path.join(profile,name),{recursive:true,filter:file=>path.basename(file)!=='LOCK'});
const sourceDb=new DatabaseSync(path.join(from,'tasks.sqlite'),{readOnly:true});await backup(sourceDb,path.join(to,'tasks.sqlite'));sourceDb.close();
const settingsPath=path.join(to,'settings.json'),settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));settings.activeWorldId=worldId;fs.writeFileSync(settingsPath,JSON.stringify(settings));
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy,rendering:'normal'}));
const development=fs.existsSync(path.join(pack,'package.json'));
const asar=loadPackageAsar(path.join(repo,'vendor/pi-desktop/apps/desktop'));
const mainText=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: isOffscreenAcceptance()'])assert.ok(mainText.includes(guard),'UNSAFE_APP:'+guard);
const report={directory,profile,sourceProfile:source,package:pack,development,worldId,copied:copying,checks:[],launches:[],attachments:[],
  scope:'real retained product, native Godot and Rust domain; normal renderer creation input, cancellation, retained retry and fresh creation; no model-generation claim',
  limits:['No real keyboard/mouse, no visible OS window activation','Original source profile is only read during the initial copy; subsequent user changes are not attributed to this run']};
const write=()=>fs.writeFileSync(path.join(directory,'creation-report.json'),JSON.stringify(report,null,2));
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
  const stop=async()=>{
    socket?.close();if(!exited)await rpc('quit').catch(()=>{});await Promise.race([exit,delay(20000,undefined,{ref:false})]);
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
const cancelledIdentity=world=>({id:world?.id,state:world?.state,stage:world?.creation?.stage,error:world?.creation?.error?.code,operationId:world?.creation?.operationId});
const assertCancelled=world=>{assert.equal(world?.state,'failed');assert.equal(world?.creation?.stage,'cancelled');assert.equal(world?.creation?.error?.code,'GODOT_INITIALIZATION_CANCELLED');};
const jobsFor=id=>{const db=new DatabaseSync(path.join(to,'tasks.sqlite'),{readOnly:true});try{return db.prepare('SELECT id FROM craftmine_godot_jobs WHERE world_id=? ORDER BY id').all(id).map(row=>row.id);}finally{db.close();}};
const pausedSnapshot=async()=>{
 // Freeze through the product's existing save transaction before defining a
 // comparison baseline; legitimate simulation before this checkpoint is not
 // mistaken for cancellation damage. Do not open an unrelated pause modal
 // over the world-selection UI whose controls this test needs to exercise.
 const receipt=await active.panel('godot.runtimeSave',{worldId,freeze:true});
 const runtime=await until(()=>active.navigation('godot.runtimeState',{worldId}),state=>state.worldId===worldId&&['paused','saved'].includes(state.state));
 const snapshot=await active.rpc('godotSnapshot');assert.equal(snapshot.worldId,worldId);assert.ok(snapshot.state?.body,'actual Godot progress envelope');
 const durable=await active.formal();assert.deepEqual(durable.world.snapshot,snapshot.state);
 return {runtime,snapshot,hash:hash(snapshot),receipt};
};
try{
 active=await launch('dialogue-cancel');
 const page=active.appPage;
 report.normal=await active.native();assert.ok(report.normal.pages.filter(p=>p.url.includes('/out/renderer/')||p.url.startsWith('http://127.0.0.1:')).every(p=>!p.offscreen));
 report.beforeGodot=await pausedSnapshot();
 report.before=await active.formal();
 const beforeList=await active.navigation('world.list');
 await active.openWorldList();await active.action('[data-mode="dialogue"]');
 await active.pageWait(()=>!!document.querySelector('#dialogue-preparation-draft'));
 const description='我想创造一片能走进去探索的森林，先保留这段描述';
 report.textareaBefore=await page.evaluate(()=>{const node=document.querySelector('#dialogue-preparation-draft'),rect=node.getBoundingClientRect();return {readOnly:node.readOnly,disabled:node.disabled,inert:!!node.closest('[inert]'),hidden:!!node.closest('[hidden],[aria-hidden="true"]'),pointerEvents:getComputedStyle(node).pointerEvents,width:rect.width,height:rect.height};});
 assert.ok(!report.textareaBefore.readOnly&&!report.textareaBefore.disabled&&!report.textareaBefore.inert&&!report.textareaBefore.hidden&&report.textareaBefore.pointerEvents!=='none'&&report.textareaBefore.width>0&&report.textareaBefore.height>0);
 await page.evaluate(text=>{const node=document.querySelector('#dialogue-preparation-draft');node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value:text}});},description);
 await active.pageWait(text=>document.querySelector('#dialogue-preparation-draft')?.value===text,description);
 report.preparation=await page.evaluate(()=>({phase:document.querySelector('[data-dialogue-phase]')?.dataset.dialoguePhase,progress:!!document.querySelector('[data-dialogue-phase] progress'),draft:document.querySelector('#dialogue-preparation-draft')?.value,queued:document.querySelector('#dialogue-preparation-draft')?.readOnly}));
 check('actual preparation UI accepts the player description while showing preparation progress',report.preparation.phase==='preparing'&&report.preparation.progress);
 const createdList=await until(()=>active.navigation('world.list'),list=>list.worlds.some(w=>!beforeList.worlds.some(old=>old.id===w.id)));
 const additions=createdList.worlds.filter(w=>!beforeList.worlds.some(old=>old.id===w.id));assert.equal(additions.length,1);const created=additions[0];report.cancelledWorldId=created.id;
 await active.action('[data-dialogue-phase] > button');
 await active.pageWait(()=>!document.querySelector('[data-dialogue-phase]'));
 const afterReturn=await until(()=>active.navigation('world.list'),list=>list.activeWorldId===worldId&&list.worlds.find(w=>w.id===created.id)?.creation?.stage==='cancelled');
 assert.equal(await page.evaluate(()=>localStorage.getItem('craftmine.dialogue-preparation-draft.v1')),description);
 report.cancelled=afterReturn.worlds.find(w=>w.id===created.id);assertCancelled(report.cancelled);
 await active.attached(worldId,'dialogue cancellation returns to the actual original native world');
 report.afterDialogueGodot=await pausedSnapshot();assert.deepEqual(report.afterDialogueGodot.snapshot,report.beforeGodot.snapshot);
 check('return cancels only the new initialization, restores the original world and retains the description',true);

 // The ordinary create form has an independent cancel path. Exercise its own
 // base/name controls and asynchronous Cancel button rather than borrowing the
 // dialogue flow's cancellation API.
 const beforeOrdinary=await active.navigation('world.list');await active.openWorldList();await active.action('[data-action="new-world"]');
 await active.pageWait(()=>!!document.querySelector('[data-world-base-option="creation-sandbox"] input:not(:disabled)'));
 await page.evaluate(()=>{const input=document.querySelector('[data-world-base-option="creation-sandbox"] input');input[Object.keys(input).find(k=>k.startsWith('__reactProps$'))].onChange();});
 const ordinaryTitle='FB03 ordinary cancelled draft';
 await page.evaluate(title=>{const input=document.querySelector('[data-world-create="name"]');input[Object.keys(input).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value:title}});},ordinaryTitle);
 await active.pageWait(title=>document.querySelector('[data-world-create="name"]')?.value===title,ordinaryTitle);
 await page.evaluate(()=>{const form=document.querySelector('[data-world-create="form"]');form[Object.keys(form).find(k=>k.startsWith('__reactProps$'))].onSubmit({preventDefault(){}});});
 const ordinaryList=await until(()=>active.navigation('world.list'),list=>list.worlds.some(w=>!beforeOrdinary.worlds.some(old=>old.id===w.id)));
 const ordinaryAdditions=ordinaryList.worlds.filter(w=>!beforeOrdinary.worlds.some(old=>old.id===w.id));assert.equal(ordinaryAdditions.length,1);const ordinary=ordinaryAdditions[0];report.ordinaryCancelledWorldId=ordinary.id;
 await active.action('[data-action="cancel-world-create"]');
 await active.pageWait(()=>!document.querySelector('[data-world-create="form"]'));
 const ordinaryCancelledList=await until(()=>active.navigation('world.list'),list=>list.activeWorldId===worldId&&list.worlds.find(w=>w.id===ordinary.id)?.creation?.stage==='cancelled');
 report.ordinaryCancelled=ordinaryCancelledList.worlds.find(w=>w.id===ordinary.id);assertCancelled(report.ordinaryCancelled);assert.equal(report.ordinaryCancelled.title,ordinaryTitle);
 await active.action('.craftmine-mode-entry > button.craftmine-mode-back');
 await active.pageWait(()=>!document.querySelector('[data-mode-entry]'));await active.attached(worldId,'ordinary create Cancel preserves the original native world');
 report.afterOrdinaryGodot=await pausedSnapshot();assert.deepEqual(report.afterOrdinaryGodot.snapshot,report.beforeGodot.snapshot);
 check('ordinary create Cancel returns to the original world and retains its failed draft',true);
 const cancelledRecords=[report.cancelled,report.ordinaryCancelled].map(cancelledIdentity),cancelledJobs=[created.id,ordinary.id].map(id=>({id,jobs:jobsFor(id)}));report.cancelledJobs=cancelledJobs;
 for(let i=0;i<2;i++){await delay(2500);const list=await active.navigation('world.list');assert.deepEqual([created.id,ordinary.id].map(id=>cancelledIdentity(list.worlds.find(w=>w.id===id))),cancelledRecords);assert.deepEqual([created.id,ordinary.id].map(id=>({id,jobs:jobsFor(id)})),cancelledJobs);}
 check('world-list polling does not restart either cancelled initializer or enqueue new builds',true);
 await active.stop();active=null;
 active=await launch('restart-and-retry');
 const restartedList=await active.navigation('world.list');report.restarted=[created.id,ordinary.id].map(id=>restartedList.worlds.find(w=>w.id===id));report.restarted.forEach(assertCancelled);
 assert.deepEqual(report.restarted.map(cancelledIdentity),cancelledRecords);assert.deepEqual([created.id,ordinary.id].map(id=>({id,jobs:jobsFor(id)})),cancelledJobs);
 assert.equal(await active.appPage.evaluate(()=>localStorage.getItem('craftmine.dialogue-preparation-draft.v1')),description);
 check('normal restart keeps both cancellations and the typed description without new jobs',true);
 const retryButton=async id=>{
   await active.openWorldList();
   const selector='[data-world-recovery="'+id+'"] [data-world-recovery-action="retry"]';
   await active.action(selector);
 };
 await retryButton(created.id);
 const ready=await until(()=>active.navigation('world.list'),list=>list.worlds.some(w=>w.id===created.id&&w.state==='ready'));report.retryReady=ready.worlds.find(w=>w.id===created.id);
 await active.enterWorld(created.id);report.retryRuntime=await active.attached(created.id,'explicit dialogue-draft retry enters its actual normal native world');
 check('UI retry completes real initialization and explicit entry attaches the new native world',true);
 // Retry the exact original FB03 blank world; current stock bridge must not be
 // misclassified as customized, and its original source is not rewritten.
 await active.enterWorld(worldId);await active.attached(worldId,'return to original before retained blank retry');
 const originalId='world-b7608e2da8e8';
 await retryButton(originalId);
 const originalReady=await until(()=>active.navigation('world.list'),list=>list.worlds.some(w=>w.id===originalId&&w.state==='ready'));
 report.originalReady=originalReady.worlds.find(w=>w.id===originalId);
 await active.enterWorld(originalId);report.originalRuntime=await active.attached(originalId,'original FB03 blank-world retry enters its actual native world');
 check('the actual retained FB03 blank world retries and enters through the normal renderer',true);
 await active.enterWorld(worldId);await active.attached(worldId,'return to original after both retry paths');
 report.afterGodot=await pausedSnapshot();assert.deepEqual(report.afterGodot.snapshot,report.beforeGodot.snapshot);
 report.after=await active.formal();assert.deepEqual(report.after.world.snapshot,report.before.world.snapshot);
 check('both retry paths preserve the complete durable and actual Godot progress envelopes',true);
 await active.stop();active=null;report.passed=true;
}catch(error){report.error=String(error.stack??error);if(active){report.finalList=await active.navigation('world.list').catch(()=>null);report.finalDOM=await active.appPage.evaluate(()=>document.body.innerText.slice(-12000)).catch(()=>null);}process.exitCode=1;}
finally{if(active)await active.stop().catch(error=>{report.cleanupError=String(error);});write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
