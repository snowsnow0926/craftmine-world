// The real shipped/development app, real native Godot and Rust domain, copied
// retained player data. Only original product DOM callbacks / scoped APIs run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
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
const viaOtherWorld=process.argv.includes('--via-other-world');
assert.match(worldId,/^[a-z0-9][a-z0-9-]{1,47}$/);
const directory=fs.mkdtempSync(path.join(repo,'test-results/desktop-native-collision-migration-')),profile=path.join(directory,'profile'),legacy=path.join(directory,'legacy'),token=randomUUID();
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
if(viaOtherWorld){const db=new DatabaseSync(path.join(to,'tasks.sqlite'),{readOnly:true});try{const seed=db.prepare('SELECT id,document FROM craftmine_worlds WHERE id<>?').all(worldId).find(row=>!JSON.parse(row.document).build.godot);assert.ok(seed,'an existing non-Godot seed world can open without repairing the target first');settings.activeWorldId=seed.id;fs.writeFileSync(settingsPath,JSON.stringify(settings));}finally{db.close();}}
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const development=fs.existsSync(path.join(pack,'package.json'));
const asar=loadPackageAsar(path.join(repo,'vendor/pi-desktop/apps/desktop'));
const mainText=development?fs.readFileSync(path.join(pack,'out/main/index.js'),'utf8'):asar.extractFile(path.join(pack,'resources/app.asar'),path.normalize('out/main/index.js')).toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance'])assert.ok(mainText.includes(guard),'UNSAFE_APP:'+guard);
const report={directory,profile,sourceProfile:source,package:pack,development,worldId,copied:copying,checks:[],launches:[],
  scope:'real retained product, native Godot and Rust domain; exact old collision guard automatic cold recovery; no source fixture edits or model calls',
  limits:['No real keyboard/mouse, no visible OS window activation','Original source profile is only read during the initial copy; subsequent user changes are not attributed to this run']};
const write=()=>fs.writeFileSync(path.join(directory,'collision-migration-report.json'),JSON.stringify(report,null,2));
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
    let entered=false;const deadline=Date.now()+900000;record.loading=[];let lastState='';
    while(Date.now()<deadline){
      appPage=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/out/renderer/index.html'));
      if(!entered&&appPage&&await appPage.evaluate(()=>!!document.querySelector('[data-mode-entry]'))){entered=true;await rpc('primaryMode',{payload:{action:'create'}});}
      product=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/views/world.html'));
      if(product){const observed=await product.evaluate(()=>({worldId:document.body.dataset.worldId,loaded:document.body.dataset.worldLoaded,state:document.querySelector('#godot-loading')?.dataset.state,visible:document.querySelector('#godot-loading')?.getAttribute('aria-hidden'),error:document.querySelector('#error')?.hidden?'':document.querySelector('#error')?.textContent}));if(JSON.stringify(observed)!==lastState){lastState=JSON.stringify(observed);record.loading.push({...observed,at:Date.now()});write();}if(observed.loaded==='true')break;const failed=maintenance().at(-1)?.data;if(failed?.status==='failed')throw Error('AUTOMATIC_MAINTENANCE_FAILED:'+JSON.stringify(failed));}
      await delay(250);
    }
    assert.ok(product,'retained product view exists');await product.waitForFunction(()=>document.body.dataset.worldLoaded==='true',{},{timeout:120000});
    const expectedWorldId=viaOtherWorld&&label==='cold-old-guard'?settings.activeWorldId:worldId;
    if(await product.evaluate(()=>document.body.dataset.worldId)!==expectedWorldId)await product.evaluate(worldId=>craftmineView.navigate({operation:'switch',id:worldId}),expectedWorldId);
    await product.waitForFunction(id=>document.body.dataset.worldId===id&&document.body.dataset.worldLoaded==='true',expectedWorldId,{timeout:120000});
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

