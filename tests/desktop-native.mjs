// Native Electron acceptance. No Playwright, OS input, dialogs or visible windows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {ProjectStore} from '../app/store.mjs';
import {startDesktopReviewProvider} from './helpers/desktop-review-provider.mjs';
import {loadLocalConfig} from '../app/local-config.mjs';
import {deepseekKey,modelId,modelProvider,thinkingEnabled,reasoningEffort} from '../app/agent-model.mjs';

const liveReview=process.env.CRAFTMINE_TEST_LIVE_REVIEW==='1';
if(liveReview){
  const file=process.env.CRAFTMINE_LIVE_CONFIG;
  assert.ok(file&&path.isAbsolute(file),'Explicit authorized live configuration is required');
  loadLocalConfig(file);
  assert.ok(modelProvider()==='deepseek'&&deepseekKey(),'Configured DeepSeek credentials are required; no fallback');
  assert.notEqual(process.env.CRAFTMINE_TEST_APPLICATION,'1','Choose either a fixed provider or real-model review');
  process.env.CRAFTMINE_TEST_VERIFICATION='1';
}

const repository=path.resolve('.'),desktop=path.join(repository,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const packaged=process.env.CRAFTMINE_PACKAGED_ROOT?path.resolve(process.env.CRAFTMINE_PACKAGED_ROOT):null;
const electron=packaged?path.join(packaged,'Craftmine World.exe'):require('electron');
const resources=packaged?path.join(packaged,'resources'):null;
const readAppFile=relative=>{
  if(!packaged)return fs.readFileSync(path.join(desktop,relative));
  const builderRequire=createRequire(require.resolve('electron-builder'));
  const libRequire=createRequire(builderRequire.resolve('app-builder-lib'));
  return libRequire('@electron/asar').extractFile(path.join(resources,'app.asar'),path.normalize(relative));
};
// Refuse an older or unprepared build before it can show a native window.
const mainSource=readAppFile('out/main/index.js').toString();
for(const guard of ['configureHeadlessAcceptance()', 'focusable: !headlessAcceptance', 'offscreen: !!headlessAcceptance'])assert.ok(mainSource.includes(guard),'Refusing a build without native input isolation: '+guard);
assert.ok(readAppFile('out/preload/craftmine-headless.cjs').length>0,'Headless preload is missing');
if(process.env.CRAFTMINE_TEST_VERIFICATION==='1'||process.env.CRAFTMINE_TEST_APPLICATION==='1') {
  const domain=fs.readFileSync(packaged?path.join(resources,'plugins/craftmine.world/domain.cjs'):path.join(desktop,'resources/plugins/craftmine.world/domain.cjs'),'utf8');
  assert.ok(!domain.includes('node:child_process'),'Refusing a desktop behavior compiler that can spawn Electron as Node');
  assert.ok(fs.readFileSync(packaged?path.join(resources,'plugins/craftmine.world/BABEL_PARSER_LICENSE.txt'):path.join(desktop,'resources/plugins/craftmine.world/BABEL_PARSER_LICENSE.txt')).length>0,'Bundled static parser license missing');
}
fs.mkdirSync('test-results',{recursive:true});
const directory=fs.mkdtempSync(path.resolve('test-results/desktop-native-'));
const profile=path.join(directory,'profile'),legacySource=path.join(directory,'legacy'),token=randomUUID();
fs.mkdirSync(profile);fs.mkdirSync(legacySource);
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
const legacy=new ProjectStore(path.join(legacySource,'.craftmine'));
legacy.change(data=>{data.snapshot.player.x=8;});
const original=fs.readFileSync(legacy.file);
const core=packaged?path.join(resources,'bin/craftmine-core.exe'):process.env.CRAFTMINE_CORE_BIN||path.join(repository,'vendor/pi-desktop/target/release/craftmine-core.exe');
const host=packaged?path.join(resources,'bin/pi-desktop-host-core.exe'):process.env.PI_DESKTOP_HOST_BIN||path.join(repository,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe');
for(const file of [electron,core,host])assert.ok(fs.existsSync(file),'Build prerequisite missing: '+file);
const checks=[],evidence={};
const reviewProvider=process.env.CRAFTMINE_TEST_APPLICATION==='1'?await startDesktopReviewProvider():null;
const check=(name,condition)=>{checks.push({name,passed:!!condition});assert.ok(condition,name);console.log('PASS '+name);};

function launch(label) {
  const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,CRAFTMINE_CORE_BIN:core,PI_DESKTOP_HOST_BIN:host};
  if(reviewProvider){env.CRAFTMINE_TEST_VERIFICATION='1';env.CRAFTMINE_TEST_REVIEW_URL=reviewProvider.url;}
  if(liveReview){env.CRAFTMINE_NATIVE_REVIEW_MODEL=modelId();env.CRAFTMINE_NATIVE_REVIEW_KEY=deepseekKey();env.CRAFTMINE_NATIVE_REVIEW_THINKING=thinkingEnabled()?reasoningEffort():'off';}
  delete env.ELECTRON_RUN_AS_NODE;
  for(const name of Object.keys(env))if(/^PI_DESKTOP_(CAPTURE|BOOT_PROBE|SUPERVISION_PROBE|PLAN_UI_PROBE)/.test(name))delete env[name];
  const child=spawn(electron,packaged?[]:[desktop],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env});
  const pending=new Map();let ready=false,ended=false,exitResult,exitAudit;
  const output=fs.createWriteStream(path.join(directory,label+'.log'));
  child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
  const exit=new Promise(resolve=>{
    const finish=value=>{if(ended)return;ended=true;exitResult=value;output.end();for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Electron exited: '+JSON.stringify(value)));}pending.clear();resolve(value);};
    child.once('error',error=>finish({error:String(error)}));
    child.once('exit',(code,signal)=>finish({code,signal}));
  });
  child.on('message',message=>{
    if(message?.type==='craftmine-headless-exit'){exitAudit=message;return;}
    if(message?.type==='craftmine-headless-ready'){ready=true;return;}
    if(message?.type!=='craftmine-headless')return;
    const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
    if(message.error)item.reject(Error(message.error));else item.resolve(message.result);
  });
  const rpc=(method,payload={},timeout=10000)=>new Promise((resolve,reject)=>{
    if(ended||!child.connected)return reject(Error('Electron is not running: '+JSON.stringify(exitResult)));
    const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Native RPC timeout: '+method));},timeout);
    pending.set(id,{resolve,reject,timer});
    child.send({type:'craftmine-headless',id,method,...payload},error=>{if(error&&pending.has(id)){pending.delete(id);clearTimeout(timer);reject(error);}});
  });
  const until=async(run,predicate,description,timeout=30000)=>{
    const deadline=Date.now()+timeout;let value,lastError;
    do {
      if(ended)throw Error(description+': Electron exited '+JSON.stringify(exitResult));
      try{value=await run();if(predicate(value))return value;}catch(error){lastError=error;}
      await delay(150);
    }while(Date.now()<deadline);
    throw Error(description+': '+JSON.stringify(value)+' '+String(lastError||''));
  };
  return {child,rpc,until,exit,get ended(){return ended;},get audit(){return exitAudit;},
    ready:()=>until(async()=>ready,value=>value,'Native controller did not initialize'),
    state:(predicate=state=>state.loaded&&!state.disabled)=>until(()=>rpc('worldState'),predicate,'World did not reach its expected state'),
    stop:async()=>{
      if(ended)return;
      try{await rpc('quit',{},2000);}catch{}
      await Promise.race([exit,delay(7000)]);
      if(!ended){child.kill();await exit;}
    },
  };
}

let client,lock;
try {
  client=launch('first-start');await client.ready();
  const initial=await client.state();
  const status=await client.rpc('status');evidence.initialStatus=status;
  check('原生客户端启动真实 Rust 宿主和内置世界插件',status.runtime.hostAvailable&&status.runtime.plugins.includes('craftmine.world')&&initial.loaded);
  check('原生窗口全程离屏、不可聚焦且未显示',status.windows.length===1&&status.windows.every(window=>!window.visible&&!window.focused&&!window.focusable&&window.offscreen)&&status.violations.length===0);
  check('客户端使用本次独立配置目录',path.resolve(status.profile)===path.join(profile,'desktop'));
  const desktopState=await client.rpc('desktopState');evidence.desktop=desktopState;
  check('真实 React 前端通过沙箱 preload 与 Electron 通信',desktopState.version.ok===true&&/craftmine|最中幻想/i.test(desktopState.text));
  const guards=await client.rpc('guards');evidence.guards=guards;
  check('桌面、世界面板和游戏初始化时均禁止鼠标锁定与焦点请求',guards.length>=3&&guards.every(frame=>frame.guard&&frame.guard.pointerLock===0&&frame.guard.focus===0));
  check('实际游戏隔离帧无法访问 Node 或插件桥',guards.some(frame=>frame.url==='about:srcdoc'&&frame.node==='undefined'&&frame.bridge==='undefined'));
  if(process.env.CRAFTMINE_TEST_NAVIGATION==='1') {
    const nav=(channel,payload={})=>client.rpc('worldNavigation',{channel,payload},20000);
    const list=await nav('world.list');
    check('左栏真实 preload IPC 读取 Rust 世界列表',list.activeWorldId===initial.id&&list.worlds.some(item=>item.id===initial.id));
    const initialRows=await client.until(()=>client.rpc('worldNavigationRows'),rows=>rows.some(row=>row.id===initial.id&&row.active&&row.text.includes('网页体素')),'World rows or base label did not refresh after bootstrap');
    check('真实左栏在首次创建后自动显示当前世界',initialRows.some(row=>row.id===initial.id&&row.active));
    const options=await nav('world.createOptions');
    check('创建目录只列出已接通的体素空白底座',options.bases.length===1&&options.bases[0].id==='craftmine-web/5'&&options.bases[0].delivered);
    await assert.rejects(nav('world.saveProgress',{id:initial.id,snapshot:{}}),/PERMISSION_DENIED/);
    await assert.rejects(nav('godot.applicationPrepare',{}),/PERMISSION_DENIED/);
    check('原生导航 IPC 拒绝原始存档写入和应用令牌',true);
    await assert.rejects(nav('world.create',{title:'Unavailable',baseId:'top-down'}),/WORLD_BASE_UNAVAILABLE/);
    check('未交付底座创建失败后选择和世界数量不变',(await nav('world.list')).worlds.length===list.worlds.length&&(await client.state()).id===initial.id);
    const created=await nav('world.create',{title:'Navigation acceptance',baseId:'craftmine-web/5',starterId:'blank'});
    await client.state(state=>state.loaded&&state.id===created.id&&!state.disabled);
    const switched=await nav('world.switch',{id:initial.id});
    await client.state(state=>state.loaded&&state.id===initial.id&&!state.disabled);
    check('原生创建和切换通过保留视图保存后完成',switched.ok&&switched.activeWorldId===initial.id);
    const changedRows=await client.until(()=>client.rpc('worldNavigationRows'),rows=>rows.some(row=>row.id===created.id)&&rows.some(row=>row.id===initial.id&&row.active),'World rows did not follow navigation');
    check('真实左栏收到宿主变更并同步世界及当前标记',changedRows.some(row=>row.id===created.id));
    const navDatabase=path.join(profile,'plugins/data/craftmine.world/tasks.sqlite');
    lock=new DatabaseSync(navDatabase);lock.exec('BEGIN IMMEDIATE');
    await assert.rejects(nav('world.create',{title:'Blocked by live save'}),/locked/i);
    const retained=await client.state();
    const afterFailure=await nav('world.list');
    check('真实存档写锁使左栏创建失败且保留旧世界',retained.id===initial.id&&afterFailure.activeWorldId===initial.id&&afterFailure.worlds.length===list.worlds.length+1);
    lock.exec('ROLLBACK');lock.close();lock=null;
    evidence.navigation={initial:initial.id,created:created.id,checks:6,transport:'renderer-preload-main-retained-view-real-plugin-real-rust'};
  }
  if(process.env.CRAFTMINE_TEST_DRAFTS==='1'||process.env.CRAFTMINE_TEST_VERIFICATION==='1'||reviewProvider) {
    const drafts=await client.rpc('draftProbe',{},liveReview?220000:reviewProvider?180000:110000);evidence.drafts=drafts;
    if(drafts.verification?.preview?.image){fs.writeFileSync(path.join(directory,'native-check-preview.png'),Buffer.from(drafts.verification.preview.image,'base64'));delete drafts.verification.preview.image;}
    if(drafts.verification?.preview?.reviewImage){fs.writeFileSync(path.join(directory,'native-check-results.png'),Buffer.from(drafts.verification.preview.reviewImage,'base64'));delete drafts.verification.preview.reviewImage;}
    if(drafts.verification?.application?.image){fs.writeFileSync(path.join(directory,'native-application.png'),Buffer.from(drafts.verification.application.image,'base64'));delete drafts.verification.application.image;}
    for(const result of drafts.checks)check(result.name,result.passed);
  }
  await client.rpc('importLegacy');
  const imported=await client.state(state=>state.loaded&&state.id!==initial.id&&!state.disabled);
  check('原生表单经 Electron 授权目录桥和 Rust 完成旧世界导入',imported.snapshot.player.x===8&&fs.readFileSync(legacy.file).equals(original));
  await client.rpc('capture',{name:'native-desktop'});
  evidence.worldImage=await client.rpc('captureWorld',{name:'native-world'});
  const database=path.join(profile,'plugins/data/craftmine.world/tasks.sqlite');
  lock=new DatabaseSync(database);lock.exec('BEGIN IMMEDIATE');
  await client.rpc('respawn');
  const changed=await client.state(state=>state.snapshot?.player.x===0.5);
  const before=JSON.parse(lock.prepare('SELECT document FROM craftmine_worlds WHERE id=?').get(imported.id).document);
  check('退出前的真实游戏变化尚未写入持久存档',changed.snapshot.player.x===0.5&&before.snapshot.player.x===8);
  await client.rpc('close');
  const refused=await client.state(state=>state.loaded&&!state.disabled&&/locked/i.test(state.error));
  check('真实 SQLite 写锁使原生退出失败时保留可重试的世界',refused.snapshot.player.x===0.5&&!client.ended);
  evidence.saveFailure=refused.error;
  await client.rpc('capture',{name:'native-save-failure'});
  await client.rpc('captureWorld',{name:'native-world-save-failure'});
  lock.exec('ROLLBACK');lock.close();lock=null;
  const finalStatus=await client.rpc('status');evidence.beforeExit=finalStatus;
  const finalGuards=await client.rpc('guards');
  check('导入与保存失败全过程没有真实输入或窗口焦点调用',finalStatus.violations.length===0&&finalStatus.windows.every(window=>!window.visible&&!window.focused)&&finalGuards.every(frame=>frame.guard&&frame.guard.pointerLock===0&&frame.guard.focus===0));
  await client.rpc('close');
  const stopped=await Promise.race([client.exit,delay(15000).then(()=>null)]);
  check('解除写锁后原生退出先保存再正常关闭',stopped?.code===0);
  evidence.firstExit=client.audit;
  check('退出时未重建已销毁的界面或产生页面未处理异常',client.audit&&client.audit.violations.length===0&&client.audit.pageErrors.length===0);
  const saved=new DatabaseSync(database,{readOnly:true});
  const record=JSON.parse(saved.prepare('SELECT document FROM craftmine_worlds WHERE id=?').get(imported.id).document);saved.close();
  check('关闭后 Rust 持久存档包含退出前最后的玩家位置',record.snapshot.player.x===0.5);
  client=launch('restart');await client.ready();
  const restored=await client.state();evidence.restored={id:restored.id,player:restored.snapshot.player};
  check('完整重启同一原生客户端保留当前世界和已保存进度',restored.id===imported.id&&restored.snapshot.player.x===0.5);
  const restartStatus=await client.rpc('status');
  check('重启仍保持离屏和零输入调用',restartStatus.violations.length===0&&restartStatus.windows.every(window=>!window.visible&&!window.focused&&!window.focusable&&window.offscreen));
  await client.rpc('close');
  const restartedStop=await Promise.race([client.exit,delay(15000).then(()=>null)]);
  check('重启后的客户端也能正常保存退出',restartedStop?.code===0);
  evidence.restartExit=client.audit;
  check('重启退出仍没有输入调用和页面未处理异常',client.audit&&client.audit.violations.length===0&&client.audit.pageErrors.length===0);
}catch(error){
  evidence.failure=String(error?.stack||error);console.error(error);process.exitCode=1;
  if(client&&!client.ended)for(const method of ['status','desktopState','guards'])try{evidence[method+'AtFailure']=await client.rpc(method);}catch{}
  if(client&&!client.ended)try{await client.rpc('capture',{name:'native-failure'});}catch{}
}
finally {
  if(lock){lock.exec('ROLLBACK');lock.close();}
  if(client)await client.stop();
  if(reviewProvider){evidence.reviewProvider={kind:'fixed-loopback-fixture',requests:reviewProvider.requests};await reviewProvider.close();}
  if(liveReview)evidence.reviewProvider={kind:'real-deepseek-native-pi-completion',model:modelId(),thinking:thinkingEnabled()?reasoningEffort():'off',draftAuthorship:'fixed-native-fixture'};
  const sha256=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({format:'craftmine.native-acceptance/1',mode:packaged?'packaged':'development',time:new Date().toISOString(),passed:!evidence.failure&&checks.every(check=>check.passed),checks,evidence,binaries:{electron:sha256(electron),host:sha256(host),core:sha256(core)},limits:['离屏运行，未做可见窗口或物理双击验收','目录选择返回测试夹具，未打开系统对话框','桌面与世界分别离屏渲染和截图，不证明可见原生窗口的最终合成',liveReview?'真实模型只评审固定草稿，尚未验证原生 Agent 自动创作闭环':reviewProvider?'PI 评审回复来自固定服务，未调用真实模型':'本次不调用模型，也不证明真实 Agent 创作闭环']},null,2));
  console.log('Native acceptance report: '+path.join(directory,'report.json'));
}
