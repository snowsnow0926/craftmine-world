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
    if(location.search==='?placeholder')world.world.build.godot={initializing:true};
    const second={...world,id:'second-world',title:'第二个世界'};let opened=world,opening=world;let listCalls=0;
    globalThis.fixture={
      initializing:location.search==='?placeholder',surfaces:[],
      releaseList:()=>resolveList({worlds:[{id:world.id,title:world.title}],activeWorldId:world.id}),
      releaseOpen:()=>{opened=opening;resolveOpen(opening);},failOpen:()=>rejectOpen(Error('加载资源失败')),
      state:(state,loadingStage)=>listeners.get('godot-world:state')?.({worldId:opening.id,buildId:'retained-build',instanceId:'real-instance',state,loadingStage}),
      immersive:()=>listeners.get('craftmine-presentation')?.({active:true}),
    };
    globalThis.pluginBridge={on:(event,callback)=>listeners.set(event,callback),invoke:async (channel,args)=>{
      if(channel==='app.getAppearance')return{base:'dark'};
      if(channel==='world.list'){if(listCalls++)return{worlds:[world],activeWorldId:world.id};return new Promise(resolve=>{resolveList=resolve;});}
      if(channel==='world.read')return args.id===second.id?second:world;
      if(channel==='world.create'){fixture.creates=(fixture.creates||0)+1;return {...second,state:'initializing',creation:{operationId:'stable-create-test',stage:'import',progress:10}};}
      if(channel==='world.open'){opening=args.id===second.id?second:world;fixture.openPending=args.id;return new Promise((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});}
      if(channel==='godot.runtimeSave'){
        fixture.saveCalls=(fixture.saveCalls||0)+1;
        if(fixture.failSave)throw Error(fixture.failSave);
        return{worldId:opened.id,buildId:'retained-build',revision:fixture.saveCalls};
      }
      if(channel==='godot.candidatePreview')throw Error('PREVIEW_LOAD_FAILED');
      if(channel==='godot.candidateClose'){
        if(location.search==='?fail-mounted-state')throw Error('读取运行状态失败');
        return{status:'none'};
      }
      if(channel==='godot.runtimeSurface'){fixture.surfaces.push({...args});if(fixture.rejectSurface)throw Error('GODOT_WORLD_CHANGED');return {}; }
      if(channel==='godot.runtimeState')return{worldId:opened.id,buildId:'retained-build',instanceId:'real-instance',state:fixture.initializing?'loading':'ready',initializing:fixture.initializing};
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
  await page.evaluate(()=>{fixture.switchPromise=craftmineView.navigate({operation:'switch',id:'second-world'}).catch(error=>fixture.switchError=error.message);});
  await page.waitForFunction(()=>fixture.openPending==='second-world');
  check('switching worlds shows loading before world.open resolves',await visible());
  await page.evaluate(()=>fixture.state('loading','engine'));
  check('new-world loading stage survives the retained old record',(await page.locator('#godot-loading-detail').textContent()).includes('启动图形'));
  await page.evaluate(()=>fixture.failOpen());
  await page.waitForFunction(()=>!document.querySelector('#godot-loading-back').hidden&&!document.querySelector('#godot-loading-back').disabled);
  check('failed switch offers retry and return to original world',await page.locator('#godot-loading-retry').isVisible()&&await page.locator('#godot-loading-back').isVisible());
  await page.evaluate(()=>document.querySelector('#godot-loading-back').onclick());
  await page.waitForFunction(()=>fixture.openPending==='retained-world');await page.evaluate(()=>fixture.releaseOpen());
  await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true'&&document.body.dataset.worldId==='retained-world');
  check('return after failed switch restores original world',!await visible());
  await page.evaluate(()=>{fixture.switchPromise=craftmineView.navigate({operation:'switch',id:'second-world'}).catch(error=>fixture.switchError=error.message);});
  await page.waitForFunction(()=>fixture.openPending==='second-world');await page.evaluate(()=>fixture.failOpen());
  await page.waitForFunction(()=>document.querySelector('#godot-loading').dataset.state==='failed'&&!document.querySelector('#godot-loading-retry').disabled);
  await page.evaluate(()=>{fixture.openPending=null;document.querySelector('#godot-loading-retry').onclick();});
  await page.waitForFunction(()=>fixture.openPending==='second-world');
  check('retry uses failed world identity and restores animation',await visible()&&await page.locator('progress').isVisible());
  await page.evaluate(()=>fixture.releaseOpen());await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true'&&document.body.dataset.worldId==='second-world');
  check('retry completes in the correct world',!await visible());
  await page.evaluate(()=>{fixture.openPending=null;fixture.createPromise=craftmineView.navigate({operation:'create',title:'新世界',operationId:'stable-create-test'}).catch(error=>fixture.switchError=error.message);});
  await page.waitForFunction(()=>fixture.openPending==='second-world');
  check('newly created world remains covered until its runtime is ready',await visible());
  await page.evaluate(()=>fixture.releaseOpen());await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  const createResult=await page.evaluate(()=>fixture.createPromise);
  check('creation ACK preserves real initializing state and recovery metadata instead of implying ready',createResult.state==='initializing'&&createResult.creation?.stage==='import'&&createResult.creation?.operationId==='stable-create-test');
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
  // Run the real shutdown controller directly after a rejected navigation;
  // no successful action in between is allowed to clear activeOperation.
  await page.goto(url);await page.evaluate(()=>fixture.releaseList());await page.waitForFunction(()=>fixture.openPending);
  await page.evaluate(()=>fixture.releaseOpen());await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  await page.evaluate(()=>{fixture.failedNavigation=craftmineView.navigate({operation:'switch',id:'second-world'}).catch(error=>error.message);});
  await page.waitForFunction(()=>fixture.openPending==='second-world');await page.evaluate(()=>fixture.failOpen());
  check('navigation failure still reaches its original caller and loading UI',await page.evaluate(()=>fixture.failedNavigation)==='加载资源失败'&&(await page.locator('#godot-loading-detail').textContent()).includes('加载资源失败'));
  const closeAfterOpen=await page.evaluate(async()=>{const previousSaves=fixture.saveCalls;const result=await craftmineView.prepareClose();return {result,freshSaves:fixture.saveCalls-previousSaves};});
  check('first quit after failed open performs a fresh checkpoint of the retained world',closeAfterOpen.result.loaded===true&&closeAfterOpen.result.worldId==='retained-world'&&closeAfterOpen.freshSaves===1);
  check('successful close preparation does not erase the earlier loading error',!(await page.locator('#error').isHidden())&&(await page.locator('#error').textContent()).includes('加载资源失败'));
  await page.evaluate(()=>craftmineView.cancelClose());
  await page.goto(url);await page.evaluate(()=>fixture.releaseList());await page.waitForFunction(()=>fixture.openPending);
  await page.evaluate(()=>fixture.releaseOpen());await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  const previewError=await page.evaluate(()=>craftmineView.previewControl({action:'open',worldId:'retained-world',candidateId:'candidate-one',buildId:'build-one',jobId:'job-one',sessionId:'session-one'}).then(()=>null,error=>error.message));
  check('preview failure remains visible to its caller',previewError==='PREVIEW_LOAD_FAILED'&&(await page.locator('#error').textContent()).includes('PREVIEW_LOAD_FAILED'));
  const closeAfterPreview=await page.evaluate(async()=>{const previousSaves=fixture.saveCalls||0;const result=await craftmineView.prepareClose();return {result,freshSaves:fixture.saveCalls-previousSaves};});
  check('first quit after failed preview independently checks and saves the current world',closeAfterPreview.result.loaded===true&&closeAfterPreview.freshSaves===1);
  await page.evaluate(()=>craftmineView.cancelClose());
  for(const failure of ['CURRENT_CHECKPOINT_FAILED','GODOT_WORLD_CHANGED']){
    const closeError=await page.evaluate(async failure=>{fixture.failSave=failure;return craftmineView.prepareClose().then(()=>null,error=>error.message);},failure);
    check('current shutdown failure still blocks exit: '+failure,closeError===failure&&(await page.locator('#error').textContent()).includes(failure));
  }
  const recoveredClose=await page.evaluate(async()=>{fixture.failSave=null;return craftmineView.prepareClose();});
  check('quit can retry the actual checkpoint after its cause is resolved',recoveredClose.loaded===true&&recoveredClose.worldId==='retained-world');
  await page.goto(url+'?placeholder');await page.evaluate(()=>fixture.releaseList());await page.waitForFunction(()=>fixture.openPending);await page.evaluate(()=>fixture.releaseOpen());await page.waitForFunction(()=>document.body.dataset.godotState==='loading');
  await page.evaluate(()=>craftmineView.navigate({operation:'switch',id:'retained-world'}));
  check('same-world selection never reveals an unfinished placeholder',await page.evaluate(()=>!fixture.surfaces.some(value=>value.visible===true)));
  await page.evaluate(()=>{fixture.initializing=false;fixture.state('ready');});await page.waitForFunction(()=>fixture.surfaces.some(value=>value.worldId==='retained-world'&&value.visible===true));
  check('first real ready event releases the initialized native surface gate',!await visible());
  const surfacesAfterReady=await page.evaluate(()=>fixture.surfaces.length);await page.evaluate(()=>fixture.state('paused'));
  check('later paused events do not reopen a surface hidden by another UI',await page.evaluate(()=>fixture.surfaces.length)===surfacesAfterReady);
  await page.evaluate(()=>{fixture.surfaces=[];fixture.openPending=null;});await page.evaluate(()=>craftmineView.navigate({operation:'switch',id:'retained-world'}));
  check('explicit same-world ready selection restores the trusted surface without a raw renderer write',await page.evaluate(()=>fixture.surfaces.length===1&&fixture.surfaces[0].visible===true&&fixture.openPending===null));
  await page.goto(url+'?placeholder');await page.evaluate(()=>fixture.releaseList());await page.waitForFunction(()=>fixture.openPending);await page.evaluate(()=>fixture.releaseOpen());await page.waitForFunction(()=>document.body.dataset.godotState==='loading');
  await page.evaluate(()=>{fixture.openPending=null;fixture.rejectSurface=true;fixture.cancelPromise=craftmineView.navigate({operation:'switch',id:'second-world'}).catch(error=>fixture.cancelError=error.message);});
  await page.waitForFunction(()=>fixture.openPending==='second-world'||fixture.cancelError);
  check('cancel of a native-less initialization placeholder reaches the original world open despite rejected surface write',await page.evaluate(()=>fixture.openPending==='second-world'&&!fixture.cancelError));
  await page.evaluate(()=>{fixture.rejectSurface=false;fixture.initializing=false;fixture.releaseOpen();});
  const restoredAfterCancel=await page.evaluate(()=>fixture.cancelPromise);
  await page.waitForFunction(()=>document.body.dataset.worldLoaded==='true');
  check('placeholder cancellation completes in the selected original world',restoredAfterCancel.ok===true&&restoredAfterCancel.activeWorldId==='second-world');
  await page.evaluate(()=>{fixture.openPending=null;fixture.rejectSurface=true;});
  const actualIdentityError=await page.evaluate(()=>craftmineView.navigate({operation:'switch',id:'retained-world'}).then(()=>null,error=>error.message));
  check('a real loaded runtime identity mismatch still blocks navigation before changing worlds',actualIdentityError==='GODOT_WORLD_CHANGED'&&await page.evaluate(()=>fixture.openPending===null&&document.body.dataset.worldId==='second-world'));
  check('no focus or pointer lock request',await page.evaluate(()=>inputRequests===0));
  check('no page errors',errors.length===0);
} finally {
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks,errors,scope:'real product panel/controller with delayed host RPC; no native runtime or packaged window claim'},null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(output);
