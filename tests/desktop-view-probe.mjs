import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {playwright,browserOptions} from '../app/browser-tools.mjs';

fs.mkdirSync('test-results',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('test-results/desktop-view-'));
const checks=[],errors=[];
const check=(name,value,detail)=>{checks.push({name,passed:!!value,detail});assert.ok(value,name);console.log('PASS '+name);};
const browser=await playwright().chromium.launchPersistentContext(path.join(dir,'profile'),browserOptions());
try {
  await browser.addInitScript(()=>{
    globalThis.__inputRequests=0;
    Element.prototype.requestPointerLock=()=>{globalThis.__inputRequests++;throw Error('Pointer lock disabled in background tests');};
    window.focus=()=>{globalThis.__inputRequests++;};
  });
  const page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('requestfailed',request=>errors.push(request.url()+': '+request.failure()?.errorText));
  await page.goto(pathToFileURL(path.resolve('desktop/build/craftmine.world/views/world.html')).href);
  await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true'||document.body.dataset.worldError,{},{timeout:10000});
  check('本地工作面板可加载游戏画面',await page.evaluate(()=>document.body.dataset.worldLoaded==='true'),await page.evaluate(()=>document.body.dataset.worldError));
  const snapshot=await page.evaluate(()=>craftmineView.snapshot());
  check('不经过网页服务器也能读取世界快照',snapshot.type==='snapshot'&&snapshot.snapshot.player.y===6,JSON.stringify(snapshot.snapshot));
  const worker=await page.frameLocator('iframe').locator('body').evaluate(async()=>{
    const module=URL.createObjectURL(new Blob(['export const value=7;'],{type:'text/javascript'}));
    const bootstrap=URL.createObjectURL(new Blob([`import(${JSON.stringify(module)}).then(m=>postMessage(m.value));`],{type:'text/javascript'}));
    const worker=new Worker(bootstrap);
    try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timeout')),3000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};});}
    finally{worker.terminate();URL.revokeObjectURL(module);URL.revokeObjectURL(bootstrap);}
  });
  check('本地面板中 Blob Worker 能加载玩法 ES 模块',worker===7);
  const isolation=await page.frameLocator('iframe').locator('body').evaluate(()=>({bridge:typeof pluginBridge,node:typeof require,locked:document.pointerLockElement!==null,inputRequests:globalThis.__inputRequests}));
  check('游戏子页面不暴露 PI 宿主桥接或 Node',isolation.bridge==='undefined'&&isolation.node==='undefined');
  check('未请求鼠标锁定或窗口焦点',!isolation.locked&&isolation.inputRequests===0);
  check('页面无未处理异常',errors.length===0,errors.join(' / '));
  await page.screenshot({path:path.join(dir,'world.png')});
} catch(error) {errors.push(error.stack);process.exitCode=1;console.error(error);}
finally{await browser.close();fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({checks,errors},null,2));console.log('Report: '+path.join(dir,'report.json'));}