const domainDb=path.join(to,'tasks.sqlite');
const readSaved=()=>{const db=new DatabaseSync(domainDb,{readOnly:true});try{const row=db.prepare('SELECT title,revision,document FROM craftmine_worlds WHERE id=?').get(worldId);return {...row,world:JSON.parse(row.document),document:undefined};}finally{db.close();}};
const buildManifest=buildId=>{
 const root=path.join(to,'godot-builds');
 for(const directory of fs.readdirSync(root)){const file=path.join(root,directory,buildId,'manifest.json');if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file));}
 throw Error('BUILD_NOT_FOUND:'+buildId);
};
const maintenance=()=>{
 const log=path.join(profile,'logs/app/plugin.log');
 return fs.existsSync(log)?fs.readFileSync(log,'utf8').split('\n').filter(line=>line.includes('collision guard maintenance')).map(line=>JSON.parse(line)).filter(row=>row.data?.worldId===worldId):[];
};
report.original=readSaved();report.originalManifest=buildManifest(report.original.world.build.id);
const reposRoot=path.join(to,'content-history/repos');
const originalRefs=()=>Object.fromEntries(fs.readdirSync(reposRoot).map(id=>{const dir=path.join(reposRoot,id,'repo.git');return [id,execFileSync('git',['--git-dir',dir,'show-ref'],{encoding:'utf8',windowsHide:true}).trim().split('\n').map(line=>line.split(' '))];}));
report.originalRefs=originalRefs();
const guardPath='craftmine_shared/progress_collision.gd';
assert.equal(report.originalManifest.files.find(f=>f.path===guardPath)?.sha256,'c194946727f3d382821f04038614d0a38f7f7b66afdb94a3e01a6c0d787c9098');
assert.equal(report.original.world.snapshot.body.player.position[1],0.898971319198608);
// The actual old PCK remains unchanged. Only normal host startup can repair it.
let active;
try{
 active=await launch('cold-old-guard');
 if(viaOtherWorld){
  assert.equal(maintenance().filter(row=>row.data.status==='applied').length,0,'the actual old target must remain unrepaired before the player switches');
  const options=await active.navigation('world.createOptions');
  const base=options.bases.find(base=>base.id==='creation-sandbox');assert.ok(base);
  const created=await active.navigation('world.create',{title:'兼容性切换验收健康世界',baseId:base.id,starterId:base.starters[0].id,operationId:'healthy-'+randomUUID()});
  await active.product.waitForFunction(id=>document.body.dataset.worldId===id&&document.body.dataset.worldLoaded==='true',created.id,{timeout:900000});
  report.healthyBefore={world:await active.panel('world.read',{id:created.id}),snapshot:await active.rpc('godotSnapshot')};
  report.targetBeforeSwitch=await active.formal();assert.equal(report.targetBeforeSwitch.world.build.id,report.original.world.build.id);assert.deepEqual(report.targetBeforeSwitch.world.snapshot,report.original.world.snapshot);
  await active.navigation('world.switch',{id:worldId});
  await active.product.waitForFunction(id=>document.body.dataset.worldId===id&&document.body.dataset.worldLoaded==='true',worldId,{timeout:900000});
  report.healthyAfter=await active.panel('world.read',{id:created.id});assert.deepEqual(report.healthyAfter.world.snapshot,report.healthyBefore.snapshot.state);
  check('selecting an unrepaired old world from a newly created healthy native world automatically saves, migrates and enters it',true);
 }
 report.maintenance=maintenance();const applied=report.maintenance.find(row=>row.data.status==='applied')?.data;
 assert.ok(applied,'automatic startup adopted the checked collision compatibility source');
 report.after={formal:await active.formal(),content:await active.content(),snapshot:await active.rpc('godotSnapshot')};
 assert.notEqual(report.after.formal.world.build.id,report.original.world.build.id);
 assert.deepEqual(report.after.formal.world.snapshot,report.original.world.snapshot);
 assert.deepEqual(report.after.snapshot.state,report.original.world.snapshot);
 check('the legacy saved pose automatically recovers with its exact complete snapshot and no player retry or coordinate edit',true);
 report.newManifest=buildManifest(report.after.formal.world.build.id);
 const retained=manifest=>manifest.files.filter(f=>f.kind==='source'&&f.path!==guardPath);
 assert.deepEqual(retained(report.newManifest),retained(report.originalManifest));
 assert.ok(['c447551cef401e15221d797b33a239a5f65059420cf0f8c2709475eae58594db','cb1eef1113907cbc3462e9a824764988359dde70ace7f984fbe2409b3377e1fb'].includes(report.newManifest.files.find(f=>f.path===guardPath).sha256));
 check('real re-exported PCK changes only the reviewed guard and preserves every original formal source file',true);
 report.history=await active.navigation('godot.historyLoad',{worldId,branchId:applied.branchId});
 report.afterRefs=originalRefs();
 for(const [repoId,refs] of Object.entries(report.originalRefs))for(const [oid,ref] of refs){if(ref===`refs/craftmine/applied/${worldId}`){const current=report.afterRefs[repoId].find(([,name])=>name===ref)?.[0];assert.ok(current);execFileSync('git',['--git-dir',path.join(reposRoot,repoId,'repo.git'),'merge-base','--is-ancestor',oid,current],{windowsHide:true});continue;}assert.ok(report.afterRefs[repoId].some(([newOid,newRef])=>newRef===ref&&newOid===oid),'retained ref '+ref);}
 check('all previous history and draft references remain intact after isolated compatibility adoption',true);
 const originalCandidate=await active.panel('godot.candidateList',{worldId,offset:0,limit:32});
 assert.ok(originalCandidate.items.some(c=>c.buildId===report.original.world.build.id));
 const error=await active.product.locator('#error').isHidden(),loading=await active.product.locator('#godot-loading').isVisible();
 assert.equal(error,true);assert.equal(loading,false);
 check('recovered native world is mounted and clears the failed loader and stale error banner',true);
 report.capture=await active.captureNative('automatically-recovered-world');
 await active.panel('godot.runtimeSave',{worldId,freeze:false});report.beforeQuit=await active.formal();
 report.guards=await active.rpc('guards');await active.stop();active=null;
 active=await launch('reopen-current-guard');
 report.reopened={formal:await active.formal(),content:await active.content(),snapshot:await active.rpc('godotSnapshot')};
 assert.equal(report.reopened.formal.world.build.id,report.beforeQuit.world.build.id);
 assert.deepEqual(report.reopened.formal.world.snapshot,report.beforeQuit.world.snapshot);
 assert.deepEqual(report.reopened.snapshot.state,report.beforeQuit.world.snapshot);
 assert.equal(report.reopened.content.headOid,report.after.content.headOid);
 check('new formal PCK and exact full progress survive clean save, quit and native app restart',true);
 report.finalMaintenance=maintenance();assert.equal(report.finalMaintenance.filter(row=>row.data.status==='applied').length,1);
 await active.stop();active=null;report.passed=true;
}catch(error){report.error=String(error?.stack||error);throw error;}finally{if(active)await active.stop().catch(error=>{report.cleanupError=String(error);});write();}
console.log(directory);
