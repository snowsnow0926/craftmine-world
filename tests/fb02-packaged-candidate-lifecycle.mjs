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
const directory=fs.mkdtempSync(path.join(repo,'test-results/desktop-native-candidate-')),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
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
  scope:'real retained product, native Godot and Rust domain; preserved authored candidate, no model-generation claim',
  limits:['No real keyboard/mouse, no visible OS window activation','Original source profile is only read during the initial copy; subsequent user changes are not attributed to this run']};
const write=()=>fs.writeFileSync(path.join(directory,'candidate-lifecycle-report.json'),JSON.stringify(report,null,2));
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
      const state=await native();
      const attached=new Set(state.windows.flatMap(window=>window.children));
      const selected=state.pages.find(page=>attached.has(page.id)&&page.url.startsWith('http://127.0.0.1:'));
      assert.ok(selected,'actual attached native Godot page');
      const page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url()===selected.url);assert.ok(page);
      const observation=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],devicePixelRatio,focus:document.hasFocus(),guard:globalThis.__craftmineHeadless}));
      assert.equal(observation.focus,false,'capture never emulates focus');
      const screenshot=path.join(directory,name+'.png');await page.screenshot({path:screenshot});
      return {screenshot,native:selected,observation,method:'CDP noDefaults screenshot of the actual attached native page; no viewport resize'};
    };
    return {rpc,panel,navigation,product,appPage,formal,content,native,captureNative,stop,record};
  }catch(error){await stop().catch(()=>{});throw error;}
}
let active;
try{
  active=await launch('first');
  if(process.argv.includes('--maintenance-interrupt')) {
    const logPath=path.join(profile,'logs/app/plugin.log');
    const records=()=>fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8').split('\n').filter(line=>line.includes('stock ground maintenance')).map(line=>JSON.parse(line)).filter(row=>row.data?.worldId===worldId):[];
    const deadline=Date.now()+900000;
    let started;
    while(Date.now()<deadline){started=records().at(-1)?.data;if(started?.status==='upgrading')break;if(started?.status==='applied')throw Error('MAINTENANCE_COMPLETED_BEFORE_INTERRUPT');await delay(100);}
    assert.equal(started?.status,'upgrading');
    report.before={formal:await active.formal(),content:await active.content(),snapshot:await active.rpc('godotSnapshot'),runtime:await active.panel('godot.runtimeState',{worldId})};
    const list=await active.panel('godot.candidateList',{worldId,offset:0,limit:32});
    const candidate=list.items.find(c=>c.status==='ready'&&c.buildId!==report.before.formal.world.build.id);assert.ok(candidate);report.candidate=candidate;
    await active.product.evaluate(()=>craftmineView.showChecks());
    await active.product.waitForFunction(id=>!!document.querySelector(`[data-candidate-id="${id}"] button`),candidate.candidateId);
    await active.product.evaluate(id=>{const b=document.querySelector(`[data-candidate-id="${id}"] button`);if(b.disabled)throw Error('PREVIEW_DISABLED');b.onclick();},candidate.candidateId);
    await active.product.waitForFunction(()=>document.body.dataset.previewLoaded==='true'||!document.querySelector('#error').hidden,{},{timeout:120000});
    assert.equal(await active.product.evaluate(()=>document.body.dataset.previewLoaded),'true',await active.product.locator('#error').textContent());
    report.interrupted=records();assert.ok(report.interrupted.some(row=>row.data.status==='cancelled'));
    assert.equal((await active.formal()).world.build.id,report.before.formal.world.build.id);
    check('original candidate preview cancels background maintenance while retaining the original formal world',true);
    await active.appPage.waitForSelector('[data-preview-id]',{timeout:10000});
    await active.appPage.evaluate(()=>{const b=[...document.querySelectorAll('[data-preview-id] button')].find(x=>x.textContent==='返回原世界');if(!b||b.disabled)throw Error('CLOSE_DISABLED');return b[Object.keys(b).find(k=>k.startsWith('__reactProps$'))].onClick();});
    await active.product.waitForFunction(()=>document.body.dataset.previewLoaded!=='true');
    report.returnedRuntime=await active.panel('godot.runtimeState',{worldId});
    assert.equal(report.returnedRuntime.instanceId,report.before.runtime.instanceId);
    check('leaving preview restores the same formal native instance without reopening the world',true);
    let completed;
    while(Date.now()<deadline){report.maintenance=records();completed=report.maintenance.at(-1)?.data;write();if(completed?.status==='applied')break;if(completed?.status==='failed')throw Error('MAINTENANCE_RETRY_FAILED:'+JSON.stringify(completed));await delay(1000);}
    assert.equal(completed?.status,'applied','maintenance resumes and finishes without reopening');
    const cancelledIndex=report.maintenance.findLastIndex(row=>row.data.status==='cancelled');
    assert.ok(report.maintenance.slice(cancelledIndex+1).some(row=>row.data.status==='upgrading'));
    report.after={formal:await active.formal(),content:await active.content(),snapshot:await active.rpc('godotSnapshot'),maintenance:completed};
    assert.equal(report.after.content.headOid,report.before.content.headOid);assert.deepEqual(report.after.formal.world.snapshot,report.before.snapshot.state);
    const branch=await active.navigation('godot.historyLoad',{worldId,branchId:completed.branchId});
    report.after.branch=branch;
    assert.match(branch.index.files.find(f=>f.path==='scripts/creation_world.gd')?.sha256??'',/^(77f10dffb771464e13f77301fa9dcba180f431b80dc34b1b3e396dc55c84f615|830117)/);
    report.capture=await active.captureNative('resumed-maintenance-native-world');
    check('resumed real check and adoption fixes the stock ground while keeping all progress and the unapplied main draft',true);
    report.guards=await active.rpc('guards');await active.stop();active=null;report.passed=true;
  } else {
  report.before={formal:await active.formal(),content:await active.content(),snapshot:await active.rpc('godotSnapshot')};write();
  const list=await active.panel('godot.candidateList',{worldId,offset:0,limit:32});report.originalCandidates=list;
  let candidate=list.items.find(c=>c.status==='ready'&&c.buildId!==report.before.formal.world.build.id);
  if(process.argv.includes('--fresh-check')||!candidate){
    const index=report.before.content.index;
    report.fixture={kind:'recheck-existing-retained-main-draft',sourceRevision:index.revision,manifestHash:index.manifestHash,sourceModified:false};
    const started=await active.navigation('godot.historyCheck',{worldId,branchId:'main',revision:index.revision,manifestHash:index.manifestHash});
    report.fixture.jobId=started.jobId;write();
    const deadline=Date.now()+900000;
    while(Date.now()<deadline){const job=await active.navigation('godot.historyJob',{worldId,jobId:started.jobId});report.fixture.job=job;write();if(job.status==='passed'){candidate={candidateId:job.candidateId,buildId:job.buildId};break;}if(['failed','blocked','cancelled','interrupted'].includes(job.status))throw Error('REAL_CHECK_FAILED:'+JSON.stringify(job));await delay(1000);}
  }
  assert.ok(candidate?.candidateId,'a real checked candidate is available');report.candidate=candidate;
  report.candidateDetails=await active.panel('godot.candidateRead',{worldId,candidateId:candidate.candidateId});
  const originalProgress=report.before.snapshot.state;
  const defaults=report.candidateDetails.job?.check?.defaultsSnapshot;
  const expectedProgress=defaults?deriveAdditiveProgress(originalProgress,defaults).snapshot:originalProgress;
  report.expectedProgress=expectedProgress;
  // Wrong-world request is a genuine native identity refusal, never data mutation.
  await assert.rejects(active.panel('godot.candidatePreview',{worldId:'world-unrelated-fb02',candidateId:candidate.candidateId}),/WORLD_CHANGED|BINDING|NOT_FOUND/);
  assert.equal((await active.formal()).world.build.id,report.before.formal.world.build.id);check('wrong-world candidate request cannot change the retained formal build',true);
  const openOriginalButton=async()=>{
    await active.product.evaluate(()=>craftmineView.showChecks());
    await active.product.waitForFunction(id=>!!document.querySelector(`[data-candidate-id="${id}"] button`),candidate.candidateId);
    await active.product.evaluate(id=>{const button=document.querySelector(`[data-candidate-id="${id}"] button`);if(button.disabled)throw Error('CANDIDATE_BUTTON_DISABLED');button.onclick();},candidate.candidateId);
    await active.product.waitForFunction(()=>document.body.dataset.previewLoaded==='true'||!document.querySelector('#error').hidden,{},{timeout:120000});
    const state=await active.product.evaluate(()=>({preview:document.body.dataset.previewLoaded,error:document.querySelector('#error').hidden?'':document.querySelector('#error').textContent}));
    assert.equal(state.preview,'true',state.error||'original preview button opens native candidate');
  };
  await openOriginalButton();
  report.preview=await active.panel('godot.candidateState',{worldId,candidateId:candidate.candidateId});
  assert.equal(report.preview.status,'preview');assert.deepEqual((await active.formal()).world.snapshot,originalProgress);
  check('original checks-list preview button opens the real retained-world candidate without adopting it',true);
  await active.product.screenshot({path:path.join(directory,'original-button-preview.png')});
  await active.appPage.waitForSelector('[data-preview-id]',{timeout:10000});
  await active.appPage.evaluate(()=>{const button=[...document.querySelectorAll('[data-preview-id] button')].find(x=>x.textContent==='返回原世界');if(!button||button.disabled)throw Error('CLOSE_DISABLED');return button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))].onClick();});
  await active.product.waitForFunction(()=>document.body.dataset.previewLoaded!=='true');
  const returned=await active.formal();assert.equal(returned.world.build.id,report.before.formal.world.build.id);assert.deepEqual(returned.world.snapshot,originalProgress);
  check('return to original world preserves formal build and complete progress',true);
  await openOriginalButton();
  // Use the actual main-window preview controls above the native sibling;
  // never invoke the raw candidateApply service as an acceptance shortcut.
  await active.appPage.waitForSelector('[data-preview-id]',{timeout:10000});
  report.noticeLayout=await active.appPage.evaluate(()=>{
    const title=document.querySelector('[data-preview-id] strong'),header=document.querySelector('.conversation-topbar');
    const titleRect=title?.getBoundingClientRect(),headerRect=header?.getBoundingClientRect();
    const hasHeader=!!headerRect&&headerRect.width>0&&headerRect.height>0&&getComputedStyle(header).visibility==='visible';
    return {titleTop:titleRect?.top,titleBottom:titleRect?.bottom,headerBottom:hasHeader?headerRect.bottom:null,
      nonOverlapping:!!titleRect&&titleRect.height>0&&titleRect.top>=0&&(!hasHeader||titleRect.top>=headerRect.bottom)};
  });
  if(process.argv.includes('--expect-notice-layout'))check('preview title is drawn below the conversation topbar without clipping',report.noticeLayout.nonOverlapping);
  await active.appPage.screenshot({path:path.join(directory,'candidate-apply-controls.png')});
  await active.appPage.evaluate(()=>{const button=document.querySelector('[data-preview-id] button');if(!button||button.disabled)throw Error('APPLY_DISABLED');return button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))].onClick();});
  await active.product.waitForFunction(()=>document.body.dataset.previewLoaded!=='true'||!document.querySelector('#error').hidden,{},{timeout:120000});
  report.after={formal:await active.formal(),content:await active.content(),snapshot:await active.rpc('godotSnapshot')};
  assert.equal(report.after.formal.world.build.id,candidate.buildId);assert.deepEqual(report.after.formal.world.snapshot,expectedProgress);
  assert.equal(report.after.content.headOid,report.before.content.headOid,'existing main draft head preserved');
  check('actual native adoption preserves latest progress and the retained draft head',true);
  await active.panel('godot.runtimeSave',{worldId,freeze:false});
  report.beforeQuit=await active.formal();report.guards=await active.rpc('guards');report.nativeAfter=await active.native();write();
  await active.stop();active=null;
  active=await launch('restart');
  report.reopened={formal:await active.formal(),snapshot:await active.rpc('godotSnapshot'),content:await active.content()};
  assert.equal(report.reopened.formal.world.build.id,candidate.buildId);assert.deepEqual(report.reopened.formal.world.snapshot,report.beforeQuit.world.snapshot);
  assert.equal(report.reopened.content.appliedOid,report.after.content.appliedOid);assert.equal(report.reopened.content.headOid,report.after.content.headOid);
  report.progressHashes={original:hash(originalProgress),applied:hash(report.after.formal.world.snapshot),reopened:hash(report.reopened.formal.world.snapshot)};
  check('adopted build content identity and full saved progress survive native app and Rust restart',true);
  if(process.argv.includes('--settle-maintenance')) {
    const logPath=path.join(profile,'logs/app/plugin.log');
    const maintenanceRecords=()=>fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8').split('\n').filter(line=>line.includes('stock ground maintenance')).map(line=>JSON.parse(line)).filter(row=>row.data?.worldId===worldId):[];
    const deadline=Date.now()+900000;let final;
    while(Date.now()<deadline){
      report.maintenance=maintenanceRecords();final=report.maintenance.at(-1)?.data;write();
      if(final?.status==='applied')break;
      if(final?.status==='failed'&&!String(final.reason).includes('CANCELLED'))throw Error('POST_ADOPTION_GROUND_FAILED:'+JSON.stringify(final));
      if(final?.status==='skipped')break;
      await delay(1000);
    }
    assert.ok(['applied','skipped'].includes(final?.status),'post-adoption ground maintenance reaches a stable outcome');
    report.settled={formal:await active.formal(),main:await active.content(),maintenance:final,snapshot:await active.rpc('godotSnapshot')};
    assert.equal(report.settled.main.headOid,report.before.content.headOid);assert.deepEqual(report.settled.formal.world.snapshot,expectedProgress);
    if(final.status==='applied') {
      const branch=await active.navigation('godot.historyLoad',{worldId,branchId:final.branchId});report.settled.branch=branch;
      assert.equal(branch.index.nextOffset,null,'full retained draft manifest available for preservation comparison');
      assert.equal(report.before.content.index.nextOffset,null);
      const beforeFiles=report.before.content.index.files.filter(f=>f.path!=='scripts/creation_world.gd').map(f=>[f.path,f.sha256,f.bytes]);
      const afterFiles=branch.index.files.filter(f=>f.path!=='scripts/creation_world.gd').map(f=>[f.path,f.sha256,f.bytes]);
      assert.deepEqual(afterFiles,beforeFiles,'all retained draft content except the precise stock ground script remains byte-identical');
      check('ground recovery preserves the newly adopted player draft files and all progress',true);
    }
    report.capture=await active.captureNative('settled-native-world');
    await active.panel('godot.runtimeSave',{worldId,freeze:false});
    const stable=await active.formal();await active.stop();active=null;active=await launch('settled-restart');
    report.settledReopened={formal:await active.formal(),content:await active.content()};
    assert.equal(report.settledReopened.formal.world.build.id,stable.world.build.id);assert.deepEqual(report.settledReopened.formal.world.snapshot,stable.world.snapshot);
    check('stable recovered ground and retained draft survive a further complete app restart',true);
  }
  await active.stop();active=null;report.passed=true;
  }
}catch(error){report.error=String(error.stack??error);report.passed=false;process.exitCode=1;console.error(report.error);}
finally{if(active)await active.stop().catch(error=>{report.shutdownError=String(error);process.exitCode=1;});write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
