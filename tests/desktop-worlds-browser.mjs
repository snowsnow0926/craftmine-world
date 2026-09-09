import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {desktopRuntimePaths} from './helpers/desktop-runtime-paths.mjs';

fs.mkdirSync('test-results',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('test-results/desktop-worlds-'));
const {desktop,plugin,binary,hostEntry}=desktopRuntimePaths(dir);
const previous=process.env.PI_DESKTOP_DATA_DIR;
process.env.PI_DESKTOP_DATA_DIR=path.join(dir,'pi-host');
register(pathToFileURL(path.join(desktop,'test/helpers/ts-import-hooks.mjs')));
const {PluginRuntime}=await import(pathToFileURL(path.join(desktop,'electron/main/plugin-runtime.ts')).href);
const checks=[],errors=[];
const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);console.log('PASS '+name);};
const runtime=new PluginRuntime({hostEntry,spawnProcess:({entry})=>{
  const child=fork(entry,[],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_CORE_BIN:binary}});
  return {postMessage:message=>{if(child.connected)child.send(message);},onMessage:handler=>child.on('message',handler),onExit:handler=>child.on('exit',code=>handler(code??0)),kill:()=>child.kill()};
}});
const bridge=(channel,payload={})=>runtime.invokePanelBridge('craftmine.world',channel,payload);
let browser, rejectSave=false, releaseSave, saveWaiting=false;
try {
  await runtime.loadFromPath(plugin,['ui.view','agent.tool.register','background.service']);
  const first=await bridge('world.create',{title:'林间小屋'});
  first.world.snapshot.player.x=8;
  await bridge('world.saveProgress',{id:first.id,revision:first.revision,baseBuild:first.world.build.id,snapshot:first.world.snapshot});
  browser=await playwright().chromium.launchPersistentContext(path.join(dir,'profile'),browserOptions());
  await browser.addInitScript(()=>{
    globalThis.__inputRequests=0;Element.prototype.requestPointerLock=()=>{globalThis.__inputRequests++;throw Error('Pointer lock disabled');};window.focus=()=>{globalThis.__inputRequests++;};
    if(window===top)globalThis.pluginBridge={invoke:(channel,payload)=>globalThis.__craftmineBridge(channel,payload)};
  });
  const page=await browser.newPage();
  await page.exposeBinding('__craftmineBridge',async(source,channel,payload)=>{
    if(source.frame!==page.mainFrame())throw Error('Only the trusted panel may invoke the bridge');
    if(channel==='world.saveProgress') {
      if(rejectSave)throw Error('Injected save failure');
      if(saveWaiting)await new Promise(resolve=>{releaseSave=resolve;});
    }
    return bridge(channel,payload);
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(plugin,'views/world.html')).href);
  const loaded=id=>page.waitForFunction(id=>document.body.dataset.worldLoaded==='true'&&document.body.dataset.worldId===id,id,{timeout:10000});
  await loaded(first.id);
  check('世界面板通过真实 PI 插件与 Rust 读回玩家位置',(await page.evaluate(()=>craftmineView.snapshot())).snapshot.player.x===8);

  // DOM form submission in a separate headless process; no mouse, key or focus APIs.
  await page.evaluate(()=>{document.getElementById('world-name').value='海边花园';document.getElementById('create-form').requestSubmit();});
  await page.waitForFunction(first=>document.body.dataset.worldLoaded==='true'&&document.body.dataset.worldId!==first,first.id,{timeout:10000});
  const secondId=await page.evaluate(()=>document.body.dataset.worldId);
  check('界面创建第二个空白世界',(await page.evaluate(()=>craftmineView.snapshot())).snapshot.player.x===0.5);
  const persisted=await bridge('world.open',{id:first.id});
  check('切换前实际游戏快照已保存到 Rust',persisted.world.snapshot.format==='craftmine.progress/3'&&persisted.world.snapshot.player.x===8);
  await page.evaluate(id=>{const select=document.getElementById('world-list');select.value=id;select.dispatchEvent(new Event('change'));},first.id);
  await loaded(first.id);
  check('切回第一个世界保留各自的进度',(await page.evaluate(()=>craftmineView.snapshot())).snapshot.player.x===8&&(await bridge('world.open',{id:secondId})).world.snapshot.player.x===0.5);
  // Exercise a real gameplay state change through its authenticated message API.
  await page.evaluate(()=>{
    const frame=document.querySelector('iframe');
    const nonce=frame.srcdoc.match(/name="craftmine-nonce" content="([^"]+)"/)[1];
    frame.contentWindow.postMessage({channel:'craftmine-host/1',nonce,type:'respawn'},'*');
  });
  await page.waitForFunction(async()=>(await craftmineView.snapshot()).snapshot.player.x===0.5);
  rejectSave=true;
  const failedClose=await page.evaluate(()=>craftmineView.prepareClose().then(()=>null,error=>error.message));
  check('关闭保存失败时保留真实页面和未保存进度',failedClose.includes('Injected save failure')&&(await page.evaluate(()=>craftmineView.snapshot())).snapshot.player.x===0.5&&(await bridge('world.open',{id:first.id})).world.snapshot.player.x===8);
  check('保存失败后恢复世界控制按钮',await page.evaluate(()=>!document.getElementById('save-world').disabled));
  rejectSave=false;saveWaiting=true;
  await page.evaluate(()=>{void craftmineView.prepareClose().then(value=>{globalThis.closeReceipt=value;});});
  const saveDeadline=Date.now()+5000;
  while(!releaseSave){if(Date.now()>saveDeadline)throw Error('Close did not reach the save barrier');await new Promise(resolve=>setTimeout(resolve,10));}
  check('退出等待 Rust 写入确认且不允许同时切换世界',await page.evaluate(()=>!globalThis.closeReceipt&&document.getElementById('world-list').disabled));
  saveWaiting=false;releaseSave();
  await page.waitForFunction(()=>!!globalThis.closeReceipt);
  const closeReceipt=await page.evaluate(()=>globalThis.closeReceipt);
  const closedWorld=await bridge('world.open',{id:first.id});
  check('关闭重试成功并返回已提交版本',closeReceipt.worldId===first.id&&closeReceipt.revision===closedWorld.revision&&closedWorld.world.snapshot.player.x===0.5);
  await bridge('world.open',{id:first.id});
  check('所有页面均未请求鼠标锁定或焦点',(await Promise.all(page.frames().map(frame=>frame.evaluate(()=>globalThis.__inputRequests||0)))).every(count=>count===0));
  await page.close();await runtime.unload('craftmine.world');
  await runtime.loadFromPath(plugin,['ui.view','agent.tool.register','background.service']);
  const state=await bridge('world.list');
  check('插件与 Rust 全部重启后仍保留世界和上次选择',state.worlds.length===2&&state.activeWorldId===first.id);
  check('重启读回关闭前最后一次真实游戏进度',(await bridge('world.open',{id:first.id})).world.snapshot.player.x===0.5);
  check('保存接口不能用额外参数替换世界源码',(await bridge('world.saveProgress',{id:first.id,revision:closedWorld.revision,baseBuild:first.world.build.id,snapshot:closedWorld.world.snapshot,build:{id:'forged'}})).world.build.id===first.world.build.id);
  await assert.rejects(bridge('task.commit',{draft:{}}),/Unsupported/);
  check('世界页面不能调用任务事务或发布未经验证的代码',true);
  check('后台页面没有未处理异常',errors.length===0);
} catch(error) {errors.push(error.stack);process.exitCode=1;console.error(error);}
finally {
  await browser?.close();for(const loaded of runtime.listLoaded())await runtime.unload(loaded.manifest.id);
  if(previous===undefined)delete process.env.PI_DESKTOP_DATA_DIR;else process.env.PI_DESKTOP_DATA_DIR=previous;
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({checks,errors},null,2));console.log('Report: '+path.join(dir,'report.json'));
}
