// Real product HTML and bundled plugin controller, with a deferred host RPC.
// This reproduces retained-world startup: world.open does not resolve until
// the native engine finishes. No exported shell, simulated input or focus.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {playwright,browserOptions} from '../app/browser-tools.mjs';

const output=fs.mkdtempSync(path.resolve('test-results/godot-startup-loading-'));
const require=createRequire(path.resolve('vendor/pi-desktop/packages/agent-runtime/package.json'));
await require('esbuild').build({entryPoints:['plugins/craftmine-world/view.mjs'],outfile:path.join(output,'view.js'),bundle:true,platform:'browser',format:'iife',target:'chrome130',define:{CRAFTMINE_BOOT_WORLD:'{}',CRAFTMINE_GAME_DOCUMENT:'""',CRAFTMINE_INPUT_GUARD:'""'}});
fs.copyFileSync('plugins/craftmine-world/world.html',path.join(output,'world.html'));
const server=http.createServer((request,response)=>{
  const file=request.url?.startsWith('/view.js')?'view.js':'world.html';
  response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');
  response.end(fs.readFileSync(path.join(output,file)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await playwright().chromium.launchPersistentContext(path.join(output,'profile'),{...browserOptions(),headless:true,viewport:{width:1280,height:760}});
const checks=[],errors=[];
const check=(name,passed)=>{checks.push({name,passed});assert.ok(passed,name);console.log('PASS '+name);};
try {
  await browser.addInitScript(()=>{
    globalThis.inputRequests=0;
    Element.prototype.requestPointerLock=()=>{inputRequests++;throw Error('Pointer lock disabled');};
    window.focus=()=>{inputRequests++;};
    const listeners=new Map();let resolveList,resolveOpen,rejectOpen;
    const world={id:'retained-world',title:'第一个世界',world:{build:{id:'retained-build',engine:{kind:'godot-web'}},snapshot:{}}};
    let listCalls=0;
    globalThis.fixture={
      releaseList:()=>resolveList({worlds:[{id:world.id,title:world.title}],activeWorldId:world.id}),
      releaseOpen:()=>resolveOpen(world),failOpen:()=>rejectOpen(Error('加载资源失败')),
      state:(state,loadingStage)=>listeners.get('godot-world:state')?.({worldId:world.id,buildId:'retained-build',instanceId:'real-instance',state,loadingStage}),
      immersive:()=>listeners.get('craftmine-presentation')?.({active:true}),
    };
    globalThis.pluginBridge={on:(event,callback)=>listeners.set(event,callback),invoke:async channel=>{
      if(channel==='app.getAppearance')return{base:'dark'};
      if(channel==='world.list'){if(listCalls++)return{worlds:[world],activeWorldId:world.id};return new Promise(resolve=>{resolveList=resolve;});}
      if(channel==='world.open'){fixture.openPending=true;return new Promise((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});}
      if(channel==='godot.candidateClose'){
        if(location.search==='?fail-mounted-state')throw Error('读取运行状态失败');
        return{status:'none'};
      }
      if(channel==='godot.runtimeState')return{worldId:world.id,buildId:'retained-build',instanceId:'real-instance',state:'ready'};
      return{};
    }};
  });
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}/world.html`;
  await page.goto(url);
  const visible=()=>page.locator('#godot-loading').isVisible();
  check('loader paints before world.list resolves',await visible());
  check('progress is honest indeterminate progress, without fabricated percentage',await page.evaluate(()=>!document.querySelector('progress').hasAttribute('value')));
  await page.evaluate(()=>{fixture.immersive();fixture.releaseList();});
  await page.waitForFunction(()=>fixture.openPending);
  check('retained world.open stays pending while loader remains visible',await visible());
  await page.evaluate(()=>fixture.state('loading','engine'));
  check('host engine stage reaches loader before mount(record)',await page.locator('#godot-loading-detail').textContent()==='正在启动图形引擎…');
  await page.screenshot({path:path.join(output,'retained-world-opening.png')});
  await page.evaluate(()=>fixture.state('loading','scene'));
  check('scene restoration remains covered by loader',await visible()&&(await page.locator('#godot-loading-detail').textContent()).includes('恢复世界进度'));
  await page.evaluate(()=>fixture.state('ready'));
  check('early ready broadcast cannot hide loading before world.open returns',await visible());
  await page.evaluate(()=>fixture.releaseOpen());
  await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  check('loader closes after mounted runtime is confirmed ready',!await visible());
  check('successful mount has no product error',await page.locator('#error').isHidden());
  await page.goto(url);await page.evaluate(()=>fixture.releaseList());await page.waitForFunction(()=>fixture.openPending);
  await page.evaluate(()=>fixture.failOpen());
  await page.waitForFunction(()=>document.querySelector('#godot-loading').dataset.state==='failed');
  check('failed world.open displays error instead of endless animation',await visible()&&await page.locator('progress').isHidden()&&(await page.locator('#godot-loading-detail').textContent()).includes('加载资源失败'));
  await page.screenshot({path:path.join(output,'retained-world-failed.png')});
  await page.goto(url+'?fail-mounted-state');await page.evaluate(()=>fixture.releaseList());await page.waitForFunction(()=>fixture.openPending);
  await page.evaluate(()=>fixture.releaseOpen());
  await page.waitForFunction(()=>document.querySelector('#godot-loading').dataset.state==='failed');
  check('mounted-world RPC failure does not leave an endless loading animation',await visible()&&await page.locator('progress').isHidden()&&(await page.locator('#godot-loading-detail').textContent()).includes('读取运行状态失败'));
  await page.evaluate(()=>fixture.state('ready'));
  check('confirmed recovery clears loading error and stale error banner',!await visible()&&await page.locator('#error').isHidden());
  check('no focus or pointer lock request',await page.evaluate(()=>inputRequests===0));
  check('no page errors',errors.length===0);
} finally {
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks,errors,scope:'real product panel/controller with delayed host RPC; no native runtime or packaged window claim'},null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(output);
