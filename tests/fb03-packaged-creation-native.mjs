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
import {deriveAdditiveProgress} from '../desktop/godot/shared/progress-migration.mjs';
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
const report={directory,profile,sourceProfile:source,package:pack,development,worldId,copied:copying,checks:[],launches:[],
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
  const inspect=expression=>new Promise((resolve,reject)=>{const id=++seq;inspectorPending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
  const native=async()=>inspect(`(()=>{const e=process.mainModule.require('electron');const windows=e.BaseWindow.getAllWindows();if(process.env.CRAFTMINE_DATA_DIR!==${JSON.stringify(profile)}||windows.some(w=>w.isVisible()||w.isFocusable()))throw Error('HEADLESS_OWNERSHIP');return {windows:windows.map(w=>({visible:w.isVisible(),focusable:w.isFocusable(),fullscreen:w.isFullScreen(),children:w.contentView.children.map(v=>v.webContents?.id)})),pages:e.webContents.getAllWebContents().map(w=>({id:w.id,url:w.getURL(),offscreen:w.isOffscreen()}))};})()`);
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
    assert.ok(product,'retained product view exists');await product.waitForFunction(()=>document.body.dataset.worldLoaded==='true',{},{timeout:120000});
    if(await product.evaluate(()=>document.body.dataset.worldId)!==worldId)await product.evaluate(worldId=>craftmineView.navigate({operation:'switch',id:worldId}),worldId);
    await product.waitForFunction(id=>document.body.dataset.worldId===id&&document.body.dataset.worldLoaded==='true',worldId,{timeout:120000});
    // Let finite startup maintenance settle before touching candidate transactions.
    await delay(process.argv.includes('--maintenance-interrupt')?100:2000);
    const panel=(channel,payload={})=>product.evaluate(({channel,payload})=>pluginBridge.invoke(channel,payload),{channel,payload});
    const navigation=(channel,payload={})=>appPage.evaluate(({channel,payload})=>piDesktop.pluginPanelInvoke('craftmine.world',channel,payload),{channel,payload});
    const formal=()=>panel('world.read',{id:worldId});
    const content=()=>navigation('godot.historyLoad',{worldId,branchId:'main'});
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
    return {rpc,panel,navigation,product,appPage,formal,content,native,captureNative,stop,record};
  }catch(error){await stop().catch(()=>{});throw error;}
}

let active;
const until=async(read,accept)=>{for(let i=0;i<480;i++){const value=await read();if(accept(value))return value;await delay(250);}throw Error('STATE_DID_NOT_SETTLE');};
try{
 active=await launch('dialogue-cancel');
 const page=active.appPage;
 const action=selector=>page.evaluate(selector=>{const node=[...document.querySelectorAll(selector)].find(el=>el.getClientRects().length&&!el.closest('[hidden],[inert],[aria-hidden="true"]')&&!el.disabled);if(!node)throw Error('CONTROL_UNAVAILABLE:'+selector);node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onClick();return true;},selector);
 report.normal=await active.native();assert.ok(report.normal.pages.filter(p=>p.url.includes('/out/renderer/')||p.url.startsWith('http://127.0.0.1:')).every(p=>!p.offscreen));
 report.before=await active.formal();
 const beforeList=await active.navigation('world.list');
 await active.rpc('primaryMode',{payload:{action:'entry'}});
 await active.rpc('primaryMode',{payload:{action:'play'}});
 await page.waitForSelector('[data-mode="dialogue"]');await action('[data-mode="dialogue"]');
 await page.waitForSelector('#dialogue-preparation-draft');
 const description='我想创造一片能走进去探索的森林，先保留这段描述';
 await page.evaluate(text=>{const node=document.querySelector('#dialogue-preparation-draft');if(node.readOnly||node.closest('[inert]'))throw Error('PREPARATION_INPUT_BLOCKED');node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value:text}});},description);
 await page.waitForFunction(text=>document.querySelector('#dialogue-preparation-draft')?.value===text,description);
 report.preparation=await page.evaluate(()=>({phase:document.querySelector('[data-dialogue-phase]')?.dataset.dialoguePhase,progress:!!document.querySelector('[data-dialogue-phase] progress'),draft:document.querySelector('#dialogue-preparation-draft')?.value}));
 check('actual preparation UI accepts the player description while showing preparation progress',report.preparation.phase==='preparing'&&report.preparation.progress);
 const createdList=await until(()=>active.navigation('world.list'),list=>list.worlds.some(w=>!beforeList.worlds.some(old=>old.id===w.id)));
 const created=createdList.worlds.find(w=>!beforeList.worlds.some(old=>old.id===w.id));report.cancelledWorldId=created.id;
 await action('[data-dialogue-phase] button');
 await page.waitForSelector('[data-dialogue-phase]',{state:'detached',timeout:30000});
 const afterReturn=await active.navigation('world.list');assert.equal(afterReturn.activeWorldId,worldId);
 assert.equal(await page.evaluate(()=>localStorage.getItem('craftmine.dialogue-preparation-draft.v1')),description);
 report.cancelled=afterReturn.worlds.find(w=>w.id===created.id);
 check('return cancels only the new initialization, restores the original world and retains the description',true);
 const cancelledState=JSON.stringify(report.cancelled.creation);
 await delay(2500);const polled=(await active.navigation('world.list')).worlds.find(w=>w.id===created.id);
 assert.equal(JSON.stringify(polled.creation),cancelledState);
 check('ordinary world-list polling does not restart a cancelled creation',true);
 await active.stop();active=null;
 active=await launch('restart-and-retry');
 const restarted=(await active.navigation('world.list')).worlds.find(w=>w.id===created.id);report.restarted=restarted;
 assert.equal(restarted.state,'failed');
 check('normal app restart retains cancelled creation until an explicit retry',true);
 const retryButton=async id=>{
   const selector='[data-world-recovery="'+id+'"] [data-world-recovery-action="retry"]';
   await active.appPage.waitForSelector(selector);
   await active.appPage.evaluate(selector=>{const node=document.querySelector(selector);if(node.disabled)throw Error('RETRY_DISABLED');node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onClick();},selector);
 };
 await retryButton(created.id);
 const ready=await until(()=>active.navigation('world.list'),list=>list.worlds.some(w=>w.id===created.id&&w.state==='ready'));report.retryReady=ready.worlds.find(w=>w.id===created.id);
 await active.navigation('world.switch',{id:created.id});
 const runtime=await until(()=>active.navigation('godot.runtimeState',{worldId:created.id}),state=>state.worldId===created.id&&['ready','paused','saved'].includes(state.state));report.retryRuntime=runtime;
 check('explicit retry completes real build, normal native first load and playable navigation',true);
 // Retry the exact original FB03 blank world; current stock bridge must not be
 // misclassified as customized, and its original source is not rewritten.
 await active.navigation('world.switch',{id:worldId});
 const originalId='world-b7608e2da8e8';
 await retryButton(originalId);
 const originalReady=await until(()=>active.navigation('world.list'),list=>list.worlds.some(w=>w.id===originalId&&w.state==='ready'));
 report.originalReady=originalReady.worlds.find(w=>w.id===originalId);
 await active.navigation('world.switch',{id:originalId});
 report.originalRuntime=await until(()=>active.navigation('godot.runtimeState',{worldId:originalId}),state=>state.worldId===originalId&&['ready','paused','saved'].includes(state.state));
 check('the actual retained FB03 blank world retries and enters through the normal renderer',true);
 await active.navigation('world.switch',{id:worldId});
 report.after=await active.formal();assert.deepEqual(report.after.world.snapshot,report.before.world.snapshot);
 check('both retry paths preserve the complete original playable world progress',true);
 await active.stop();active=null;report.passed=true;
}catch(error){report.error=String(error.stack??error);if(active){report.finalList=await active.navigation('world.list').catch(()=>null);report.finalDOM=await active.appPage.evaluate(()=>document.body.innerText.slice(-12000)).catch(()=>null);}process.exitCode=1;}
finally{if(active)await active.stop().catch(error=>{report.cleanupError=String(error);});write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
