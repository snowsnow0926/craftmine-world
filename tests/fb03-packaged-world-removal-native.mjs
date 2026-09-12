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
  'Usage: node tests/fb02-packaged-candidate-lifecycle.mjs APP_DIR READONLY_SOURCE_PROFILE WORLD_ID [--fresh-check]');
const repo=path.resolve(import.meta.dirname,'..'),pack=path.resolve(process.argv[2]),source=path.resolve(process.argv[3]),worldId=process.argv[4];
assert.match(worldId,/^[a-z0-9][a-z0-9-]{1,47}$/);
const directory=fs.mkdtempSync(path.join(repo,'test-results/desktop-native-world-removal-')),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
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
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const development=fs.existsSync(path.join(pack,'package.json'));
const asar=loadPackageAsar(path.join(repo,'vendor/pi-desktop/apps/desktop'));
const mainText=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance'])assert.ok(mainText.includes(guard),'UNSAFE_APP:'+guard);
const report={directory,profile,sourceProfile:source,package:pack,development,worldId,copied:copying,checks:[],launches:[],
  scope:'real retained product, native Godot and Rust domain; failed-world Delete/Recently deleted/Restore via actual main list; no model-generation claim',
  limits:['No real keyboard/mouse, no visible OS window activation','Original source profile is only read during the initial copy; subsequent user changes are not attributed to this run']};
const write=()=>fs.writeFileSync(path.join(directory,'world-removal-report.json'),JSON.stringify(report,null,2));
const check=(name,value)=>{assert.ok(value,name);report.checks.push({name,passed:true});write();console.log('PASS '+name);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
console.log(JSON.stringify({directory,package:pack,worldId}));
async function launch(label){
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
  for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_CREATION|CRAFTMINE_TEST_|PI_DESKTOP_(CAPTURE|BOOT_PROBE))/.test(key))delete env[key];
  const child=spawn(development?createRequire(path.join(pack,'package.json'))('electron'):path.join(pack,'Craftmine World.exe'),
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
try {
 active=await launch('delete-and-restore');
 const click=selector=>active.appPage.evaluate(selector=>{const button=document.querySelector(selector);if(!button||button.disabled)throw Error('BUTTON_UNAVAILABLE:'+selector);return button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))].onClick();},selector);
 await active.appPage.waitForSelector('[data-world-delete]',{timeout:30000});
 const targetId=await active.appPage.evaluate(()=>document.querySelector('[data-world-delete]').getAttribute('data-world-delete'));
 assert.ok(targetId&&targetId!==worldId,'the copied profile contains a genuinely failed, unselected world');report.targetId=targetId;
 report.before={target:await active.panel('world.read',{id:targetId}),healthy:await active.formal()};
 await assert.rejects(active.navigation('world.archiveFailed',{worldId:targetId,deleteFiles:true}),/INVALID_WORLD_ID/);
 const normalCount=await active.appPage.locator('[data-world-id="'+targetId+'"]').count();assert.ok(normalCount);
 await click('[data-world-delete="'+targetId+'"]');
 await active.appPage.waitForSelector('[data-deleted-world-id="'+targetId+'"]',{state:'attached',timeout:30000});
 assert.equal(await active.appPage.locator('[data-world-id="'+targetId+'"]').count(),0);
 assert.deepEqual(await active.panel('world.read',{id:targetId}),report.before.target);
 check('actual Delete button removes the failed row durably while preserving the complete original world record',true);
 await assert.rejects(active.navigation('world.switch',{id:targetId}),/WORLD_ARCHIVED/);
 assert.equal((await active.panel('world.list')).activeWorldId,worldId);
 check('archived world cannot be reopened through a stale direct navigation request',true);
 await active.appPage.evaluate(()=>{document.querySelector('[data-recently-deleted]').open=true;});
 await click('[data-world-restore="'+targetId+'"]');await active.appPage.waitForSelector('[data-world-delete="'+targetId+'"]',{timeout:30000});
 assert.deepEqual(await active.panel('world.read',{id:targetId}),report.before.target);assert.equal((await active.panel('world.list')).activeWorldId,worldId);
 check('Recently deleted Restore returns the same failed row without changing its world, progress or selected world',true);
 // Select the existing durable failure through the real trusted navigation
 // path, without triggering initialization retry or editing its source.
 await active.navigation('world.switch',{id:targetId});
 assert.equal((await active.panel('world.list')).activeWorldId,targetId);
 await active.appPage.waitForSelector('[data-world-id="'+targetId+'"][data-world-active="true"]',{timeout:30000});
 await click('[data-world-delete="'+targetId+'"]');
 await active.appPage.waitForSelector('[data-deleted-world-id="'+targetId+'"]',{state:'attached',timeout:30000});
 const afterList=await active.panel('world.list');report.after={list:afterList,target:await active.panel('world.read',{id:targetId}),healthy:await active.formal()};
 assert.ok(afterList.activeWorldId&&afterList.activeWorldId!==targetId);assert.ok(!afterList.worlds.some(world=>world.id===targetId));
 assert.deepEqual(report.after.target,report.before.target);assert.deepEqual(report.after.healthy.world.snapshot,report.before.healthy.world.snapshot);
 check('deleting a selected failed placeholder uses real retained-view navigation to a usable world and preserves both saved worlds',true);
 await active.appPage.evaluate(()=>{document.querySelector('[data-recently-deleted]').open=true;});
 await active.appPage.screenshot({path:path.join(directory,'recently-deleted-native.png')});
 await active.stop();active=null;
 active=await launch('restart-deleted-world');
 const reopened=await active.panel('world.list'),removed=await active.navigation('world.archivedList');
 assert.ok(!reopened.worlds.some(world=>world.id===targetId));assert.ok(removed.worlds.some(world=>world.id===targetId));assert.deepEqual(await active.panel('world.read',{id:targetId}),report.before.target);
 check('normal app and Rust restart preserve Recently deleted and the original recoverable world record',true);
 report.reopened={list:reopened,removed};await active.stop();active=null;report.passed=true;
} catch(error) {report.error=String(error.stack??error);process.exitCode=1;}
finally {if(active)await active.stop().catch(error=>{report.cleanupError=String(error);});write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
