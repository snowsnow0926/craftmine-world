// The real shipped/development app, real native Godot and Rust domain, copied
// retained player data. Only original product DOM callbacks / scoped APIs run.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {playwright} from '../app/browser-tools.mjs';
import {loadPackageAsar} from '../desktop/package-asar.mjs';
import {deriveAdditiveProgress} from '../desktop/godot/shared/progress-migration.mjs';
import {creationPackageInventory} from './helpers/creation-native-launch.mjs';
import {requirePackagedResources} from './helpers/template-import-expectations.mjs';
assert.ok(process.argv[2]&&process.argv[3]&&process.argv[4],
  'Usage: node tests/fb02-packaged-candidate-lifecycle.mjs APP_DIR READONLY_SOURCE_PROFILE WORLD_ID [--fresh-check]');
const recovery=process.argv.includes('--candidate-reload-recovery');
const option=name=>{const index=process.argv.indexOf(name);if(index<0)return null;assert.ok(process.argv[index+1]&&!process.argv[index+1].startsWith('--'),'VALUE_REQUIRED:'+name);return process.argv[index+1];};
const repo=path.resolve(import.meta.dirname,'..'),pack=path.resolve(option('--packaged-root')??process.argv[2]),source=path.resolve(process.argv[3]),worldId=process.argv[4];
const resources=path.resolve(option('--resources')??path.join(pack,'resources'));
assert.match(worldId,/^[a-z0-9][a-z0-9-]{1,47}$/);
if(recovery){
 assert.ok(option('--packaged-root')&&option('--resources'),'PACKAGED_ROOT_AND_RESOURCES_REQUIRED');
 requirePackagedResources(pack,resources);
 for(const flag of ['--maintenance-interrupt','--settle-maintenance'])assert.ok(!process.argv.includes(flag),'RECOVERY_MODE_CONFLICT:'+flag);
 if(!process.argv.includes('--run')){console.log(JSON.stringify({mode:'prepare-only',pack,resources,source,worldId,modelCalls:0,sourceEdits:0,operations:['real history check','preview','reload retained panel','preview and close','preview and apply','reload committed panel','save and cold reopen']}));process.exit(0);}
}
const results=path.resolve(process.env.CRAFTMINE_CREATION_OUTPUT_ROOT??path.join(repo,'test-results'));fs.mkdirSync(results,{recursive:true});
const directory=fs.mkdtempSync(path.join(results,'desktop-native-candidate-')),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
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
const applicationRows=()=>{const db=new DatabaseSync(path.join(to,'tasks.sqlite'),{readOnly:true});try{return db.prepare('SELECT id,candidate_id,status,created_at,updated_at FROM craftmine_godot_applications WHERE world_id=? ORDER BY created_at,id').all(worldId).map(row=>({...row}));}finally{db.close();}};
const originalApplications=recovery?applicationRows():null;
const readDurableWorld=()=>{const db=new DatabaseSync(path.join(to,'tasks.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT id,revision,document,content_hash FROM craftmine_worlds WHERE id=?').get(worldId);return {id:row.id,revision:row.revision,world:JSON.parse(row.document),contentHash:row.content_hash};}finally{db.close();}};
const readApplication=candidateId=>{const db=new DatabaseSync(path.join(to,'tasks.sqlite'),{readOnly:true});try{const row=db.prepare("SELECT id,input,output FROM craftmine_godot_applications WHERE candidate_id=? AND status='applied'").get(candidateId);assert.ok(row);return {id:row.id,input:JSON.parse(row.input),output:JSON.parse(row.output)};}finally{db.close();}};
function fullDifferences(before,after,at='$'){
 if(JSON.stringify(before)===JSON.stringify(after))return[];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>fullDifferences(before[key],after[key],at+'.'+key));
 return [{path:at,before:before??null,after:after??null}];
}
const settingsPath=path.join(to,'settings.json'),settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));settings.activeWorldId=worldId;fs.writeFileSync(settingsPath,JSON.stringify(settings));
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const development=fs.existsSync(path.join(pack,'package.json'));
if(recovery)assert.equal(development,false,'SHIPPED_PACKAGE_REQUIRED');
const inventory=()=>createHash('sha256').update(JSON.stringify(creationPackageInventory(pack))).digest('hex');
const packageInventorySha256=recovery?inventory():null;
const asar=loadPackageAsar(path.join(process.env.CRAFTMINE_TEST_DEPENDENCY_ROOT??repo,'vendor/pi-desktop/apps/desktop'));
const mainText=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance'])assert.ok(mainText.includes(guard),'UNSAFE_APP:'+guard);
assert.ok(mainText.includes('offscreen: !!headlessAcceptance')||mainText.includes('offscreen: isOffscreenAcceptance()'),'UNSAFE_APP: offscreen guard');
const report={directory,profile,sourceProfile:source,package:pack,development,worldId,copied:copying,checks:[],launches:[],
  scope:'real retained product, native Godot and Rust domain; preserved authored candidate, no model-generation claim',
  limits:['No real keyboard/mouse, no visible OS window activation','Original source profile is only read during the initial copy; subsequent user changes are not attributed to this run']};
if(recovery)Object.assign(report,{mode:'candidate-reload-recovery',resources,packageInventorySha256,originalApplications,modelCalls:0,sourceEditsByHarness:0,frames:[]});
const write=()=>fs.writeFileSync(path.join(directory,'candidate-lifecycle-report.json'),JSON.stringify(report,null,2));
const check=(name,value)=>{assert.ok(value,name);report.checks.push({name,passed:true});write();console.log('PASS '+name);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let cancelled=false;
const cancelFile=path.join(directory,'cancel');if(recovery)report.cancelFile=cancelFile;
const cancel=()=>{cancelled=true;};process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
const cancelWatcher=setInterval(()=>{if(fs.existsSync(cancelFile))cancel();},250);cancelWatcher.unref();
console.log(JSON.stringify({directory,package:pack,worldId}));
async function launch(label){
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,...(recovery?{CRAFTMINE_RUNTIME_RESOURCES:resources}:{})};
  for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|CRAFTMINE_CREATION|CRAFTMINE_TEST_|PI_DESKTOP_(CAPTURE|BOOT_PROBE))/.test(key))delete env[key];
  const child=spawn(development?createRequire(path.join(pack,'package.json'))('electron'):path.join(pack,'Craftmine World.exe'),
    [...(development?[pack]:[]),'--inspect=0','--remote-debugging-port=0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
  const record={label};report.launches.push(record);const pending=new Map(),inspectorPending=new Map();let ready=false,nodeWs,chromeWs,exited=false,socket,browser,appPage,product;
  const log=fs.createWriteStream(path.join(directory,label+'-electron.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  child.stderr.on('data',bytes=>{const text=bytes.toString();nodeWs??=text.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];chromeWs??=text.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];});
  child.on('message',message=>{if(message.type==='craftmine-headless-ready')ready=true;if(message.type==='craftmine-headless-exit')record.exitAudit=message;const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);}});
  const exit=new Promise(resolve=>child.on('exit',(code,signal)=>{exited=true;record.exit={code,signal};resolve();}));
  const rpc=(method,fields={})=>new Promise((resolve,reject)=>{if(cancelled&&method!=='quit')return reject(Error('CANDIDATE_ACCEPTANCE_CANCELLED'));const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC_TIMEOUT:'+method));},120000);pending.set(id,{resolve,reject,timer});child.send({type:'craftmine-headless',id,method,...fields});});
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
      if(appPage&&await appPage.evaluate(()=>!!document.querySelector('[data-mode-entry]'))){
        if(recovery)await appPage.evaluate(id=>{const form=document.querySelector(`[data-world-open="${id}"]`);if(form?.tagName==='FORM'&&!form.querySelector('button')?.disabled)form.requestSubmit();},worldId);
        else await rpc('primaryMode',{payload:{action:'create'}});
      }
      product=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/views/world.html'));
      if(product&&await product.evaluate(()=>document.body.dataset.worldLoaded==='true'))break;
      await delay(250);
    }
    assert.ok(product,'retained product view exists');await product.waitForFunction(()=>document.body.dataset.worldLoaded==='true',{},{timeout:120000});
    if(await product.evaluate(()=>document.body.dataset.worldId)!==worldId)await product.evaluate(worldId=>craftmineView.navigate({operation:'switch',id:worldId}),worldId);
    await product.waitForFunction(id=>document.body.dataset.worldId===id&&document.body.dataset.worldLoaded==='true',worldId,{timeout:120000});
    if(recovery){
      const registry=JSON.parse(fs.readFileSync(path.join(profile,'plugins/registry.json'),'utf8'));
      const rows=Array.isArray(registry)?registry:Object.values(registry.plugins??registry);
      const builtin=rows.find(row=>row&&typeof row==='object'&&(row.id==='craftmine.world'||row.pluginId==='craftmine.world'));
      assert.ok(builtin,'BUILTIN_REGISTRY_REQUIRED');record.builtinRegistry=builtin;
      assert.equal(path.resolve(builtin.path).toLowerCase(),path.join(resources,'plugins/craftmine.world').toLowerCase(),'FINAL_PACKAGE_PLUGIN_BINDING');
    }
    // Let finite startup maintenance settle before touching candidate transactions.
    await delay(process.argv.includes('--maintenance-interrupt')?100:2000);
    const panel=(channel,payload={})=>product.evaluate(({channel,payload})=>pluginBridge.invoke(channel,payload),{channel,payload});
    const navigation=(channel,payload={})=>appPage.evaluate(({channel,payload})=>piDesktop.pluginPanelInvoke('craftmine.world',channel,payload),{channel,payload});
    const formal=()=>panel('world.read',{id:worldId});
    const content=()=>navigation('godot.historyLoad',{worldId,branchId:'main'});
    const captureNative=async (name,candidateId=null)=>{
      const before=await rpc('godotCaptureBoundState');
      assert.equal(before.formal?.worldId,worldId,'capture owns the exact retained formal world');
      if(!candidateId)assert.ok(!before.candidate,'formal evidence never substitutes a candidate view');
      const target=candidateId?before.candidate:before.formal;assert.ok(target);
      const identity={worldId:target.worldId,buildId:target.buildId,instanceId:target.instanceId,...(candidateId?{candidateId}:{})};
      const frame=await rpc('godotCaptureBoundView',{payload:identity});
      const after=await rpc('godotCaptureBoundState');
      assert.deepEqual(after,before,'capture leaves all host identities, state, native view bounds and owner fullscreen unchanged');
      for(const key of ['worldId','buildId','instanceId'])assert.equal(frame[key],identity[key]);
      assert.equal(frame.candidateId,candidateId);assert.equal(frame.scope,candidateId?'candidate':'formal');assert.equal(frame.format,'craftmine.godot-view-capture/1');
      const png=Buffer.from(frame.pngBase64,'base64');assert.ok(png.length<=4*1024*1024);
      assert.equal(createHash('sha256').update(png).digest('hex'),frame.sha256);
      assert.equal(png.readUInt32BE(16),frame.width);assert.equal(png.readUInt32BE(20),frame.height);
      assert.ok(frame.width>0&&frame.width<=1920&&frame.height>0&&frame.height<=1080);
      for(const key of ['sourceWidth','sourceHeight','viewWidth','viewHeight'])assert.ok(Number.isFinite(frame[key])&&frame[key]>0,key+' is actual positive capture metadata');
      const screenshot=path.join(directory,name+'.png');fs.writeFileSync(screenshot,png);
      const {pngBase64,...metadata}=frame;
      const evidence={screenshot,before,after,...metadata,method:'identity-bound capture verifies host visibility, surface visibility and owner child-view attachment before and after capture; no layout or fullscreen mutation'};
      if(recovery){
        const require=createRequire(path.join(process.env.CRAFTMINE_DEPS_ROOT??path.join(repo,'vendor/pi-desktop/packages/agent-runtime'),'package.json'));
        let PNG;try{({PNG}=require('pngjs'));}catch{({PNG}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs')));}
        const decoded=PNG.sync.read(png),colors=new Set();let opaque=0,lit=0,samples=0;
        for(let y=Math.floor(decoded.height*.2);y<decoded.height*.8;y+=4)for(let x=Math.floor(decoded.width*.2);x<decoded.width*.8;x+=4){const i=(y*decoded.width+x)*4; samples++;if(decoded.data[i+3]>0)opaque++;if(Math.max(...decoded.data.subarray(i,i+3))>35)lit++;colors.add([...decoded.data.subarray(i,i+3)].map(v=>v>>3).join(','));}
        evidence.pixels={samples,opaque,lit,colors:colors.size};assert.ok(opaque===samples&&lit>samples*.1&&colors.size>=8,'NONBLANK_WORLD_FRAME_REQUIRED');
        evidence.dom=await product.evaluate(()=>({worldId:document.body.dataset.worldId,loaded:document.body.dataset.worldLoaded,preview:document.body.dataset.previewLoaded??null,state:document.body.dataset.godotState,error:document.querySelector('#error').hidden?'':document.querySelector('#error').textContent,loading:document.querySelector('#godot-loading').getAttribute('aria-hidden'),worldTab:document.querySelector('#world-mode').getAttribute('aria-selected')}));
        assert.equal(evidence.dom.worldId,worldId);assert.equal(evidence.dom.loaded,'true');assert.equal(evidence.dom.preview,candidateId?'true':null);assert.equal(evidence.dom.loading,'true');assert.equal(evidence.dom.error,'');
        evidence.native=await native();report.frames.push(evidence);write();
      }
      return evidence;
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
  if(recovery)await active.panel('godot.runtimeSave',{worldId,freeze:true});
  report.before={formal:await active.formal(),content:await active.content(),snapshot:await active.rpc('godotSnapshot')};write();
  const list=await active.panel('godot.candidateList',{worldId,offset:0,limit:32});report.originalCandidates=list;
  let candidate=list.items.find(c=>c.status==='ready'&&c.buildId!==report.before.formal.world.build.id);
  if(recovery||process.argv.includes('--fresh-check')||!candidate){
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
  let expectedProgress=defaults?deriveAdditiveProgress(originalProgress,defaults).snapshot:originalProgress;
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
  if(recovery){
    report.reloadPreview={before:await active.captureNative('before-preview-reload',candidate.candidateId)};
    await assert.rejects(active.product.evaluate(()=>craftmineView.showSurface({surface:{kind:'checks'}})),/WORLD_BUSY/);
    report.reloadPreview.afterRejectedSurface=await active.rpc('godotCaptureBoundState');
    assert.deepEqual(report.reloadPreview.afterRejectedSurface.formal,report.reloadPreview.before.before.formal);
    assert.deepEqual(report.reloadPreview.afterRejectedSurface.candidate,report.reloadPreview.before.before.candidate);
    // The main preview-controls overlay may raise itself while the rejection
    // is delivered. Preserve that entire native record, but do not require an
    // unrelated overlay's z-order to freeze across two separate UI operations.
    report.reloadPreview.afterRejectedCapture=await active.captureNative('after-rejected-sidebar-surface',candidate.candidateId);
    await active.product.reload({waitUntil:'domcontentloaded'});
    await active.product.waitForFunction(()=>document.body.dataset.worldLoaded==='true'||!document.querySelector('#error').hidden,{},{timeout:120000});
    report.reloadPreview.after=await active.captureNative('after-preview-reload');
    assert.deepEqual(report.reloadPreview.after.before.formal,report.reloadPreview.before.before.formal);
    assert.equal(report.reloadPreview.after.dom.worldTab,'true');
    assert.equal((await active.formal()).world.build.id,report.before.formal.world.build.id);
    check('actual panel reload reconciles its abandoned preview and restores the same attached formal instance',true);
    await openOriginalButton();
  }
  await active.product.screenshot({path:path.join(directory,'original-button-preview.png')});
  const closeBaseline=recovery?(await active.formal()).world.snapshot:originalProgress;
  await active.appPage.waitForSelector('[data-preview-id]',{timeout:10000});
  await active.appPage.evaluate(()=>{const button=[...document.querySelectorAll('[data-preview-id] button')].find(x=>x.textContent==='返回原世界');if(!button||button.disabled)throw Error('CLOSE_DISABLED');return button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))].onClick();});
  await active.product.waitForFunction(()=>document.body.dataset.previewLoaded!=='true');
  const returned=await active.formal();assert.equal(returned.world.build.id,report.before.formal.world.build.id);assert.deepEqual(returned.world.snapshot,closeBaseline);
  check('return to original world preserves formal build and complete progress',true);
  if(recovery)report.closeCapture=await active.captureNative('after-ordinary-preview-close');
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
  if(recovery){
    report.appliedReceipt=readApplication(candidate.candidateId);
    const latest=report.appliedReceipt.input.previousSnapshot??report.appliedReceipt.input.snapshot;
    expectedProgress=defaults?deriveAdditiveProgress(latest,defaults).snapshot:latest;
    assert.deepEqual(report.appliedReceipt.input.snapshot,expectedProgress);assert.deepEqual(report.appliedReceipt.output.snapshot,expectedProgress);
    report.expectedProgress=expectedProgress;
    report.progressDuringOrdinaryPlay=fullDifferences(originalProgress,latest);
  }
  assert.equal(report.after.formal.world.build.id,candidate.buildId);assert.deepEqual(report.after.formal.world.snapshot,expectedProgress);
  assert.equal(report.after.content.headOid,report.before.content.headOid,'existing main draft head preserved');
  check('actual native adoption preserves latest progress and the retained draft head',true);
  if(recovery){
    report.appliedCapture=await active.captureNative('after-ordinary-apply');
    await active.product.reload({waitUntil:'domcontentloaded'});
    await active.product.waitForFunction(()=>document.body.dataset.worldLoaded==='true'||!document.querySelector('#error').hidden,{},{timeout:120000});
    report.appliedReloadCapture=await active.captureNative('after-applied-panel-reload');
    assert.equal(report.appliedReloadCapture.buildId,candidate.buildId);
    assert.deepEqual(report.appliedReloadCapture.before.formal,report.appliedCapture.before.formal);
    assert.equal(report.appliedReloadCapture.dom.worldTab,'true');
    check('applied world remains attached and nonblank after a second real panel reload',true);
  }
  await active.panel('godot.runtimeSave',{worldId,freeze:false});
  report.beforeQuit=await active.formal();report.guards=await active.rpc('guards');report.nativeAfter=await active.native();write();
  await active.stop();active=null;
  if(recovery){report.persistedAfterNormalQuit=readDurableWorld();write();}
  active=await launch('restart');
  report.reopened={formal:await active.formal(),snapshot:await active.rpc('godotSnapshot'),content:await active.content()};
  assert.equal(report.reopened.formal.world.build.id,candidate.buildId);assert.deepEqual(report.reopened.formal.world.snapshot,(recovery?report.persistedAfterNormalQuit:report.beforeQuit).world.snapshot);
  if(recovery){report.runtimeAfterColdResumeDifferences=fullDifferences(report.persistedAfterNormalQuit.world.snapshot,report.reopened.snapshot.state);report.coldPreservationScope='Complete durable snapshot equals the cold-read formal document; all resumed runtime differences are retained separately, without filtering NPC or unknown fields.';}
  assert.equal(report.reopened.content.appliedOid,report.after.content.appliedOid);assert.equal(report.reopened.content.headOid,report.after.content.headOid);
  report.progressHashes={original:hash(originalProgress),applied:hash(report.after.formal.world.snapshot),reopened:hash(report.reopened.formal.world.snapshot)};
  check('adopted build content identity and full saved progress survive native app and Rust restart',true);
  if(recovery){report.coldCapture=await active.captureNative('after-cold-reopen');assert.equal(report.coldCapture.dom.worldTab,'true');}
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
  if(recovery){
    report.finalApplications=applicationRows();
    const applied=report.finalApplications.filter(row=>row.candidate_id===candidate.candidateId&&row.status==='applied');
    assert.equal(applied.length,1,'ONE_DURABLE_CANDIDATE_COMMIT');
    assert.ok(!originalApplications.some(row=>row.id===applied[0].id),'NEW_EXACT_CANDIDATE_COMMIT');
    assert.equal(inventory(),packageInventorySha256,'SHIPPED_PACKAGE_UNCHANGED');
    report.finalPackageInventorySha256=packageInventorySha256;
    check('read-only cold application audit proves exactly one new commit of the checked candidate and unchanged package bytes',true);
  }
  }
}catch(error){report.error=String(error.stack??error);report.passed=false;process.exitCode=1;console.error(report.error);}
finally{if(active)await active.stop().catch(error=>{report.shutdownError=String(error);process.exitCode=1;});clearInterval(cancelWatcher);process.off('SIGINT',cancel);process.off('SIGTERM',cancel);write();console.log(JSON.stringify({directory,passed:report.passed,error:report.error}));}
